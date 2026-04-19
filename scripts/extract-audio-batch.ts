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
  // GC fs[N].getcourse.ru also stereo + public-by-hash.
  // Gravitel/AICall blocked (auth/cert issues) — handle in v2.
  const audioFilter = process.env.AUDIO_FILTER ?? "sipuni" // sipuni | gc | any
  const maxDuration = Number(process.env.MAX_DURATION ?? 1200)
  const noDurationFilter = process.env.NO_DURATION_FILTER === "true"
  const requireDeal = process.env.REQUIRE_DEAL !== "false"
  const orderBy = process.env.ORDER_BY === "date" ? { createdAt: "desc" as const } : { duration: "desc" as const }

  let audioUrlWhere: { startsWith?: string; not?: null }
  if (audioFilter === "gc") {
    audioUrlWhere = { startsWith: "https://fs" }
  } else if (audioFilter === "any") {
    audioUrlWhere = { not: null }
  } else {
    audioUrlWhere = { startsWith: "https://sipuni.com/" }
  }

  const calls = await db.callRecord.findMany({
    where: {
      tenantId: tenant.id,
      audioUrl: audioUrlWhere,
      ...(requireDeal ? { dealId: { not: null } } : {}),
      ...(noDurationFilter
        ? {}
        : { duration: { gte: minDuration, lte: maxDuration } }),
      transcript: null,
    },
    select: { id: true, audioUrl: true, duration: true, direction: true },
    orderBy,
    take: limit,
  })

  for (const c of calls) {
    process.stdout.write(
      JSON.stringify({
        id: c.id,
        url: c.audioUrl,
        dur: c.duration,
        dir: c.direction,
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
