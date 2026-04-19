/**
 * Extract a JSONL batch of CallRecord rows for Whisper transcription.
 * Selective filter: duration >= MIN_DURATION (default 180s) + has dealId,
 * ordered by duration desc (longer calls = more signal for AI).
 *
 * Usage on server:
 *   docker run --rm --network smart-analyze_default -v /root/smart-analyze:/app -w /app \
 *     node:22-slim sh -c 'set -a && . /app/.env && set +a && \
 *       ./node_modules/.bin/tsx scripts/extract-audio-batch.ts <tenantName> <limit> > /tmp/batch.jsonl'
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const tenantName = process.argv[2]
const limit = Number(process.argv[3] ?? 300)
const minDuration = Number(process.env.MIN_DURATION ?? 180)

if (!tenantName) {
  console.error("Usage: extract-audio-batch.ts <tenantName> [limit]")
  process.exit(1)
}

async function main() {
  const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter: adapterPg })
  const tenant = await db.tenant.findFirst({ where: { name: tenantName } })
  if (!tenant) {
    console.error(`tenant not found: ${tenantName}`)
    process.exit(2)
  }

  // Sipuni-only for v1: stereo channels = perfect role split.
  // Gravitel/AICall blocked (auth/cert issues) — handle in v2.
  const onlySipuni = process.env.SIPUNI_ONLY !== "false"
  const maxDuration = Number(process.env.MAX_DURATION ?? 1200) // skip marathon calls
  const calls = await db.callRecord.findMany({
    where: {
      tenantId: tenant.id,
      audioUrl: onlySipuni
        ? { startsWith: "https://sipuni.com/" }
        : { not: null },
      dealId: { not: null },
      duration: { gte: minDuration, lte: maxDuration },
      transcript: null,
    },
    select: { id: true, audioUrl: true, duration: true },
    orderBy: { duration: "desc" },
    take: limit,
  })

  for (const c of calls) {
    process.stdout.write(
      JSON.stringify({
        id: c.id,
        url: c.audioUrl,
        dur: c.duration,
        tenant: tenantName,
      }) + "\n"
    )
  }
  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
