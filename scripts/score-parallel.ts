/**
 * Parallel score-all — chunks of 8 concurrent DeepSeek calls.
 * Skips already-scored. Diva ONLY (faster, no need to scan other tenants).
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { scoreCall } from "../src/lib/ai/score-call"

const TENANT_NAME = process.argv[2] ?? "diva-school"
const CONCURRENCY = Number(process.argv[3] ?? 8)

async function main() {
  const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter: adapterPg })
  const tenant = await db.tenant.findFirstOrThrow({ where: { name: TENANT_NAME } })

  const calls = await db.callRecord.findMany({
    where: {
      tenantId: tenant.id,
      transcript: { not: null },
      score: null,
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  })

  const total = calls.length
  console.log(`Scoring ${total} calls for ${TENANT_NAME} with concurrency=${CONCURRENCY}`)
  if (total === 0) {
    console.log("No calls to score (all done)")
    await db.$disconnect()
    return
  }

  const startedAt = Date.now()
  let scored = 0
  let failed = 0
  let lastReport = 0

  // Worker pool
  let cursor = 0
  async function worker() {
    while (true) {
      const i = cursor++
      if (i >= calls.length) return
      const call = calls[i]
      try {
        await scoreCall(call.id)
        scored++
      } catch (e) {
        const msg = (e as Error).message ?? String(e)
        if (/No active script/.test(msg)) {
          console.error(`[ABORT] No active script — seed first`)
          process.exit(1)
        }
        failed++
        if (failed < 5) console.error(`  fail ${call.id}: ${msg.slice(0, 80)}`)
      }
      const done = scored + failed
      if (done - lastReport >= 10) {
        lastReport = done
        const elapsed = (Date.now() - startedAt) / 1000
        const rate = done / elapsed
        const eta = ((total - done) / rate / 60).toFixed(1)
        console.log(`  [${done}/${total}] scored=${scored} failed=${failed} rate=${rate.toFixed(2)}/s ETA=${eta}m`)
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

  const elapsedMin = ((Date.now() - startedAt) / 1000 / 60).toFixed(1)
  console.log(`\n=== DONE in ${elapsedMin} min: scored=${scored} failed=${failed} ===`)
  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
