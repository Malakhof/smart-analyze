/**
 * Re-run scoreCall on already-scored calls to add category + tags
 * (for calls scored before category/tags extraction was added).
 *
 * Idempotent: skips calls already having category set.
 *
 * Usage:
 *   docker run --rm --network smart-analyze_default -v /root/smart-analyze:/app -w /app \
 *     node:22-slim sh -c 'set -a && . /app/.env && set +a && \
 *       ./node_modules/.bin/tsx scripts/recategorize-scored-calls.ts'
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { scoreCall } from "../src/lib/ai/score-call"

async function main() {
  const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter: adapterPg })

  const calls = await db.callRecord.findMany({
    where: {
      transcript: { not: null },
      category: null,
      score: { isNot: null }, // already scored — just need cat+tags
    },
    select: { id: true, tenantId: true },
    orderBy: { createdAt: "desc" },
  })

  console.log(`recategorizing ${calls.length} already-scored calls`)
  let ok = 0
  let fail = 0
  for (const [i, call] of calls.entries()) {
    try {
      await scoreCall(call.id)
      ok++
    } catch (e) {
      fail++
      console.error(`[${i + 1}] ${call.id}: ${(e as Error).message.slice(0, 80)}`)
    }
    if ((i + 1) % 20 === 0) {
      console.log(`[${i + 1}/${calls.length}] ok=${ok} fail=${fail}`)
    }
  }
  console.log(`\nDONE: ok=${ok} fail=${fail}`)
  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
