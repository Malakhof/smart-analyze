/**
 * One-shot: sync ONLY GetCourse funnels + stages + dealstat snapshot for a tenant.
 * Used as follow-up if the main sync ran with stale Prisma client and skipped them.
 *
 * Run on server:
 *   docker run --rm --network smart-analyze_default -v /root/smart-analyze:/app -w /app \
 *     node:22-slim sh -c 'set -a && . /app/.env && set +a && \
 *       ./node_modules/.bin/tsx scripts/sync-gc-funnels-stat.ts diva-school'
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { decrypt } from "../src/lib/crypto"
import { GetCourseAdapter } from "../src/lib/crm/getcourse/adapter"

const tenantName = process.argv[2]
if (!tenantName) {
  console.error("Usage: tsx scripts/sync-gc-funnels-stat.ts <tenantName>")
  process.exit(1)
}
if (!process.env.DATABASE_URL || !process.env.ENCRYPTION_KEY) {
  console.error("Missing env: DATABASE_URL / ENCRYPTION_KEY")
  process.exit(1)
}

const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: adapterPg })

async function main() {
  const tenant = await prisma.tenant.findFirstOrThrow({ where: { name: tenantName } })
  const cfg = await prisma.crmConfig.findFirstOrThrow({
    where: { tenantId: tenant.id, provider: "GETCOURSE" },
  })

  if (!cfg.subdomain) throw new Error("CrmConfig.subdomain missing")
  if (!cfg.gcCookie) throw new Error("CrmConfig.gcCookie missing")

  const accountUrl = cfg.subdomain.includes(".")
    ? `https://${cfg.subdomain}`
    : `https://${cfg.subdomain}.getcourse.ru`
  const cookie = decrypt(cfg.gcCookie)
  const gc = new GetCourseAdapter(accountUrl, cookie)

  // ============== Funnels + stages
  console.log("\n=== Funnels + Stages ===")
  const funnels = await gc.getFunnels()
  console.log(`  ${funnels.length} funnels from GC`)

  let funnelsCreated = 0, funnelsUpdated = 0
  let stagesCreated = 0, stagesUpdated = 0

  for (const f of funnels) {
    const existing = await prisma.funnel.findFirst({
      where: { tenantId: tenant.id, crmId: f.id },
    })
    let dbFunnelId: string
    if (existing) {
      if (existing.name !== f.name) {
        await prisma.funnel.update({ where: { id: existing.id }, data: { name: f.name } })
      }
      dbFunnelId = existing.id
      funnelsUpdated++
    } else {
      const created = await prisma.funnel.create({
        data: { tenantId: tenant.id, crmId: f.id, name: f.name },
      })
      dbFunnelId = created.id
      funnelsCreated++
    }

    const stages = await gc.getFunnelStages(f.id)
    for (const s of stages) {
      const terminalKind = s.system === 2 ? "WON" : s.system === 1 ? "LOST" : null
      const existingStage = await prisma.funnelStage.findFirst({
        where: { funnelId: dbFunnelId, crmId: s.id },
      })
      const data = { name: s.name, order: s.position, terminalKind }
      if (existingStage) {
        if (
          existingStage.name !== s.name ||
          existingStage.order !== s.position ||
          existingStage.terminalKind !== terminalKind
        ) {
          await prisma.funnelStage.update({ where: { id: existingStage.id }, data })
        }
        stagesUpdated++
      } else {
        await prisma.funnelStage.create({
          data: { funnelId: dbFunnelId, crmId: s.id, ...data },
        })
        stagesCreated++
      }
    }
    console.log(`  [${f.id}] ${f.name}: ${stages.length} stages`)
  }
  console.log(`  → funnels created=${funnelsCreated} updated=${funnelsUpdated}`)
  console.log(`  → stages  created=${stagesCreated} updated=${stagesUpdated}`)

  // ============== DealStat snapshot
  console.log("\n=== DealStat snapshot ===")
  const stat = await gc.getDealStat()
  await prisma.dealStatSnapshot.create({
    data: {
      tenantId: tenant.id,
      source: "getcourse:dealstat",
      scopeJson: { ruleString: "", locationId: 0, allTime: true },
      ordersCreatedCount: stat.totals.ordersCreatedCount,
      ordersCreatedAmount: stat.totals.ordersCreatedAmount,
      ordersPaidCount: stat.totals.ordersPaidCount,
      ordersPaidAmount: stat.totals.ordersPaidAmount,
      buyersCount: stat.totals.buyersCount,
      prepaymentsCount: stat.totals.prepaymentsCount,
      prepaymentsAmount: stat.totals.prepaymentsAmount,
      taxAmount: stat.totals.taxAmount,
      commissionAmount: stat.totals.commissionAmount,
      earnedAmount: stat.totals.earnedAmount,
      seriesJson: JSON.parse(JSON.stringify(stat.series)),
      rawJson: JSON.parse(JSON.stringify(stat.rawJson)),
    },
  })
  const fmt = (n: number | null) => (n === null ? "?" : n.toLocaleString("ru-RU"))
  console.log(`  ✓ snapshot created`)
  console.log(`    ordersPaid: ${fmt(stat.totals.ordersPaidCount)} / ${fmt(stat.totals.ordersPaidAmount)}₽`)
  console.log(`    earned:     ${fmt(stat.totals.earnedAmount)}₽`)
  console.log(`    series:     ${stat.series.length} metrics × ${stat.series[0]?.points.length ?? 0} months`)
}

main()
  .catch((e) => { console.error("FAILED:", e); process.exit(1) })
  .finally(() => prisma.$disconnect())
