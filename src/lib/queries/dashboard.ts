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
  // Pick the funnel that ACTUALLY has the most deals attached, not just first by id.
  // Avoids showing a near-empty funnel when client has 8 funnels but only 1 active.
  const funnels = await db.funnel.findMany({
    where: { tenantId },
    include: {
      stages: { orderBy: { order: "asc" } },
      _count: { select: { deals: true } },
    },
    orderBy: { name: "asc" },
  })

  if (funnels.length === 0) return []

  const funnel = [...funnels].sort(
    (a, b) => b._count.deals - a._count.deals
  )[0]

  // For "conversion %" denominator we want deals THAT ENTERED THIS FUNNEL,
  // not all deals across the tenant. Otherwise stages of small funnels look
  // artificially low (e.g. 12% when in reality 100% of that funnel's deals).
  const funnelDealsCount = funnel._count.deals

  const stagesWithData = await Promise.all(
    funnel.stages.map(async (stage) => {
      // Histories for this stage
      const histories = await db.dealStageHistory.findMany({
        where: { stageId: stage.id },
      })
      // Deals currently sitting on this stage (uses Deal.currentStageCrmId, not history)
      // — gives sane numbers even when transition history is incomplete.
      const currentDealCount = await db.deal.count({
        where: {
          tenantId,
          funnelId: funnel.id,
          currentStageCrmId: stage.crmId,
        },
      })
      const dealCount = Math.max(histories.length, currentDealCount)
      const avgTime =
        histories.length > 0
          ? histories.reduce((s, h) => s + (h.duration ?? 0), 0) /
            histories.length
          : 0
      const conversion =
        funnelDealsCount > 0 ? (dealCount / funnelDealsCount) * 100 : 0

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


export interface DailyConversion {
  date: string // DD.MM format
  conversion: number // 0-100
}

export async function getDailyConversion(
  tenantId: string
): Promise<DailyConversion[]> {
  const deals = await db.deal.findMany({
    where: {
      tenantId,
      status: { in: ["WON", "LOST"] },
      closedAt: { not: null },
    },
    select: {
      status: true,
      closedAt: true,
    },
    orderBy: { closedAt: "asc" },
  })

  // Group deals by closedAt date
  const dayMap = new Map<string, { won: number; total: number }>()

  for (const deal of deals) {
    if (!deal.closedAt) continue
    const d = deal.closedAt
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    const entry = dayMap.get(key) ?? { won: 0, total: 0 }
    entry.total++
    if (deal.status === "WON") entry.won++
    dayMap.set(key, entry)
  }

  // Sort by date and format as DD.MM
  const sorted = Array.from(dayMap.entries()).sort(([a], [b]) =>
    a.localeCompare(b)
  )

  return sorted.map(([dateKey, { won, total }]) => {
    const [, mm, dd] = dateKey.split("-")
    return {
      date: `${dd}.${mm}`,
      conversion: total > 0 ? Math.round((won / total) * 1000) / 10 : 0,
    }
  })
}

export interface DealStatPoint {
  month: string
  value: number
}

export interface DealStatSeries {
  name: string
  points: DealStatPoint[]
}

export interface DealStatSnapshot {
  capturedAt: Date
  source: string
  ordersCreatedCount: number | null
  ordersCreatedAmount: number | null
  ordersPaidCount: number | null
  ordersPaidAmount: number | null
  buyersCount: number | null
  earnedAmount: number | null
  series: DealStatSeries[]
}

// Returns the latest CRM-side aggregated stat snapshot (e.g. GC dealstat).
// Returns null for tenants whose CRM doesn't expose pre-aggregated revenue (amoCRM).
export async function getDealStatSnapshot(
  tenantId: string
): Promise<DealStatSnapshot | null> {
  const snap = await db.dealStatSnapshot.findFirst({
    where: { tenantId },
    orderBy: { capturedAt: "desc" },
  })
  if (!snap) return null

  const seriesRaw = (snap.seriesJson ?? null) as
    | { name?: unknown; points?: unknown }[]
    | null
  const series: DealStatSeries[] = []
  if (Array.isArray(seriesRaw)) {
    for (const s of seriesRaw) {
      if (!s || typeof s !== "object") continue
      const name = typeof s.name === "string" ? s.name : ""
      const ptsRaw = Array.isArray(s.points) ? s.points : []
      const points: DealStatPoint[] = []
      for (const p of ptsRaw as { month?: unknown; value?: unknown }[]) {
        if (!p || typeof p !== "object") continue
        if (typeof p.month !== "string") continue
        const v = Number(p.value)
        if (!Number.isFinite(v)) continue
        points.push({ month: p.month, value: v })
      }
      if (name && points.length > 0) series.push({ name, points })
    }
  }

  return {
    capturedAt: snap.capturedAt,
    source: snap.source,
    ordersCreatedCount: snap.ordersCreatedCount,
    ordersCreatedAmount: snap.ordersCreatedAmount,
    ordersPaidCount: snap.ordersPaidCount,
    ordersPaidAmount: snap.ordersPaidAmount,
    buyersCount: snap.buyersCount,
    earnedAmount: snap.earnedAmount,
    series,
  }
}
