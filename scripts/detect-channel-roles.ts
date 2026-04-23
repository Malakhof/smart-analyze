/**
 * detect-channel-roles.ts — determine which stereo channel is МЕНЕДЖЕР vs КЛИЕНТ
 *
 * SalesGuru pipeline transcribes stereo phone calls (LEFT/RIGHT). For Sipuni and
 * other PBX providers, channel-to-role mapping varies per call (depends on which
 * agent/extension picks up). The current word-count heuristic ("more words ==
 * manager") only reaches ~77% accuracy. DeepSeek classifying first 30s of speech
 * per channel should reach ~99%.
 *
 * Inputs:
 *   - JSONL mode (PRIMARY): each line has `id` and `transcript_raw.left_segments`
 *     and `transcript_raw.right_segments`. Each segment is { start, end, text, ... }.
 *   - DB mode (STUB): not implemented — DB only has merged transcript, not raw
 *     per-channel segments. Use JSONL produced by transcription pipeline instead.
 *
 * Usage:
 *   tsx scripts/detect-channel-roles.ts --input=/tmp/tuning/results-30-v24.jsonl > /tmp/tuning/roles-detected.jsonl
 *   tsx scripts/detect-channel-roles.ts --input=/tmp/tuning/results-30-v24.jsonl --limit=10 --concurrency=5
 *
 * Output JSONL (one per call): {id, left_role, right_role, confidence, reason,
 *                               heuristic_left, heuristic_right, agrees_with_heuristic,
 *                               left_words, right_words, left_30s_chars, right_30s_chars}
 *
 * Constraints:
 *   - Standalone detector. Does NOT modify pipeline integration.
 *   - Does NOT update Prisma schema.
 *   - No commits.
 *
 * Cost: deepseek-chat ~$0.14 / 1M input tokens, ~$0.28 / 1M output tokens.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import OpenAI from "openai"

// --- CLI args ---------------------------------------------------------------

function parseArg(name: string, defaultVal?: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (arg) return arg.slice(name.length + 3)
  if (process.argv.includes(`--${name}`)) return "true"
  return defaultVal
}

const INPUT_PATH = parseArg("input")
const TENANT = parseArg("tenant")
const LIMIT = Number(parseArg("limit", "30"))
const CONCURRENCY = Number(parseArg("concurrency", "3"))
const WINDOW_S = Number(parseArg("window", "30"))
const OUT_PATH = parseArg("out", "/tmp/tuning/roles-detected.jsonl")!

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

// DeepSeek pricing (USD per 1M tokens, deepseek-chat as of 2026)
const PRICE_INPUT_PER_M = 0.14
const PRICE_OUTPUT_PER_M = 0.28

// --- Types ------------------------------------------------------------------

interface RawSegment {
  start: number
  end: number
  text: string
  label?: string // heuristic label assigned by transcription pipeline
}

interface CallInput {
  id: string
  leftSegments: RawSegment[]
  rightSegments: RawSegment[]
  // Heuristic role from existing pipeline (segment.label) — used for comparison only.
  heuristicLeftLabel?: string | null
  heuristicRightLabel?: string | null
  durationS?: number
}

type Role = "МЕНЕДЖЕР" | "КЛИЕНТ"

interface DetectResult {
  id: string
  left_role: Role | null
  right_role: Role | null
  confidence: number
  reason: string
  // Comparison vs word-count heuristic
  left_words: number
  right_words: number
  heuristic_left: Role
  heuristic_right: Role
  agrees_with_heuristic: boolean
  // Window stats
  left_30s_chars: number
  right_30s_chars: number
  // Bookkeeping
  inputTokens: number
  outputTokens: number
  error?: string
}

// --- Loaders ----------------------------------------------------------------

function loadFromJsonl(path: string, limit: number): CallInput[] {
  const text = readFileSync(path, "utf8")
  const rows: CallInput[] = []
  let lineNo = 0
  for (const raw of text.split("\n")) {
    lineNo++
    const line = raw.trim()
    if (!line) continue
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(line)
    } catch (e) {
      console.error(`[skip] line ${lineNo}: bad JSON (${(e as Error).message.slice(0, 80)})`)
      continue
    }
    const tr = obj.transcript_raw as
      | { left_segments?: RawSegment[]; right_segments?: RawSegment[] }
      | undefined
    if (!tr || !Array.isArray(tr.left_segments) || !Array.isArray(tr.right_segments)) {
      // Skip rows lacking raw per-channel segments (e.g. failed transcripts).
      continue
    }
    const left = tr.left_segments
    const right = tr.right_segments
    const heuristicLeft = (left.find((s) => s.label)?.label ?? null) as string | null
    const heuristicRight = (right.find((s) => s.label)?.label ?? null) as string | null
    rows.push({
      id: String(obj.id ?? `line-${lineNo}`),
      leftSegments: left,
      rightSegments: right,
      heuristicLeftLabel: heuristicLeft,
      heuristicRightLabel: heuristicRight,
      durationS: typeof obj.duration === "number" ? (obj.duration as number) : undefined,
    })
    if (rows.length >= limit) break
  }
  return rows
}

// --- Helpers ----------------------------------------------------------------

function textInWindow(segs: RawSegment[], windowS: number): string {
  return segs
    .filter((s) => typeof s.start === "number" && s.start <= windowS)
    .map((s) => (typeof s.text === "string" ? s.text.trim() : ""))
    .filter(Boolean)
    .join(" ")
}

function totalWords(segs: RawSegment[]): number {
  let n = 0
  for (const s of segs) {
    if (typeof s.text === "string") {
      n += s.text.trim().split(/\s+/).filter(Boolean).length
    }
  }
  return n
}

const VALID_ROLES = new Set(["МЕНЕДЖЕР", "КЛИЕНТ"])

// --- Prompt -----------------------------------------------------------------

const SYSTEM_PROMPT = `Ты определяешь роли спикеров в телефонном звонке (sales call школы продаж).

Тебе дают первые 30 секунд речи каждого канала (LEFT и RIGHT) стерео-записи.
Каналы фиксированные (LEFT/RIGHT), но какой канал — менеджер, а какой — клиент,
зависит от записи (от того, какой sip-аккаунт принимает/инициирует звонок).

Определи роли по контенту:
- МЕНЕДЖЕР: представляется по имени и компании ("я звоню от Дива/Васту", "это Светлана, отдел заботы"),
  задаёт квалифицирующие вопросы, ведёт разговор, говорит по скрипту.
- КЛИЕНТ: отвечает "Алло"/"Да"/"Слушаю", реагирует на представление менеджера,
  задаёт уточняющие вопросы, иногда занят/не понимает.

Output ТОЛЬКО валидный JSON, без markdown, без комментариев:
{"left": "МЕНЕДЖЕР"|"КЛИЕНТ", "right": "МЕНЕДЖЕР"|"КЛИЕНТ", "confidence": 0-100, "reason": "одно предложение"}

Правила:
- Ровно одна сторона МЕНЕДЖЕР, другая КЛИЕНТ. Никогда обе одинаковые.
- Если данных мало (молчание, гудки, автоответ) — всё равно сделай лучшее предположение и выставь низкий confidence (<50).`

function buildUserPrompt(left30: string, right30: string): string {
  // Trim very long windows to keep prompt small. 30s of speech is rarely >2000 chars.
  const cap = 4000
  const L = left30.length > cap ? left30.slice(0, cap) + "…" : left30
  const R = right30.length > cap ? right30.slice(0, cap) + "…" : right30
  return `LEFT канал (первые 30 сек):
${L || "(пусто)"}

RIGHT канал (первые 30 сек):
${R || "(пусто)"}`
}

// --- One-call worker --------------------------------------------------------

async function detectOne(call: CallInput): Promise<DetectResult> {
  const left30 = textInWindow(call.leftSegments, WINDOW_S)
  const right30 = textInWindow(call.rightSegments, WINDOW_S)
  const lw = totalWords(call.leftSegments)
  const rw = totalWords(call.rightSegments)

  // Word-count heuristic: more words → МЕНЕДЖЕР
  const heuristicLeft: Role = lw >= rw ? "МЕНЕДЖЕР" : "КЛИЕНТ"
  const heuristicRight: Role = heuristicLeft === "МЕНЕДЖЕР" ? "КЛИЕНТ" : "МЕНЕДЖЕР"

  const baseShape = {
    id: call.id,
    left_words: lw,
    right_words: rw,
    heuristic_left: heuristicLeft,
    heuristic_right: heuristicRight,
    left_30s_chars: left30.length,
    right_30s_chars: right30.length,
  }

  // If both windows are empty, AI can't add value. Return a flagged result.
  if (left30.length === 0 && right30.length === 0) {
    return {
      ...baseShape,
      left_role: null,
      right_role: null,
      confidence: 0,
      reason: "Both 30s windows empty — no audible speech in first 30s.",
      agrees_with_heuristic: false,
      inputTokens: 0,
      outputTokens: 0,
      error: "empty_windows",
    }
  }

  try {
    const response = await ai.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(left30, right30) },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    })

    const content = response.choices[0]?.message?.content ?? ""
    const usage = response.usage
    const inputTokens = usage?.prompt_tokens ?? 0
    const outputTokens = usage?.completion_tokens ?? 0

    let parsed: { left?: string; right?: string; confidence?: number; reason?: string }
    try {
      parsed = JSON.parse(content)
    } catch {
      return {
        ...baseShape,
        left_role: null,
        right_role: null,
        confidence: 0,
        reason: `Bad JSON from model: ${content.slice(0, 200)}`,
        agrees_with_heuristic: false,
        inputTokens,
        outputTokens,
        error: "json_parse",
      }
    }

    const leftRoleRaw = (parsed.left ?? "").toString().trim().toUpperCase()
    const rightRoleRaw = (parsed.right ?? "").toString().trim().toUpperCase()

    if (!VALID_ROLES.has(leftRoleRaw) || !VALID_ROLES.has(rightRoleRaw)) {
      return {
        ...baseShape,
        left_role: null,
        right_role: null,
        confidence: 0,
        reason: `Invalid roles from model: left=${leftRoleRaw}, right=${rightRoleRaw}`,
        agrees_with_heuristic: false,
        inputTokens,
        outputTokens,
        error: "invalid_role",
      }
    }
    if (leftRoleRaw === rightRoleRaw) {
      return {
        ...baseShape,
        left_role: null,
        right_role: null,
        confidence: 0,
        reason: `Both channels labelled ${leftRoleRaw} — model violated constraint. Original reason: ${(parsed.reason ?? "").toString().slice(0, 200)}`,
        agrees_with_heuristic: false,
        inputTokens,
        outputTokens,
        error: "duplicate_role",
      }
    }

    const leftRole = leftRoleRaw as Role
    const rightRole = rightRoleRaw as Role
    const agrees = leftRole === heuristicLeft && rightRole === heuristicRight

    return {
      ...baseShape,
      left_role: leftRole,
      right_role: rightRole,
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence ?? 0))),
      reason: (parsed.reason ?? "").toString().slice(0, 500),
      agrees_with_heuristic: agrees,
      inputTokens,
      outputTokens,
    }
  } catch (e) {
    return {
      ...baseShape,
      left_role: null,
      right_role: null,
      confidence: 0,
      reason: (e as Error).message.slice(0, 300),
      agrees_with_heuristic: false,
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
  if (!INPUT_PATH && !TENANT) {
    console.error(
      "Usage: tsx scripts/detect-channel-roles.ts --input=/tmp/tuning/results-30-v24.jsonl [--limit=30] [--concurrency=3] [--out=/tmp/tuning/roles-detected.jsonl]\n" +
        "       (--tenant=NAME mode is a stub — DB has only merged transcript, not raw per-channel segments)"
    )
    process.exit(2)
  }
  if (TENANT && !INPUT_PATH) {
    console.error(
      `[stub] --tenant=${TENANT} mode is not implemented: production CallRecord stores merged transcript only,\n` +
        `       not raw per-channel segments. Re-transcribe through the offline pipeline that emits\n` +
        `       transcript_raw.{left,right}_segments JSONL, then pass --input=<path>.`
    )
    process.exit(3)
  }

  console.error(
    `[detect-channel-roles] input=${INPUT_PATH} limit=${LIMIT} concurrency=${CONCURRENCY} window=${WINDOW_S}s out=${OUT_PATH}`
  )

  const outDir = dirname(OUT_PATH)
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

  const calls = loadFromJsonl(INPUT_PATH!, LIMIT)
  console.error(`[load] ${calls.length} calls have transcript_raw with both channels`)
  if (calls.length === 0) {
    console.error("[done] nothing to classify")
    return
  }

  const t0 = Date.now()
  let totalInput = 0
  let totalOutput = 0
  let errors = 0
  let agreeCount = 0
  let evaluable = 0
  const lines: string[] = []
  const swapNeeded: string[] = []
  const disagreements: DetectResult[] = []
  const lowConfidence: DetectResult[] = []

  await runWithConcurrency(
    calls,
    (c) => detectOne(c),
    CONCURRENCY,
    (r, i) => {
      totalInput += r.inputTokens
      totalOutput += r.outputTokens
      if (r.error) errors++
      if (!r.error && r.left_role && r.right_role) {
        evaluable++
        if (r.agrees_with_heuristic) agreeCount++
        else disagreements.push(r)
        if (r.right_role === "МЕНЕДЖЕР") swapNeeded.push(r.id)
        if (r.confidence < 50) lowConfidence.push(r)
      }

      const out = {
        id: r.id,
        left_role: r.left_role,
        right_role: r.right_role,
        confidence: r.confidence,
        reason: r.reason,
        heuristic_left: r.heuristic_left,
        heuristic_right: r.heuristic_right,
        agrees_with_heuristic: r.agrees_with_heuristic,
        left_words: r.left_words,
        right_words: r.right_words,
        left_30s_chars: r.left_30s_chars,
        right_30s_chars: r.right_30s_chars,
        ...(r.error ? { error: r.error } : {}),
      }
      const line = JSON.stringify(out)
      process.stdout.write(line + "\n")
      lines.push(line)

      if ((i + 1) % 5 === 0 || i === calls.length - 1) {
        console.error(
          `  [${i + 1}/${calls.length}] tokens(in/out)=${totalInput}/${totalOutput} agree=${agreeCount}/${evaluable} errors=${errors}`
        )
      }
    }
  )

  writeFileSync(OUT_PATH, lines.join("\n") + "\n")

  const elapsedSec = (Date.now() - t0) / 1000
  const costInput = (totalInput / 1_000_000) * PRICE_INPUT_PER_M
  const costOutput = (totalOutput / 1_000_000) * PRICE_OUTPUT_PER_M
  const costTotal = costInput + costOutput

  const swapPct = evaluable ? ((swapNeeded.length / evaluable) * 100).toFixed(0) : "0"
  const agreePct = evaluable ? ((agreeCount / evaluable) * 100).toFixed(1) : "0"

  console.error(`\n=== SUMMARY ===`)
  console.error(`Processed: ${calls.length} calls in ${elapsedSec.toFixed(1)}s`)
  console.error(`Evaluable (AI returned valid pair): ${evaluable}`)
  console.error(`Errors: ${errors}`)
  console.error(`Output saved: ${OUT_PATH}`)

  console.error(`\nDistribution (LEFT canal role per AI):`)
  const leftMgr = lines.filter((l) => l.includes('"left_role":"МЕНЕДЖЕР"')).length
  const leftCli = lines.filter((l) => l.includes('"left_role":"КЛИЕНТ"')).length
  console.error(`  LEFT=МЕНЕДЖЕР: ${leftMgr} (no swap needed in pipeline)`)
  console.error(`  LEFT=КЛИЕНТ:   ${leftCli} (swap needed: ${swapPct}% of evaluable)`)

  console.error(`\nAgreement with word-count heuristic ("more words = manager"):`)
  console.error(`  Agree:    ${agreeCount}/${evaluable} (${agreePct}%)`)
  console.error(`  Disagree: ${disagreements.length} (flagged for manual check)`)
  if (disagreements.length > 0) {
    console.error(`\n  Disagreement IDs (heuristic vs AI):`)
    for (const d of disagreements) {
      console.error(
        `    ${d.id} | words L=${d.left_words}/R=${d.right_words} | heuristic L=${d.heuristic_left} | AI L=${d.left_role} (conf=${d.confidence}) — ${d.reason.slice(0, 90)}`
      )
    }
  }

  if (lowConfidence.length > 0) {
    console.error(`\nLow-confidence (<50) results — also worth manual check (${lowConfidence.length}):`)
    for (const d of lowConfidence) {
      console.error(`    ${d.id} | conf=${d.confidence} | L_chars=${d.left_30s_chars} R_chars=${d.right_30s_chars} — ${d.reason.slice(0, 90)}`)
    }
  }

  console.error(`\nTokens: input=${totalInput.toLocaleString()} output=${totalOutput.toLocaleString()}`)
  console.error(
    `Estimated cost: $${costTotal.toFixed(4)} (input $${costInput.toFixed(4)} + output $${costOutput.toFixed(4)})`
  )
  if (calls.length > 0) {
    const perCall = costTotal / calls.length
    console.error(`Per call: $${perCall.toFixed(6)} → 1000 calls ≈ $${(perCall * 1000).toFixed(2)}`)
  }
}

main().catch((e) => {
  console.error(`[fatal] ${(e as Error).stack ?? e}`)
  process.exit(1)
})
