/**
 * detect-call-type.ts — classify CallRecord transcripts as REAL/VOICEMAIL/SECRETARY/IVR/HUNG_UP/NO_ANSWER.
 *
 * Reads CallRecord rows from PROD DB via SSH+psql (read-only by default).
 * Sends each transcript to DeepSeek (deepseek-chat, temperature=0, JSON mode).
 * Emits JSONL to stdout AND saves to /tmp/tuning/voicemail-classify.jsonl.
 *
 * Usage (locally):
 *   tsx scripts/detect-call-type.ts --limit=20 > /tmp/tuning/voicemail-classify.jsonl
 *   tsx scripts/detect-call-type.ts --limit=100 --concurrency=5
 *   tsx scripts/detect-call-type.ts --limit=20 --write-back     # writes CallRecord.callType (skipped if column missing)
 *
 * Requirements:
 *   - SSH access: ~/.ssh/timeweb to root@80.76.60.130
 *   - DEEPSEEK_API_KEY in local .env (auto-loaded via dotenv if present)
 *
 * Cost: deepseek-chat ~$0.14 / 1M input tokens, ~$0.28 / 1M output tokens.
 */
import { spawnSync } from "node:child_process"
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname } from "node:path"
import OpenAI from "openai"

// --- Config -----------------------------------------------------------------

const SSH_KEY = process.env.SSH_KEY || `${process.env.HOME}/.ssh/timeweb`
const SSH_HOST = process.env.SSH_HOST || "root@80.76.60.130"
const DB_CONTAINER = process.env.DB_CONTAINER || "smart-analyze-db"
const DB_USER = process.env.DB_USER || "smartanalyze"
const DB_NAME = process.env.DB_NAME || "smartanalyze"

const OUT_PATH = "/tmp/tuning/voicemail-classify.jsonl"

// DeepSeek pricing (USD per 1M tokens, deepseek-chat as of 2026)
const PRICE_INPUT_PER_M = 0.14
const PRICE_OUTPUT_PER_M = 0.28

// --- CLI args ---------------------------------------------------------------

function parseArg(name: string, defaultVal?: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (arg) return arg.slice(name.length + 3)
  if (process.argv.includes(`--${name}`)) return "true"
  return defaultVal
}

const LIMIT = Number(parseArg("limit", "20"))
const CONCURRENCY = Number(parseArg("concurrency", "3"))
const WRITE_BACK = parseArg("write-back") === "true"
const TENANTS = (parseArg("tenants") || "diva-school,vastu")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
// --uuids=u1,u2,...  When set, only these CallRecord.pbxUuid rows are
// classified — overrides --limit. Worker passes its just-transcribed batch.
const UUIDS_ARG = parseArg("uuids")

// --- Load .env (lightweight, no dependency) ---------------------------------

function loadDotEnv(path: string) {
  if (!existsSync(path)) return
  const text = readFileSync(path, "utf8")
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (!process.env[m[1]]) process.env[m[1]] = v
  }
}

loadDotEnv(`${process.cwd()}/.env`)

if (!process.env.DEEPSEEK_API_KEY) {
  console.error("ERROR: DEEPSEEK_API_KEY missing (set in .env or env)")
  process.exit(2)
}

// --- DeepSeek client --------------------------------------------------------

const ai = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
})
const AI_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat"

// --- DB helpers ------------------------------------------------
//
// Two paths:
//   1. Direct Prisma (when DATABASE_URL is set — e.g. running INSIDE prod docker
//      container or persist-pipeline-results.ts orchestrator). This is the
//      cron-friendly path — no ssh key required.
//   2. SSH + psql fallback (when running from Mac / dev laptop). Requires
//      SSH_KEY (~/.ssh/timeweb) reachable.
//
// Decision: USE_DIRECT_DB env var OR DATABASE_URL set + ssh key absent.

import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { existsSync as _existsSync } from "node:fs"

let _prisma: PrismaClient | null = null
function getPrisma(): PrismaClient {
  if (_prisma) return _prisma
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL not set — cannot use direct mode")
  const adapterPg = new PrismaPg({ connectionString: url })
  _prisma = new PrismaClient({ adapter: adapterPg })
  return _prisma
}

function shouldUseDirectDb(): boolean {
  if (process.env.USE_DIRECT_DB === "1") return true
  if (process.env.USE_DIRECT_DB === "0") return false
  // Auto: prefer direct when DATABASE_URL set AND ssh key absent
  return Boolean(process.env.DATABASE_URL) && !_existsSync(SSH_KEY)
}

async function runSqlDirect<T = unknown>(sql: string): Promise<T> {
  const wrapped = `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) AS data FROM (${sql.replace(/;\s*$/, "")}) t`
  const rows = await getPrisma().$queryRawUnsafe<{ data: T }[]>(wrapped)
  return (rows[0]?.data ?? ([] as unknown as T))
}

function runSshPsql(sql: string): string {
  // Use psql -A -t to get unaligned tuples-only output. Wrap query in a row_to_json
  // aggregation to safely transport newlines inside transcripts.
  const wrapped = `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)::text FROM (${sql.replace(/;\s*$/, "")}) t;\n`
  // Pipe SQL via stdin to psql -f - to avoid all shell-quoting issues with
  // parens/quotes/newlines. The remote command is a fixed string with no
  // user-controlled tokens.
  const remoteCmd = `docker exec -i ${DB_CONTAINER} psql -U ${DB_USER} -d ${DB_NAME} -A -t -f -`
  const args = [
    "-i",
    SSH_KEY,
    "-o",
    "ConnectTimeout=15",
    SSH_HOST,
    remoteCmd,
  ]
  const proc = spawnSync("ssh", args, {
    encoding: "utf8",
    input: wrapped,
    maxBuffer: 200 * 1024 * 1024,
  })
  if (proc.status !== 0) {
    throw new Error(`ssh/psql failed (status=${proc.status}): ${proc.stderr}`)
  }
  return proc.stdout.trim()
}

interface CallRow {
  id: string
  tenant_name: string
  duration: number | null
  transcript: string
}

async function fetchCalls(limit: number, tenants: string[], uuids: string[] | null): Promise<CallRow[]> {
  const tenantList = tenants.map((t) => `'${t.replace(/'/g, "''")}'`).join(",")
  // --uuids: exact pbxUuid set, ignore --limit (worker controls scope).
  const uuidClause = uuids && uuids.length > 0
    ? `AND cr."pbxUuid" IN (${uuids.map((u) => `'${u.replace(/'/g, "''")}'`).join(",")})`
    : `AND cr."callType" IS NULL`
  const limitClause = uuids && uuids.length > 0 ? "" : `LIMIT ${Number(limit)}`
  const sql = `
    SELECT cr.id,
           tn.name AS tenant_name,
           cr.duration,
           cr.transcript
    FROM "CallRecord" cr
    JOIN "Tenant" tn ON tn.id = cr."tenantId"
    WHERE cr.transcript IS NOT NULL
      AND tn.name IN (${tenantList})
      ${uuidClause}
    ORDER BY cr."createdAt" DESC
    ${limitClause}
  `
  if (shouldUseDirectDb()) {
    return await runSqlDirect<CallRow[]>(sql)
  }
  const raw = runSshPsql(sql)
  if (!raw) return []
  return JSON.parse(raw) as CallRow[]
}

async function checkCallTypeColumnExists(): Promise<boolean> {
  const sql = `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='CallRecord'
      AND column_name='callType'
  `
  if (shouldUseDirectDb()) {
    const arr = await runSqlDirect<unknown[]>(sql)
    return arr.length > 0
  }
  const raw = runSshPsql(sql)
  if (!raw) return false
  try {
    const arr = JSON.parse(raw) as unknown[]
    return arr.length > 0
  } catch {
    return false
  }
}

async function writeBackCallType(id: string, callType: string): Promise<void> {
  if (shouldUseDirectDb()) {
    await getPrisma().$executeRawUnsafe(
      `UPDATE "CallRecord" SET "callType" = $1 WHERE id = $2`,
      callType, id
    )
    return
  }
  const sql = `UPDATE "CallRecord" SET "callType" = '${callType}' WHERE id = '${id.replace(/'/g, "''")}' RETURNING id`
  runSshPsql(sql)
}

// --- Prompt -----------------------------------------------------------------

const SYSTEM_PROMPT = `Ты анализируешь транскрипцию телефонного звонка для классификации типа звонка.

Классифицируй ОДНОЙ из категорий:
- REAL: настоящий двусторонний диалог продаж (>30s реальной речи с обеих сторон)
- VOICEMAIL: автоответчик ("оставьте сообщение после сигнала", "абонент недоступен")
- SECRETARY: секретарь/помощник, не целевой клиент ("по какому вопросу", "сейчас соединю")
- IVR: голосовое меню ("нажмите 1 для...", "ваш звонок важен для нас")
- HUNG_UP: клиент сразу повесил трубку или сразу занят (<5s реального диалога)
- NO_ANSWER: гудки без ответа

Output ТОЛЬКО валидный JSON:
{"type": "REAL|VOICEMAIL|SECRETARY|IVR|HUNG_UP|NO_ANSWER", "confidence": 0-100, "reason": "одно предложение"}`

const VALID_TYPES = new Set([
  "REAL",
  "VOICEMAIL",
  "SECRETARY",
  "IVR",
  "HUNG_UP",
  "NO_ANSWER",
])

interface ClassifyResult {
  id: string
  type: string
  confidence: number
  reason: string
  inputTokens: number
  outputTokens: number
  error?: string
}

async function classifyOne(row: CallRow): Promise<ClassifyResult> {
  const userPrompt = `Транскрипция:\n${row.transcript}`

  try {
    const response = await ai.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    })

    const content = response.choices[0]?.message?.content ?? ""
    const usage = response.usage
    const inputTokens = usage?.prompt_tokens ?? 0
    const outputTokens = usage?.completion_tokens ?? 0

    let parsed: { type?: string; confidence?: number; reason?: string }
    try {
      parsed = JSON.parse(content)
    } catch {
      return {
        id: row.id,
        type: "PARSE_ERROR",
        confidence: 0,
        reason: `Bad JSON from model: ${content.slice(0, 200)}`,
        inputTokens,
        outputTokens,
        error: "json_parse",
      }
    }

    const type = (parsed.type ?? "").toString().toUpperCase()
    if (!VALID_TYPES.has(type)) {
      return {
        id: row.id,
        type: "INVALID_TYPE",
        confidence: 0,
        reason: `Model returned non-enum: ${type}`,
        inputTokens,
        outputTokens,
        error: "invalid_type",
      }
    }

    return {
      id: row.id,
      type,
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence ?? 0))),
      reason: (parsed.reason ?? "").toString().slice(0, 500),
      inputTokens,
      outputTokens,
    }
  } catch (e) {
    return {
      id: row.id,
      type: "API_ERROR",
      confidence: 0,
      reason: (e as Error).message.slice(0, 300),
      inputTokens: 0,
      outputTokens: 0,
      error: "api_error",
    }
  }
}

// --- Concurrency runner -----------------------------------------------------

async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, i: number) => Promise<R>,
  concurrency: number,
  onResult: (result: R, i: number) => void
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  async function next(): Promise<void> {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      const r = await worker(items[i], i)
      results[i] = r
      onResult(r, i)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => next()))
  return results
}

// --- Main -------------------------------------------------------------------

async function main() {
  console.error(
    `[detect-call-type] limit=${LIMIT} concurrency=${CONCURRENCY} tenants=[${TENANTS.join(",")}] write-back=${WRITE_BACK}`
  )

  // Ensure output dir exists; we write the JSONL file once at the end.
  const outDir = dirname(OUT_PATH)
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

  let canWriteBack = false
  if (WRITE_BACK) {
    try {
      canWriteBack = await checkCallTypeColumnExists()
    } catch (e) {
      console.error(`[warn] could not probe schema: ${(e as Error).message}`)
    }
    if (!canWriteBack) {
      console.error(
        "[warn] --write-back requested but CallRecord.callType column does not exist — skipping write-back. Add column via prisma migration to enable."
      )
    }
  }

  const uuids = UUIDS_ARG ? UUIDS_ARG.split(",").map((s) => s.trim()).filter(Boolean) : null
  console.error(`[fetch] mode=${shouldUseDirectDb() ? "direct-prisma" : "ssh-psql"} ${uuids ? `uuids=${uuids.length}` : `limit=${LIMIT}`}`)
  let rows: CallRow[]
  try {
    rows = await fetchCalls(LIMIT, TENANTS, uuids)
  } catch (e) {
    console.error(`[fatal] DB fetch failed: ${(e as Error).message}`)
    process.exit(3)
  }
  console.error(`[fetch] got ${rows.length} rows`)

  if (rows.length === 0) {
    console.error("[done] nothing to classify")
    return
  }

  const t0 = Date.now()
  const distribution: Record<string, number> = {}
  let totalInput = 0
  let totalOutput = 0
  let errors = 0
  let writeBackErrors = 0
  let writtenBack = 0
  const linesBuffer: string[] = []

  await runWithConcurrency(
    rows,
    (row) => classifyOne(row),
    CONCURRENCY,
    (r, i) => {
      totalInput += r.inputTokens
      totalOutput += r.outputTokens
      distribution[r.type] = (distribution[r.type] ?? 0) + 1
      if (r.error) errors++

      const line = JSON.stringify({
        id: r.id,
        type: r.type,
        confidence: r.confidence,
        reason: r.reason,
      })
      // Stream to stdout for tail-friendly progress; also collect for batched
      // write to OUT_PATH at the end (avoids interleaving if user pipes
      // stdout to the same file via shell redirect).
      process.stdout.write(line + "\n")
      linesBuffer.push(line)

      // Progress to stderr
      if ((i + 1) % 5 === 0 || i === rows.length - 1) {
        console.error(
          `  [${i + 1}/${rows.length}] tokens(in/out)=${totalInput}/${totalOutput} errors=${errors}`
        )
      }

      // Optional write-back (await — function is async now)
      if (canWriteBack && !r.error && VALID_TYPES.has(r.type)) {
        writeBackCallType(r.id, r.type)
          .then(() => { writtenBack++ })
          .catch((e: Error) => {
            writeBackErrors++
            console.error(
              `  [write-back] failed for ${r.id}: ${e.message.slice(0, 120)}`
            )
          })
      }
    }
  )

  // Flush all results to OUT_PATH atomically
  writeFileSync(OUT_PATH, linesBuffer.join("\n") + "\n")

  const elapsedSec = (Date.now() - t0) / 1000
  const costInput = (totalInput / 1_000_000) * PRICE_INPUT_PER_M
  const costOutput = (totalOutput / 1_000_000) * PRICE_OUTPUT_PER_M
  const costTotal = costInput + costOutput

  console.error(`\n=== SUMMARY ===`)
  console.error(`Processed: ${rows.length} calls in ${elapsedSec.toFixed(1)}s`)
  console.error(`Errors: ${errors}`)
  console.error(`Output saved: ${OUT_PATH}`)
  if (WRITE_BACK) {
    console.error(`Write-back: ${canWriteBack ? `${writtenBack} updated, ${writeBackErrors} failed` : "SKIPPED (no callType column)"}`)
  }
  console.error(`\nDistribution:`)
  const sorted = Object.entries(distribution).sort((a, b) => b[1] - a[1])
  for (const [type, count] of sorted) {
    const pct = ((count / rows.length) * 100).toFixed(0)
    console.error(`  ${type.padEnd(15)} ${String(count).padStart(4)}  (${pct}%)`)
  }
  console.error(`\nTokens: input=${totalInput.toLocaleString()} output=${totalOutput.toLocaleString()}`)
  console.error(
    `Estimated cost: $${costTotal.toFixed(4)} (input $${costInput.toFixed(4)} + output $${costOutput.toFixed(4)})`
  )
  if (rows.length > 0) {
    const perCall = costTotal / rows.length
    console.error(`Per call: $${perCall.toFixed(6)} → 1000 calls ≈ $${(perCall * 1000).toFixed(2)}`)
  }
}

main().catch((e) => {
  console.error(`[fatal] ${(e as Error).stack ?? e}`)
  process.exit(1)
})
