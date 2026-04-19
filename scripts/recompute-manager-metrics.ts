/**
 * Re-compute Manager analytics fields from raw Deal data.
 * After sync, Manager rows exist but totalDeals/successDeals/conversionRate/
 * avgDealValue/avgDealTime/talkRatio/avgResponseTime/status are all NULL,
 * so dashboards (ManagerRatingTable) show "одни нули". This script aggregates.
 *
 * Run on server:
 *   docker run --rm --network smart-analyze_default -v /root/smart-analyze:/app -w /app \
 *     node:22-slim sh -c 'set -a && . /app/.env && set +a && \
 *       ./node_modules/.bin/tsx scripts/recompute-manager-metrics.ts <tenantName>'
 *
 * Or for ALL tenants: omit tenantName.
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const tenantArg = process.argv[2] // optional

if (!process.env.DATABASE_URL) {
  console.error("Missing env: DATABASE_URL")
  process.exit(1)
}
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

interface DealRow {
  id: string
  managerId: string | null
  status: "OPEN" | "WON" | "LOST"
  amount: number | null
  duration: number | null  // hours
}

function classifyStatus(conversionRate: number, totalDeals: number) {
  if (totalDeals < 5) return null  // not enough data
  if (conversionRate >= 50) return "EXCELLENT"
  if (conversionRate >= 25) return "WATCH"
  return "CRITICAL"
}

async function recomputeForTenant(tenantId: string, tenantName: string) {
  console.log(`\n=== ${tenantName} (${tenantId}) ===`)

  const managers = await prisma.manager.findMany({
    where: { tenantId },
    select: { id: true, name: true },
  })
  console.log(`  ${managers.length} managers found`)

  let updated = 0
  for (const m of managers) {
    const deals = (await prisma.deal.findMany({
      where: { tenantId, managerId: m.id },
      select: { id: true, managerId: true, status: true, amount: true, duration: true },
    })) as DealRow[]

    const totalDeals = deals.length
    const won = deals.filter((d) => d.status === "WON")
    const lost = deals.filter((d) => d.status === "LOST")
    const closed = won.length + lost.length

    const conversionRate = closed > 0 ? (won.length / closed) * 100 : 0
    const wonWithAmount = won.filter((d) => d.amount != null && d.amount > 0)
    const avgDealValue =
      wonWithAmount.length > 0
        ? wonWithAmount.reduce((s, d) => s + (d.amount ?? 0), 0) / wonWithAmount.length
        : 0
    const closedWithDur = [...won, ...lost].filter((d) => d.duration != null)
    const avgDealTime =
      closedWithDur.length > 0
        ? closedWithDur.reduce((s, d) => s + (d.duration ?? 0), 0) / closedWithDur.length
        : 0
    const status = classifyStatus(conversionRate, totalDeals)

    await prisma.manager.update({
      where: { id: m.id },
      data: {
        totalDeals,
        successDeals: won.length,
        conversionRate: Math.round(conversionRate * 10) / 10,
        avgDealValue: Math.round(avgDealValue),
        avgDealTime: Math.round(avgDealTime * 10) / 10,
        // talkRatio + avgResponseTime — оставляем null, считаются Phase 2 на звонках
        status,
      },
    })
    updated++
    if (totalDeals > 0) {
      console.log(
        `  ${m.name.padEnd(30)} deals=${String(totalDeals).padStart(4)} won=${String(won.length).padStart(4)} ` +
          `conv=${conversionRate.toFixed(1).padStart(5)}% avgₚ=${avgDealValue.toFixed(0).padStart(8)}₽ ` +
          `avgₜ=${avgDealTime.toFixed(0).padStart(4)}h status=${status ?? "-"}`
      )
    }
  }
  console.log(`  → updated ${updated} managers`)
}

async function main() {
  const tenants = tenantArg
    ? await prisma.tenant.findMany({ where: { name: tenantArg } })
    : await prisma.tenant.findMany({
        where: { name: { in: ["reklamalift74", "vastu", "diva-school"] } },
      })

  if (tenants.length === 0) {
    console.error(`No tenants found ${tenantArg ? `(filter=${tenantArg})` : ""}`)
    process.exit(1)
  }

  for (const t of tenants) {
    await recomputeForTenant(t.id, t.name)
  }
  console.log("\nDone.")
}

main()
  .catch((e) => { console.error("FAILED:", e); process.exit(1) })
  .finally(() => prisma.$disconnect())
