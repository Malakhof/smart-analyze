/**
 * Score all CallRecord with transcript using universal script per tenant.
 * Idempotent: skips already-scored calls (CallRecord.score != null).
 *
 * Usage:
 *   docker run --rm --network smart-analyze_default -v /root/smart-analyze:/app -w /app \
 *     node:22-slim sh -c 'set -a && . /app/.env && set +a && \
 *       ./node_modules/.bin/tsx scripts/score-all-calls.ts [tenantName|all] [limit]'
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { scoreCall } from "../src/lib/ai/score-call"

const target = process.argv[2] ?? "all"
const limit = process.argv[3] ? Number(process.argv[3]) : undefined

async function main() {
  const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter: adapterPg })

  const tenants =
    target === "all"
      ? await db.tenant.findMany({ orderBy: { name: "asc" } })
      : await db.tenant.findMany({ where: { name: target } })

  const startedAt = Date.now()
  const reports: { tenant: string; total: number; scored: number; failed: number }[] = []

  for (const tenant of tenants) {
    const calls = await db.callRecord.findMany({
      where: {
        tenantId: tenant.id,
        transcript: { not: null },
        score: null, // skip already scored
      },
      select: { id: true, duration: true },
      orderBy: { createdAt: "desc" },
      ...(limit ? { take: limit } : {}),
    })

    if (calls.length === 0) {
      console.log(`\n=== ${tenant.name}: no calls to score ===`)
      reports.push({ tenant: tenant.name, total: 0, scored: 0, failed: 0 })
      continue
    }

    console.log(`\n=== ${tenant.name}: scoring ${calls.length} calls ===`)
    let scored = 0
    let failed = 0
    for (const [i, call] of calls.entries()) {
      try {
        await scoreCall(call.id)
        scored++
      } catch (e) {
        const msg = (e as Error).message ?? String(e)
        if (/No active script/.test(msg)) {
          console.error(
            `\n[${tenant.name}] No script — run seed-universal-scripts.ts first. Aborting.`
          )
          break
        }
        failed++
        console.error(`  [${i + 1}/${calls.length}] failed: ${msg.slice(0, 100)}`)
      }
      if ((i + 1) % 10 === 0) {
        console.log(`  [${i + 1}/${calls.length}] scored=${scored} failed=${failed}`)
      }
    }
    reports.push({ tenant: tenant.name, total: calls.length, scored, failed })
  }

  console.log(
    `\n=== DONE (${((Date.now() - startedAt) / 1000 / 60).toFixed(1)} min) ===`
  )
  console.table(reports)

  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
