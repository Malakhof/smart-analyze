/**
 * Repair ASR transcripts using DeepSeek + per-tenant glossary.
 *
 * Whisper makes domain-specific errors. We use the LLM to PRESERVE
 * the original meaning while fixing obvious ASR errors based on a
 * product/people/known-error glossary.
 *
 * IMPORTANT: this is REPAIR, not REWRITE. We refuse output that drifts
 * too far from the original (>5% character delta) and keep originals.
 *
 * Usage on server (read-only):
 *   docker run --rm --network smart-analyze_default -v /root/smart-analyze:/app -w /app \
 *     node:22-slim sh -c 'set -a && . /app/.env && set +a && \
 *       ./node_modules/.bin/tsx scripts/repair-transcripts.ts \
 *         --tenant=vastu --limit=5'
 *
 *   ./node_modules/.bin/tsx scripts/repair-transcripts.ts --tenant=all --limit=10
 *
 * Optional flags:
 *   --tenant=<name|all>          (default: all known glossary tenants)
 *   --limit=<N>                  (default: 10) — per tenant
 *   --write-back                 — UPDATE CallRecord.transcriptRepaired
 *                                   if the column exists (no migration here);
 *                                   skipped silently otherwise.
 *   --out=/tmp/tuning/...jsonl   (default: /tmp/tuning/repaired-transcripts.jsonl)
 *
 * Output JSONL: { id, tenant, original_transcript, repaired_transcript,
 *                 changes_count, char_delta_pct, suspicious }
 */
import { writeFileSync, appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { ai, AI_MODEL } from "../src/lib/ai/client"

// -------- CLI --------
function getArg(name: string, fallback?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (hit) return hit.slice(name.length + 3)
  if (process.argv.includes(`--${name}`)) return "true"
  return fallback
}

const TENANT_ARG = getArg("tenant", "all")!
const LIMIT = Number(getArg("limit", "10"))
const WRITE_BACK = getArg("write-back") === "true"
const OUT_PATH = getArg("out", "/tmp/tuning/repaired-transcripts.jsonl")!
// --uuids=u1,u2,...  When set, EXACTLY these CallRecord.pbxUuid rows are
// processed (no SELECT ... LIMIT 10 newest unscored guess). Worker passes
// the batch it just transcribed — this is the only way to guarantee that
// repair touches the rows we expect (canon-call-record-states).
const UUIDS_ARG = getArg("uuids")

// -------- Glossary --------
type Glossary = {
  products: string[]
  people: string[]
  common_errors: Record<string, string>
}

// Tenant key here matches Tenant.name in the DB.
const GLOSSARY: Record<string, { display: string; glossary: Glossary }> = {
  vastu: {
    display: "vastu",
    glossary: {
      products: ["Васту", "Гуру", "Звёздный", "стипендия"],
      people: ["Юлия", "Светлана", "Наталья", "Юли Морозовой"],
      common_errors: {
        Буру: "Гуру",
        гору: "Гуру",
        Васт: "Васту",
        "Васьту": "Васту",
      },
    },
  },
  "diva-school": {
    display: "diva-school",
    glossary: {
      products: [
        "месяц зивы",
        "клуб",
        "диагностика осанки",
        "индивидуальная программа",
      ],
      people: ["Ирина", "Дива", "Довгалева", "Довголева"],
      common_errors: {
        "месяц Киева": "месяц зивы",
        "месяц пива": "месяц зивы",
        "В контакте": "ВКонтакте",
      },
    },
  },
}

// -------- Prompt builder --------
function buildPrompt(
  tenantName: string,
  glossary: Glossary,
  transcript: string,
): string {
  const errorsList =
    Object.entries(glossary.common_errors)
      .map(([wrong, right]) => `  «${wrong}» → «${right}»`)
      .join("\n") || "  (нет)"
  return `Ты исправляешь ASR-ошибки в транскрипции телефонного звонка, используя словарь продукта.

КЛИЕНТ: ${tenantName}
СЛОВАРЬ:
- Продукты: ${glossary.products.join(", ")}
- Люди: ${glossary.people.join(", ")}
- Известные ошибки ASR:
${errorsList}

ПРАВИЛА:
1. Исправляй ТОЛЬКО ошибки связанные с продуктом/именами/терминами из словаря.
2. НЕ меняй смысл речи. НЕ добавляй новые слова. НЕ перефразируй. НЕ суммаризируй.
3. Сохраняй формат [SPEAKER MM:SS] timestamps без изменений, как и порядок строк.
4. Если слово неоднозначно — оставь оригинал.
5. Не сокращай и не удлиняй транскрипт. Каждой строке оригинала соответствует ровно одна строка результата.

ОРИГИНАЛ:
${transcript}

ИСПРАВЛЕНО (только транскрипт, без объяснений):`
}

// -------- Diff helpers --------
function lineDiffCount(a: string, b: string): number {
  const al = a.split("\n")
  const bl = b.split("\n")
  const max = Math.max(al.length, bl.length)
  let diff = 0
  for (let i = 0; i < max; i++) {
    if ((al[i] ?? "") !== (bl[i] ?? "")) diff++
  }
  return diff
}

function charDeltaPct(a: string, b: string): number {
  if (a.length === 0) return b.length === 0 ? 0 : 100
  return (Math.abs(a.length - b.length) / a.length) * 100
}

// Light Levenshtein-ish character delta on top of length delta — if length is
// close but content shifted a lot, still flag. Uses a cheap word-set diff.
function wordSetDeltaPct(a: string, b: string): number {
  const tok = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean)
  const wa = tok(a)
  const wb = tok(b)
  if (wa.length === 0) return wb.length === 0 ? 0 : 100
  const setA = new Map<string, number>()
  for (const w of wa) setA.set(w, (setA.get(w) ?? 0) + 1)
  let common = 0
  for (const w of wb) {
    const c = setA.get(w) ?? 0
    if (c > 0) {
      common++
      setA.set(w, c - 1)
    }
  }
  const changed = Math.max(wa.length, wb.length) - common
  return (changed / Math.max(wa.length, wb.length)) * 100
}

// -------- Top corrections aggregator --------
function diffTopCorrections(
  original: string,
  repaired: string,
  bag: Map<string, number>,
) {
  const ol = original.split("\n")
  const rl = repaired.split("\n")
  const max = Math.min(ol.length, rl.length)
  for (let i = 0; i < max; i++) {
    if (ol[i] === rl[i]) continue
    // Word-level alignment within the line — naive but useful.
    const ow = ol[i].split(/(\s+)/)
    const rw = rl[i].split(/(\s+)/)
    const len = Math.min(ow.length, rw.length)
    for (let j = 0; j < len; j++) {
      if (ow[j] !== rw[j] && ow[j].trim() && rw[j].trim()) {
        const key = `«${ow[j]}» → «${rw[j]}»`
        bag.set(key, (bag.get(key) ?? 0) + 1)
      }
    }
  }
}

// -------- Main --------
async function main() {
  // Ensure output directory exists.
  mkdirSync(dirname(OUT_PATH), { recursive: true })
  // Truncate output file at the start of a run.
  writeFileSync(OUT_PATH, "")

  const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter: adapterPg })

  const tenantsToProcess =
    TENANT_ARG === "all" ? Object.keys(GLOSSARY) : [TENANT_ARG]

  // Sanity-check.
  for (const name of tenantsToProcess) {
    if (!GLOSSARY[name]) {
      console.error(`ERROR: no glossary for tenant "${name}". Known: ${Object.keys(GLOSSARY).join(", ")}`)
      process.exit(2)
    }
  }

  // Probe schema for transcriptRepaired column once (cheap).
  let hasRepairedCol = false
  if (WRITE_BACK) {
    const rows = await db.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'CallRecord'
           AND column_name = 'transcriptRepaired'
       ) as exists`,
    )
    hasRepairedCol = !!rows[0]?.exists
    if (!hasRepairedCol) {
      console.warn(
        "[write-back] CallRecord.transcriptRepaired column not found — write-back will be skipped (no migration here).",
      )
    }
  }

  const totals = {
    processed: 0,
    suspicious: 0,
    written: 0,
    failed: 0,
    totalChanges: 0,
  }
  const corrections = new Map<string, number>()

  for (const tenantName of tenantsToProcess) {
    const cfg = GLOSSARY[tenantName]
    const tenant = await db.tenant.findFirst({ where: { name: tenantName } })
    if (!tenant) {
      console.warn(`[${tenantName}] tenant not found in DB — skipping`)
      continue
    }

    // --uuids takes precedence: exactly these pbxUuid rows. Otherwise legacy
    // behaviour (newest unrepaired transcripts up to LIMIT). The worker MUST
    // use --uuids; legacy SELECT is left only for ad-hoc CLI runs.
    const uuidList = UUIDS_ARG ? UUIDS_ARG.split(",").map((s) => s.trim()).filter(Boolean) : null
    const calls = uuidList
      ? await db.callRecord.findMany({
          where: { tenantId: tenant.id, pbxUuid: { in: uuidList }, transcript: { not: null } },
          select: { id: true, transcript: true, transcriptRepaired: true },
        })
      : await db.callRecord.findMany({
          where: { tenantId: tenant.id, transcript: { not: null } },
          orderBy: { createdAt: "desc" },
          take: LIMIT,
          select: { id: true, transcript: true, transcriptRepaired: true },
        })

    console.log(
      `\n=== ${tenantName} (tenantId=${tenant.id}) — picked ${calls.length} call(s) ===`,
    )

    for (const call of calls) {
      const original = (call.transcript ?? "").trim()
      if (!original) continue
      // Idempotency: skip rows that already have a non-suspicious repaired
      // transcript. Worker may re-call this on retry — we don't want to
      // re-pay DeepSeek + re-roll the dice on suspicious=true filter.
      if (call.transcriptRepaired && call.transcriptRepaired.length > 5) continue

      const prompt = buildPrompt(cfg.display, cfg.glossary, original)
      let repaired = ""
      try {
        const resp = await ai.chat.completions.create({
          model: AI_MODEL,
          messages: [
            {
              role: "system",
              content:
                "Ты строгий редактор ASR. Возвращаешь ТОЛЬКО исправленный транскрипт. Не добавляешь префиксов, не объясняешь, не перефразируешь.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0,
        })
        repaired = (resp.choices[0]?.message?.content ?? "").trim()
      } catch (e) {
        console.error(`  [${call.id}] DeepSeek error: ${(e as Error).message}`)
        totals.failed++
        continue
      }

      if (!repaired) {
        totals.failed++
        continue
      }

      // Strip a possible code-fence the model might wrap things in.
      repaired = repaired
        .replace(/^```[\w-]*\n?/m, "")
        .replace(/\n?```\s*$/m, "")
        .trim()

      const changes = lineDiffCount(original, repaired)
      const charPct = charDeltaPct(original, repaired)
      const wordPct = wordSetDeltaPct(original, repaired)
      const suspicious = charPct > 5 || wordPct > 10

      if (!suspicious) {
        diffTopCorrections(original, repaired, corrections)
      }

      totals.processed++
      totals.totalChanges += changes
      if (suspicious) totals.suspicious++

      const out = {
        id: call.id,
        tenant: tenantName,
        original_transcript: original,
        repaired_transcript: repaired,
        changes_count: changes,
        char_delta_pct: Number(charPct.toFixed(2)),
        word_delta_pct: Number(wordPct.toFixed(2)),
        suspicious,
      }
      appendFileSync(OUT_PATH, JSON.stringify(out) + "\n")

      console.log(
        `  [${call.id}] lines_changed=${changes} char_Δ=${charPct.toFixed(1)}% word_Δ=${wordPct.toFixed(1)}%${suspicious ? " ⚠ SUSPICIOUS" : ""}`,
      )

      if (WRITE_BACK && hasRepairedCol && !suspicious) {
        try {
          await db.$executeRawUnsafe(
            `UPDATE "CallRecord" SET "transcriptRepaired" = $1 WHERE "id" = $2`,
            repaired,
            call.id,
          )
          totals.written++
        } catch (e) {
          console.error(`    [write-back] failed: ${(e as Error).message}`)
        }
      }
    }
  }

  // -------- Stats --------
  const avgChanges =
    totals.processed > 0 ? totals.totalChanges / totals.processed : 0
  const top = Array.from(corrections.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)

  console.log(`\n=== SUMMARY ===`)
  console.log(`processed:        ${totals.processed}`)
  console.log(`failed:           ${totals.failed}`)
  console.log(`suspicious(>5%):  ${totals.suspicious}`)
  console.log(`avg lines changed:${avgChanges.toFixed(2)}`)
  if (WRITE_BACK) console.log(`written-back:     ${totals.written}`)
  console.log(`\nTop corrections:`)
  if (top.length === 0) {
    console.log("  (none — either no changes or all flagged suspicious)")
  } else {
    for (const [k, v] of top) console.log(`  ${v}× ${k}`)
  }
  console.log(`\nOutput: ${OUT_PATH}`)

  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
