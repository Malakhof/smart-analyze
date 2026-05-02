/**
 * Score diva-school CallRecord transcripts against the 11-stage sales script
 * using DeepSeek. READ-ONLY by default. Writes results to JSONL on stdout
 * and to /tmp/tuning/script-scores-diva.jsonl.
 *
 * The CallRecord model does NOT currently have `scriptScore` / `scriptDetails`
 * columns (see prisma/schema.prisma). With --write-back the script will probe
 * for these columns at runtime and only attempt the UPDATE if they exist;
 * otherwise it emits a single warning and continues read-only. No migrations.
 *
 * Usage (local, env-loaded):
 *   set -a && . ./.env && set +a && \
 *     ./node_modules/.bin/tsx scripts/score-diva-script-compliance.ts --limit=10
 *
 * Server (matches other diva scripts in this repo):
 *   docker run --rm --network smart-analyze_default -v /root/smart-analyze:/app -w /app \
 *     node:22-slim sh -c 'set -a && . /app/.env && set +a && \
 *       ./node_modules/.bin/tsx scripts/score-diva-script-compliance.ts --limit=10'
 *
 * Flags:
 *   --limit=N         max transcripts to score (default 10)
 *   --write-back      attempt UPDATE CallRecord.scriptScore/scriptDetails
 *   --rescore         do not skip rows already scored (only meaningful with --write-back)
 *   --tenant=NAME     override tenant name (default diva-school)
 *   --script=PATH     override path to sales-script markdown
 *   --concurrency=N   parallel DeepSeek requests (default 3)
 */
import { promises as fs } from "node:fs"
import path from "node:path"
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { ai, AI_MODEL } from "../src/lib/ai/client"

// ----------------------------- Args -----------------------------
function parseArgs() {
  const args = process.argv.slice(2)
  const out = {
    limit: 10,
    writeBack: false,
    rescore: false,
    tenant: "diva-school",
    scriptPath: process.env.DIVA_SALES_SCRIPT_PATH
      ?? path.resolve(process.cwd(), "docs/demo/2026-04-22-diva-sales-script.md"),
    concurrency: 3,
    // --uuids=u1,u2,...  Worker passes its just-transcribed batch.
    uuids: null as string[] | null,
  }
  for (const a of args) {
    if (a.startsWith("--limit=")) out.limit = Number(a.slice("--limit=".length))
    else if (a === "--write-back") out.writeBack = true
    else if (a === "--rescore") out.rescore = true
    else if (a.startsWith("--tenant=")) out.tenant = a.slice("--tenant=".length)
    else if (a.startsWith("--script=")) out.scriptPath = a.slice("--script=".length)
    else if (a.startsWith("--uuids=")) out.uuids = a.slice("--uuids=".length).split(",").map((s) => s.trim()).filter(Boolean)
    else if (a.startsWith("--concurrency="))
      out.concurrency = Math.max(1, Number(a.slice("--concurrency=".length)))
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: score-diva-script-compliance.ts [--limit=N] [--write-back] [--rescore] [--tenant=NAME] [--script=PATH] [--concurrency=N] [--uuids=u1,u2,...]",
      )
      process.exit(0)
    }
  }
  if (!Number.isFinite(out.limit) || out.limit <= 0) out.limit = 10
  return out
}

const ARGS = parseArgs()

// ----------------------------- Constants -----------------------------
const STAGE_NAMES = [
  "Приветствие",
  "Причина звонка",
  "Программирование",
  "Квалификация / выявление потребностей",
  "Вбивание крюка / диагностика",
  "Презентация через потребности",
  "Работа с возражениями",
  "Закрытие сделки (попытка сделки)",
  "Взятие обязательств / следующий шаг",
  "Ответы на вопросы",
  "Прощание",
] as const

const OUT_PATH = "/tmp/tuning/script-scores-diva.jsonl"

// DeepSeek public pricing (USD per 1M tokens, deepseek-chat).
// Used only to print a rough cost estimate — do not rely on for billing.
const DS_INPUT_USD_PER_MTOK = 0.27
const DS_OUTPUT_USD_PER_MTOK = 1.1

// ----------------------------- Types -----------------------------
interface StageScore {
  n: number
  name: string
  score: 0 | 1 | 2
  evidence: string
}
interface ComplianceResult {
  stages: StageScore[]
  total: number
  weak_stages: number[]
  strong_stages: number[]
  overall_quality: "high" | "medium" | "low"
  main_issues: string[]
}

// ----------------------------- Prompt builder -----------------------------
function buildSystemPrompt(scriptText: string): string {
  return `Ты оцениваешь соответствие звонка менеджера школы ДИВА скрипту продаж из 11 этапов.

ЭТАПЫ СКРИПТА:
${scriptText}

Для КАЖДОГО из 11 этапов оцени 0-2:
- 0 = пропущен полностью
- 1 = частично выполнен
- 2 = выполнен качественно

Выводи ТОЛЬКО валидный JSON без markdown-обёртки:
{
  "stages": [
    {"n": 1, "name": "Приветствие", "score": 2, "evidence": "цитата 1-2 предложения"},
    {"n": 2, "name": "Причина звонка", "score": 1, "evidence": "..."},
    {"n": 3, "name": "Программирование", "score": 0, "evidence": "..."},
    {"n": 4, "name": "Квалификация / выявление потребностей", "score": 2, "evidence": "..."},
    {"n": 5, "name": "Вбивание крюка / диагностика", "score": 1, "evidence": "..."},
    {"n": 6, "name": "Презентация через потребности", "score": 2, "evidence": "..."},
    {"n": 7, "name": "Работа с возражениями", "score": 1, "evidence": "..."},
    {"n": 8, "name": "Закрытие сделки (попытка сделки)", "score": 0, "evidence": "..."},
    {"n": 9, "name": "Взятие обязательств / следующий шаг", "score": 0, "evidence": "..."},
    {"n": 10, "name": "Ответы на вопросы", "score": 1, "evidence": "..."},
    {"n": 11, "name": "Прощание", "score": 2, "evidence": "..."}
  ],
  "total": 12,
  "weak_stages": [3, 8, 9],
  "strong_stages": [1, 4, 6, 11],
  "overall_quality": "medium",
  "main_issues": ["менеджер не запрограммировал звонок", "нет попытки сделки", "не назначен следующий шаг"]
}

Правила:
- "total" = сумма score всех 11 этапов (целое 0-22).
- "weak_stages" — все этапы со score=0.
- "strong_stages" — все этапы со score=2.
- "overall_quality": high (total >= 16), medium (8-15), low (<= 7).
- "main_issues" — максимум 3 коротких пункта про конкретные ошибки менеджера.
- "evidence" — короткая (1-2 предложения) цитата из транскрипта или короткое объяснение, если этап явно отсутствует.`
}

// ----------------------------- DeepSeek call -----------------------------
async function scoreOne(
  systemPrompt: string,
  transcript: string,
): Promise<{
  result: ComplianceResult
  inputTokens: number
  outputTokens: number
}> {
  // Hard-cap transcript length to keep prompt sane and DeepSeek happy.
  // ~32k chars ≈ ~10k Russian tokens — comfortable headroom for deepseek-chat.
  const trimmed =
    transcript.length > 32000
      ? transcript.slice(0, 32000) + "\n\n[...транскрипт обрезан...]"
      : transcript

  const response = await ai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `ТРАНСКРИПЦИЯ:\n${trimmed}` },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
  })

  const content = response.choices[0]?.message?.content
  if (!content) throw new Error("Empty AI response")

  const parsed = JSON.parse(content) as ComplianceResult

  // Light sanity-fix: ensure 11 stages, clamp scores 0..2, recompute totals.
  if (!Array.isArray(parsed.stages) || parsed.stages.length !== 11) {
    throw new Error(
      `Bad model output: expected 11 stages, got ${parsed.stages?.length ?? 0}`,
    )
  }
  for (const s of parsed.stages) {
    s.score = (Math.max(0, Math.min(2, Math.round(Number(s.score)))) as 0 | 1 | 2) ?? 0
    s.name ||= STAGE_NAMES[s.n - 1] ?? ""
    s.evidence ||= ""
  }
  const total = parsed.stages.reduce((a, s) => a + s.score, 0)
  parsed.total = total
  parsed.weak_stages = parsed.stages.filter((s) => s.score === 0).map((s) => s.n)
  parsed.strong_stages = parsed.stages.filter((s) => s.score === 2).map((s) => s.n)
  if (!parsed.overall_quality)
    parsed.overall_quality = total >= 16 ? "high" : total <= 7 ? "low" : "medium"
  if (!Array.isArray(parsed.main_issues)) parsed.main_issues = []

  return {
    result: parsed,
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
  }
}

// ----------------------------- Concurrency helper -----------------------------
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

// ----------------------------- Main -----------------------------
async function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("DEEPSEEK_API_KEY is not set")
    process.exit(1)
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set")
    process.exit(1)
  }

  const scriptText = await fs.readFile(ARGS.scriptPath, "utf8")
  const systemPrompt = buildSystemPrompt(scriptText)

  const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter: adapterPg })

  // 1. Resolve tenant
  const tenant = await db.tenant.findFirst({ where: { name: ARGS.tenant } })
  if (!tenant) {
    console.error(`Tenant not found: ${ARGS.tenant}`)
    await db.$disconnect()
    process.exit(2)
  }

  // 2. Probe optional columns for --write-back
  let canWriteBack = false
  if (ARGS.writeBack) {
    const cols = (await db.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'CallRecord' AND column_name IN ('scriptScore', 'scriptDetails')`,
    )) as { column_name: string }[]
    const names = new Set(cols.map((c) => c.column_name))
    canWriteBack = names.has("scriptScore") && names.has("scriptDetails")
    if (!canWriteBack) {
      console.warn(
        "[warn] --write-back requested but CallRecord.scriptScore / scriptDetails columns are missing. Skipping write-back. (No migration will be created.)",
      )
    }
  }

  // 3. Fetch candidate calls. We do NOT touch existing CallScore (different model).
  // "Already scored" for THIS pipeline means scriptScore IS NOT NULL — only checked
  // if the column exists. Otherwise we just take the most recent N.
  let alreadyScoredIds = new Set<string>()
  if (canWriteBack && !ARGS.rescore) {
    const rows = (await db.$queryRawUnsafe(
      `SELECT id FROM "CallRecord"
        WHERE "tenantId" = $1 AND "scriptScore" IS NOT NULL`,
      tenant.id,
    )) as { id: string }[]
    alreadyScoredIds = new Set(rows.map((r) => r.id))
  }

  // --uuids: process EXACTLY these pbxUuid rows (worker batch). Otherwise
  // legacy "newest unscored up to LIMIT" — only for ad-hoc CLI use.
  const candidates = ARGS.uuids
    ? await db.callRecord.findMany({
        where: {
          tenantId: tenant.id,
          pbxUuid: { in: ARGS.uuids },
          transcript: { not: null },
          // Idempotency: skip already-scored unless --rescore.
          ...(!ARGS.rescore && alreadyScoredIds.size > 0 ? { id: { notIn: [...alreadyScoredIds] } } : {}),
        },
        select: { id: true, duration: true, transcript: true, managerId: true },
      })
    : await db.callRecord.findMany({
        where: {
          tenantId: tenant.id,
          transcript: { not: null },
          duration: { gt: 60 },
          ...(alreadyScoredIds.size > 0 ? { id: { notIn: [...alreadyScoredIds] } } : {}),
        },
        select: { id: true, duration: true, transcript: true, managerId: true },
        orderBy: { createdAt: "desc" },
        take: ARGS.limit,
      })

  if (candidates.length === 0) {
    console.error(`No eligible calls for tenant ${ARGS.tenant}`)
    await db.$disconnect()
    return
  }

  console.error(
    `[info] Tenant ${ARGS.tenant} (${tenant.id}): scoring ${candidates.length} calls (concurrency=${ARGS.concurrency})`,
  )

  // 4. Ensure output dir exists
  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true })
  const outFh = await fs.open(OUT_PATH, "w")

  // 5. Score with limited concurrency
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let failed = 0
  const successes: { id: string; total: number; result: ComplianceResult }[] = []

  await mapPool(candidates, ARGS.concurrency, async (call, i) => {
    const tag = `[${i + 1}/${candidates.length}] ${call.id}`
    try {
      const { result, inputTokens, outputTokens } = await scoreOne(
        systemPrompt,
        call.transcript ?? "",
      )
      totalInputTokens += inputTokens
      totalOutputTokens += outputTokens
      successes.push({ id: call.id, total: result.total, result })

      const line =
        JSON.stringify({
          id: call.id,
          managerId: call.managerId,
          duration: call.duration,
          score: result.total,
          breakdown: result,
        }) + "\n"
      await outFh.write(line)
      process.stdout.write(line)

      if (canWriteBack) {
        await db.$executeRawUnsafe(
          `UPDATE "CallRecord" SET "scriptScore" = $1, "scriptDetails" = $2::jsonb WHERE id = $3`,
          result.total,
          JSON.stringify(result),
          call.id,
        )
      }

      console.error(
        `${tag} total=${result.total}/22 q=${result.overall_quality} weak=[${result.weak_stages.join(",")}]`,
      )
    } catch (e) {
      failed++
      console.error(`${tag} FAILED: ${(e as Error).message.slice(0, 200)}`)
    }
  })

  await outFh.close()

  // 6. Stats
  const buckets = { "0-5": 0, "6-12": 0, "13-18": 0, "19-22": 0 }
  const stageWeak = new Array(11).fill(0)
  const stageStrong = new Array(11).fill(0)
  for (const s of successes) {
    const t = s.total
    if (t <= 5) buckets["0-5"]++
    else if (t <= 12) buckets["6-12"]++
    else if (t <= 18) buckets["13-18"]++
    else buckets["19-22"]++
    for (const n of s.result.weak_stages) if (n >= 1 && n <= 11) stageWeak[n - 1]++
    for (const n of s.result.strong_stages) if (n >= 1 && n <= 11) stageStrong[n - 1]++
  }

  const ranked = (counts: number[]) =>
    counts
      .map((c, i) => ({ stage: i + 1, name: STAGE_NAMES[i], count: c }))
      .sort((a, b) => b.count - a.count)
      .filter((r) => r.count > 0)

  const avg =
    successes.length > 0
      ? successes.reduce((a, s) => a + s.total, 0) / successes.length
      : 0

  // Cost estimate (USD)
  const costUsd =
    (totalInputTokens / 1_000_000) * DS_INPUT_USD_PER_MTOK +
    (totalOutputTokens / 1_000_000) * DS_OUTPUT_USD_PER_MTOK

  console.error("\n=== STATS ===")
  console.error(`Scored: ${successes.length} / ${candidates.length}  (failed: ${failed})`)
  console.error(`Avg score: ${avg.toFixed(2)} / 22`)
  console.error(`Distribution:`)
  console.error(`  0-5  (low):    ${buckets["0-5"]}`)
  console.error(`  6-12 (medium): ${buckets["6-12"]}`)
  console.error(`  13-18 (good):  ${buckets["13-18"]}`)
  console.error(`  19-22 (high):  ${buckets["19-22"]}`)
  console.error(`Top weak stages (most often pропущены):`)
  for (const r of ranked(stageWeak).slice(0, 5))
    console.error(`  #${r.stage} ${r.name}: ${r.count}`)
  console.error(`Top strong stages (most often качественно):`)
  for (const r of ranked(stageStrong).slice(0, 5))
    console.error(`  #${r.stage} ${r.name}: ${r.count}`)
  console.error(
    `Tokens: in=${totalInputTokens}  out=${totalOutputTokens}  est cost: $${costUsd.toFixed(4)} USD ` +
      `(deepseek-chat @ $${DS_INPUT_USD_PER_MTOK}/$${DS_OUTPUT_USD_PER_MTOK} per 1M tok)`,
  )
  console.error(`Output file: ${OUT_PATH}`)
  if (ARGS.writeBack && !canWriteBack) {
    console.error(
      `[note] --write-back was a no-op: add columns "scriptScore Int?" and "scriptDetails Json?" to CallRecord and migrate, then re-run.`,
    )
  }

  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
