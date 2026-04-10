import { db } from "@/lib/db"

export async function getDashboardStats(tenantId: string) {
  const [totalDeals, wonDeals, lostDeals] = await Promise.all([
    db.deal.count({ where: { tenantId } }),
    db.deal.findMany({ where: { tenantId, status: "WON" } }),
    db.deal.findMany({ where: { tenantId, status: "LOST" } }),
  ])

  const wonCount = wonDeals.length
  const lostCount = lostDeals.length
  const wonAmount = wonDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0)
  const lostAmount = lostDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0)

  const closedDeals = [...wonDeals, ...lostDeals]
  const conversionRate =
    closedDeals.length > 0 ? (wonCount / closedDeals.length) * 100 : 0
  const avgCheck =
    wonCount > 0 ? wonAmount / wonCount : 0
  const avgTime =
    closedDeals.length > 0
      ? closedDeals.reduce((sum, d) => sum + (d.duration ?? 0), 0) /
        closedDeals.length
      : 0

  // Aggregate talk ratio from manager cached metrics
  const managers = await db.manager.findMany({
    where: { tenantId },
    select: { talkRatio: true, totalDeals: true },
  })
  const totalManagerDeals = managers.reduce(
    (s, m) => s + (m.totalDeals ?? 0),
    0
  )
  const avgTalkRatio =
    totalManagerDeals > 0
      ? managers.reduce(
          (s, m) => s + (m.talkRatio ?? 0) * (m.totalDeals ?? 0),
          0
        ) / totalManagerDeals
      : 0

  return {
    totalDeals,
    wonCount,
    lostCount,
    wonAmount,
    lostAmount,
    conversionRate,
    avgCheck,
    avgTime,
    avgTalkRatio,
    totalPotential: wonAmount + lostAmount,
    lossPercent:
      wonAmount + lostAmount > 0
        ? (lostAmount / (wonAmount + lostAmount)) * 100
        : 0,
  }
}

export async function getFunnelData(tenantId: string) {
  const funnel = await db.funnel.findFirst({
    where: { tenantId },
    include: {
      stages: { orderBy: { order: "asc" } },
    },
  })

  if (!funnel) return []

  const totalDeals = await db.deal.count({ where: { tenantId } })

  const stagesWithData = await Promise.all(
    funnel.stages.map(async (stage) => {
      const histories = await db.dealStageHistory.findMany({
        where: { stageId: stage.id },
      })
      const dealCount = histories.length
      const avgTime =
        histories.length > 0
          ? histories.reduce((s, h) => s + (h.duration ?? 0), 0) /
            histories.length
          : 0
      const conversion =
        totalDeals > 0 ? (dealCount / totalDeals) * 100 : 0

      return {
        id: stage.id,
        name: stage.name,
        order: stage.order,
        dealCount,
        conversion,
        avgTime,
      }
    })
  )

  return stagesWithData
}

export async function getManagerRanking(tenantId: string) {
  const managers = await db.manager.findMany({
    where: { tenantId },
    orderBy: { conversionRate: "desc" },
    select: {
      id: true,
      name: true,
      totalDeals: true,
      successDeals: true,
      conversionRate: true,
      avgDealValue: true,
      avgDealTime: true,
      talkRatio: true,
      status: true,
    },
  })

  return managers
}

interface InsightQuote {
  text: string
  dealCrmId: string
}

export interface InsightWithDetails {
  id: string
  type: "SUCCESS_INSIGHT" | "FAILURE_INSIGHT"
  title: string
  content: string
  detailedDescription: string | null
  dealIds: string[]
  managerIds: string[]
  quotes: InsightQuote[]
  deals: { id: string; crmId: string | null }[]
  managers: { id: string; name: string }[]
}

export async function getInsights(
  tenantId: string
): Promise<InsightWithDetails[]> {
  const insights = await db.insight.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  })

  const enriched = await Promise.all(
    insights.map(async (insight) => {
      const dealIds = (insight.dealIds as string[] | null) ?? []
      const managerIds = (insight.managerIds as string[] | null) ?? []
      const quotes = (insight.quotes as InsightQuote[] | null) ?? []

      const [deals, managers] = await Promise.all([
        dealIds.length > 0
          ? db.deal.findMany({
              where: { id: { in: dealIds } },
              select: { id: true, crmId: true },
            })
          : Promise.resolve([]),
        managerIds.length > 0
          ? db.manager.findMany({
              where: { id: { in: managerIds } },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
      ])

      return {
        id: insight.id,
        type: insight.type as "SUCCESS_INSIGHT" | "FAILURE_INSIGHT",
        title: insight.title,
        content: insight.content,
        detailedDescription: insight.detailedDescription,
        dealIds,
        managerIds,
        quotes,
        deals,
        managers,
      }
    })
  )

  return enriched
}

export async function getTenantId(): Promise<string | null> {
  const tenant = await db.tenant.findFirst({
    select: { id: true },
  })
  return tenant?.id ?? null
}
