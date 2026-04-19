/**
 * Apply Whisper transcripts back to CallRecord.
 * Reads JSONL with {id, transcript, language, ...} per line,
 * UPDATEs CallRecord SET transcript = ... WHERE id = ...
 *
 * Usage on server:
 *   docker run --rm --network smart-analyze_default -v /root/smart-analyze:/app -w /app \
 *     node:22-slim sh -c 'set -a && . /app/.env && set +a && \
 *       ./node_modules/.bin/tsx scripts/apply-transcripts.ts /tmp/results.jsonl'
 */
import { readFileSync } from "node:fs"
import { PrismaClient } from "../src/generated/prisma/client"

const inputPath = process.argv[2]
if (!inputPath) {
  console.error("Usage: apply-transcripts.ts <results.jsonl>")
  process.exit(1)
}

interface Row {
  id: string
  transcript?: string
  error?: string
  language?: string
  duration?: number
}

async function main() {
  const db = new PrismaClient()
  const lines = readFileSync(inputPath, "utf-8").split("\n").filter(Boolean)
  const rows: Row[] = lines.map((l) => JSON.parse(l) as Row)

  let applied = 0
  let skipped = 0
  let failed = 0

  for (const r of rows) {
    if (r.error || !r.transcript || r.transcript.length < 5) {
      skipped++
      continue
    }
    try {
      await db.callRecord.update({
        where: { id: r.id },
        data: { transcript: r.transcript },
      })
      applied++
    } catch (e) {
      console.error(`update failed for ${r.id}:`, (e as Error).message)
      failed++
    }
  }
  console.log(
    `applied=${applied} skipped=${skipped} failed=${failed} of ${rows.length}`
  )
  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
