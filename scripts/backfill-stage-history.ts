/**
 * Backfill DealStageHistory by pulling lead_status_changed events from amoCRM.
 * For each Deal in tenant: fetch transitions → write entered/left rows.
 *
 * Usage on server:
 *   docker run --rm --network smart-analyze_default -v /root/smart-analyze:/app -w /app \
 *     node:22-slim sh -c 'set -a && . /app/.env && set +a && \
 *       ./node_modules/.bin/tsx scripts/backfill-stage-history.ts <tenantName> [limit]'
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { AmoCrmAdapter } from "../src/lib/crm/amocrm"

const tenantName = process.argv[2]
const limit = process.argv[3] ? Number(process.argv[3]) : undefined

if (!tenantName) {
  console.error("Usage: backfill-stage-history.ts <tenantName> [limit]")
  process.exit(1)
}

const CONCURRENCY = 5

async function processBatch<T, R>(
  items: T[],
  worker: (item: T, idx: number) => Promise<R>,
  concurrency: number,
  onProgress?: (done: number, total: number) => void
): Promise<R[]> {
  const results: R[] = []
  let cursor = 0
  let done = 0
  async function take() {
    while (cursor < items.length) {
      const i = cursor++
      try {
        results[i] = await worker(items[i], i)
      } catch (e) {
        console.error(`item ${i} failed:`, (e as Error).message)
      }
      done++
      if (onProgress && done % 50 === 0) onProgress(done, items.length)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => take())
  )
  return results
}

async function main() {
  const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter: adapterPg })

  const tenant = await db.tenant.findFirstOrThrow({
    where: { name: tenantName },
  })
  const cfg = await db.crmConfig.findFirstOrThrow({
    where: { tenantId: tenant.id, provider: "AMOCRM" },
  })
  if (!cfg.subdomain || !cfg.apiKey)
    throw new Error("amoCRM config missing (subdomain or apiKey)")

  const client = new AmoCrmAdapter(cfg.subdomain, cfg.apiKey)

  // Map FunnelStage by crmId for fast lookup
  const stages = await db.funnelStage.findMany({
    where: { funnel: { tenantId: tenant.id } },
    select: { id: true, crmId: true, funnelId: true },
  })
  const stageByCrmId = new Map<string, { id: string; funnelId: string }>()
  for (const s of stages) {
    if (s.crmId)
      stageByCrmId.set(s.crmId, { id: s.id, funnelId: s.funnelId })
  }
  console.log(`stages indexed: ${stageByCrmId.size}`)

  // Pick deals — prefer those without history yet
  const deals = await db.deal.findMany({
    where: {
      tenantId: tenant.id,
      crmId: { not: null },
      stageHistory: { none: {} },
    },
    select: { id: true, crmId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    ...(limit ? { take: limit } : {}),
  })
  console.log(`deals to backfill: ${deals.length}`)

  let writtenRows = 0
  let dealsWithHistory = 0
  let dealsNoEvents = 0

  await processBatch(
    deals,
    async (deal) => {
      if (!deal.crmId) return
      const transitions = await client.fetchStageTransitions(deal.crmId)
      if (transitions.length === 0) {
        dealsNoEvents++
        return
      }
      dealsWithHistory++

      // Reconstruct entered+left windows.
      // Each transition T(i) = "moved INTO toStageCrmId at changedAt".
      // Stage T(i).toStageCrmId entered=changedAt, left=T(i+1).changedAt.
      const rows: { stageId: string; enteredAt: Date; leftAt: Date | null; duration: number | null }[] = []
      for (let i = 0; i < transitions.length; i++) {
        const t = transitions[i]
        const stage = stageByCrmId.get(t.toStageCrmId)
        if (!stage) continue // unknown stage (filtered funnel)
        const next = transitions[i + 1]
        const enteredAt = t.changedAt
        const leftAt = next ? next.changedAt : null
        const duration = leftAt
          ? (leftAt.getTime() - enteredAt.getTime()) / (1000 * 60 * 60 * 24) // days
          : null
        rows.push({ stageId: stage.id, enteredAt, leftAt, duration })
      }

      if (rows.length === 0) return

      // Write all rows in one tx
      await db.$transaction(
        rows.map((r) =>
          db.dealStageHistory.create({
            data: {
              dealId: deal.id,
              stageId: r.stageId,
              enteredAt: r.enteredAt,
              leftAt: r.leftAt,
              duration: r.duration,
            },
          })
        )
      )
      writtenRows += rows.length
    },
    CONCURRENCY,
    (done, total) =>
      console.log(
        `[${done}/${total}] ${dealsWithHistory} with history, ${dealsNoEvents} no events, ${writtenRows} rows written`
      )
  )

  console.log(
    `\n=== DONE ===\ndeals processed: ${deals.length}\ndeals with stage history: ${dealsWithHistory}\ndeals with no events: ${dealsNoEvents}\nstage history rows written: ${writtenRows}`
  )

  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
