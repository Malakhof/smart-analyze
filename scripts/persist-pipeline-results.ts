/**
 * persist-pipeline-results.ts — Step [6/7] of run-full-pipeline.sh.
 * Replaces the manual chain (apply → repair → detect → score) with one
 * orchestrated TS subprocess pipeline so cron can run un-attended.
 *
 * Stages (each isolated by try/catch — one failure does NOT block the next):
 *   1. apply transcripts to CallRecord (match by pbxUuid, NOT by id)
 *   2. repair-transcripts.ts --tenant=X --write-back   (DeepSeek + glossary)
 *   3. detect-call-type.ts --tenants=X --write-back    (DeepSeek)
 *   4. score-diva-script-compliance.ts --tenant=X --write-back (DeepSeek)
 *
 * Usage:
 *   tsx scripts/persist-pipeline-results.ts <results.jsonl> <tenantName> [--limit=N]
 *
 * Exit codes:
 *   0 — all 4 stages passed
 *   ≠0 — at least one stage failed (count = number of failed stages)
 */
import { readFileSync, existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

interface ResultRow {
  id?: string
  uuid?: string
  transcript?: string
  transcript_raw?: unknown
  language?: string
  duration?: number
  mode?: string
  error?: string
  skipped?: string
}

interface StageOutcome {
  stage: string
  ok: boolean
  durationMs: number
  meta: Record<string, unknown>
}

function arg(name: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`))
  return eq ? eq.slice(name.length + 3) : undefined
}

const RESULTS_PATH = process.argv[2]
const TENANT_NAME = process.argv[3]
const LIMIT = Number(arg("limit") ?? "10000")

if (!RESULTS_PATH || !TENANT_NAME) {
  console.error("Usage: persist-pipeline-results.ts <results.jsonl> <tenantName> [--limit=N]")
  process.exit(2)
}
if (!existsSync(RESULTS_PATH)) {
  console.error(`results.jsonl not found: ${RESULTS_PATH}`)
  process.exit(2)
}

const REPO_ROOT = "/root/smart-analyze"   // overridden by env REPO_ROOT
const repoRoot = process.env.REPO_ROOT ?? REPO_ROOT

const outcomes: StageOutcome[] = []

function runSubprocess(stage: string, cmd: string, args: string[], env: Record<string, string> = {}): StageOutcome {
  const t0 = Date.now()
  const meta: Record<string, unknown> = { cmd: `${cmd} ${args.join(" ")}` }
  try {
    const r = spawnSync(cmd, args, {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 3 * 60 * 60 * 1000,        // 3h hard cap per stage (DeepSeek concurrency=3 over 400 files)
    })
    meta.exitCode = r.status
    meta.stdoutTail = r.stdout?.split("\n").slice(-5).join("\n") ?? ""
    meta.stderrTail = r.stderr?.split("\n").slice(-5).join("\n") ?? ""
    const ok = r.status === 0
    const out: StageOutcome = { stage, ok, durationMs: Date.now() - t0, meta }
    console.log(`[${stage}] ${ok ? "✓" : "✗"} exit=${r.status} took=${(out.durationMs/1000).toFixed(1)}s`)
    if (!ok && r.stderr) console.log(`[${stage}] stderr tail: ${meta.stderrTail}`)
    return out
  } catch (e) {
    const out: StageOutcome = { stage, ok: false, durationMs: Date.now() - t0, meta: { ...meta, error: (e as Error).message } }
    console.log(`[${stage}] ✗ exception: ${(e as Error).message}`)
    return out
  }
}

async function applyTranscriptsByPbxUuid(): Promise<StageOutcome> {
  const stage = "apply-transcripts"
  const t0 = Date.now()
  const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter: adapterPg })

  const lines = readFileSync(RESULTS_PATH, "utf-8").split("\n").filter(Boolean)
  const rows: ResultRow[] = lines.map((l) => {
    try { return JSON.parse(l) as ResultRow } catch { return {} }
  })

  let applied = 0
  let skippedEmpty = 0
  let skippedSkipMark = 0
  let notFound = 0
  let failed = 0

  for (const r of rows) {
    const uuid = r.uuid ?? r.id
    if (!uuid) { skippedEmpty++; continue }
    if (r.skipped) { skippedSkipMark++; continue }
    if (r.error || !r.transcript || r.transcript.length < 5) { skippedEmpty++; continue }

    try {
      const updated = await db.$executeRawUnsafe(
        `UPDATE "CallRecord"
         SET transcript = $1
             ${typeof r.duration === "number" && r.duration > 0 ? `, duration = ${Math.round(r.duration)}` : ""}
             , "transcriptionStatus" = 'transcribed'
             , "transcriptionAt"     = NOW()
         WHERE "pbxUuid" = $2`,
        r.transcript, uuid
      )
      if (Number(updated) === 0) {
        notFound++
        continue
      }
      applied++
    } catch (e) {
      failed++
      console.error(`[apply] failed pbxUuid=${uuid}: ${(e as Error).message}`)
    }
  }

  await db.$disconnect()
  const ok = failed === 0 && applied > 0
  console.log(`[${stage}] ${ok ? "✓" : "✗"} applied=${applied} skipped_empty=${skippedEmpty} skipped_mark=${skippedSkipMark} not_found=${notFound} failed=${failed}`)
  return {
    stage, ok,
    durationMs: Date.now() - t0,
    meta: { applied, skippedEmpty, skippedSkipMark, notFound, failed, totalRows: rows.length },
  }
}

async function main() {
  console.log(`[persist] tenant=${TENANT_NAME} input=${RESULTS_PATH} repoRoot=${repoRoot} limit=${LIMIT}`)

  // Stage 1: apply transcripts (in-process)
  outcomes.push(await applyTranscriptsByPbxUuid())

  // Stage 2: repair (DeepSeek + glossary)
  // Glossary lives in docs/glossary/{tenant}.txt; repair-transcripts.ts loads it.
  outcomes.push(runSubprocess(
    "repair-transcripts",
    "node_modules/.bin/tsx",
    ["scripts/repair-transcripts.ts", `--tenant=${TENANT_NAME}`, `--limit=${LIMIT}`, "--write-back"],
  ))

  // Stage 3: detect-call-type (DeepSeek)
  outcomes.push(runSubprocess(
    "detect-call-type",
    "node_modules/.bin/tsx",
    ["scripts/detect-call-type.ts", `--tenants=${TENANT_NAME}`, `--limit=${LIMIT}`, "--write-back"],
  ))

  // Stage 4: score-diva-script-compliance (DeepSeek)
  outcomes.push(runSubprocess(
    "score-script",
    "node_modules/.bin/tsx",
    ["scripts/score-diva-script-compliance.ts", `--tenant=${TENANT_NAME}`, `--limit=${LIMIT}`, "--write-back"],
  ))

  // Summary
  console.log("\n=== persist-pipeline-results SUMMARY ===")
  for (const o of outcomes) {
    console.log(`  [${o.stage}] ${o.ok ? "✓" : "✗"} took=${(o.durationMs/1000).toFixed(1)}s ${o.ok ? JSON.stringify(o.meta).slice(0,160) : ""}`)
  }
  const failedCount = outcomes.filter((o) => !o.ok).length
  console.log(`\n  ${failedCount === 0 ? "✓ all 4 stages passed" : `✗ ${failedCount} stage(s) failed`}\n`)
  process.exit(failedCount)
}

main().catch((e) => {
  console.error("[persist] FATAL:", e)
  process.exit(1)
})
