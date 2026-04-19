import { db } from "@/lib/db"

export type Period = "day" | "week" | "month" | "quarter" | "all"

/**
 * Global analytics floor — sales data older than this is never shown or analyzed.
 * Old deals (2019-2024) sit in DB as historical record but are excluded from
 * dashboards, AI analysis, and metrics. Override via env if needed for a tenant.
 */
export const ANALYTICS_FLOOR_DATE = new Date(
  process.env.ANALYTICS_FLOOR_DATE || "2025-01-01T00:00:00Z"
)

/**
 * Convert UI period code to an effective Date cutoff.
 * Returns the LATER of (period cutoff, ANALYTICS_FLOOR_DATE) — never go below floor.
 */
export function periodToCutoff(period: Period | undefined | null): Date {
  const now = new Date()
  const days =
    !period || period === "all"
      ? null
      : period === "day"
        ? 1
        : period === "week"
          ? 7
          : period === "month"
            ? 30
            : 90
  if (days === null) return ANALYTICS_FLOOR_DATE
  const c = new Date(now)
  c.setDate(c.getDate() - days)
  return c.getTime() > ANALYTICS_FLOOR_DATE.getTime() ? c : ANALYTICS_FLOOR_DATE
}

export async function getDashboardStats(tenantId: string, period?: Period) {
  const cutoff = periodToCutoff(period)
  const dateFilter = { createdAt: { gte: cutoff } }
  const [totalDeals, wonDeals, lostDeals] = await Promise.all([
    db.deal.count({ where: { tenantId, ...dateFilter } }),
    db.deal.findMany({ where: { tenantId, status: "WON", ...dateFilter } }),
    db.deal.findMany({ where: { tenantId, status: "LOST", ...dateFilter } }),
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

export async function getFunnelData(
  tenantId: string,
  funnelId?: string,
  period?: Period
) {
  const cutoff = periodToCutoff(period)
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

  // Allow caller to pin a specific funnel via ?funnel=<id>; otherwise pick busiest.
  const funnel =
    (funnelId && funnels.find((f) => f.id === funnelId)) ||
    [...funnels].sort((a, b) => b._count.deals - a._count.deals)[0]

  const orderedStages = [...funnel.stages].sort((a, b) => a.order - b.order)
  // For period-aware totalDeals: count only deals created within cutoff
  const totalDeals = await db.deal.count({
    where: { tenantId, funnelId: funnel.id, createdAt: { gte: cutoff } },
  })

  const stagesWithData = await Promise.all(
    orderedStages.map(async (stage) => {
      // Progressive count: deals that EVER touched this stage (history)
      // OR are currently sitting at THIS or any LATER stage (i.e. they passed through).
      const futureStageCrmIds = orderedStages
        .filter((s) => s.order >= stage.order)
        .map((s) => s.crmId)
        .filter((c): c is string => Boolean(c))

      const [historyDealIdRows, currentDeals, histories] = await Promise.all([
        db.dealStageHistory.findMany({
          where: {
            stageId: stage.id,
            deal: { createdAt: { gte: cutoff } },
          },
          select: { dealId: true },
          distinct: ["dealId"],
        }),
        db.deal.findMany({
          where: {
            tenantId,
            funnelId: funnel.id,
            currentStageCrmId: { in: futureStageCrmIds },
            createdAt: { gte: cutoff },
          },
          select: { id: true },
        }),
        db.dealStageHistory.findMany({
          where: { stageId: stage.id },
          select: { duration: true },
        }),
      ])

      const allDealIds = new Set<string>()
      for (const h of historyDealIdRows) allDealIds.add(h.dealId)
      for (const d of currentDeals) allDealIds.add(d.id)
      const dealCount = allDealIds.size

      const avgTime =
        histories.length > 0
          ? histories.reduce((s, h) => s + (h.duration ?? 0), 0) /
            histories.length
          : 0

      // Progressive conversion: % of total funnel deals that reached this stage.
      const conversion = totalDeals > 0 ? (dealCount / totalDeals) * 100 : 0

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

export interface DuplicateStats {
  callDuplicates: number
  dealDuplicateCandidates: number
  messageDuplicateRows: number
}

// Counts potential duplicates without modifying data.
// Heuristic: same audioUrl for calls; same title+manager+createdAt±7d for deals;
// same content+sender+dealId for messages. Numbers are rough — for indicator only.
export async function getDuplicateStats(
  tenantId: string
): Promise<DuplicateStats> {
  const callRows = await db.$queryRawUnsafe<{ extra: bigint }[]>(
    `SELECT COALESCE(SUM(c-1),0)::bigint AS extra FROM (
       SELECT count(*)::bigint AS c FROM "CallRecord"
       WHERE "tenantId"=$1 AND "audioUrl" IS NOT NULL
       GROUP BY "audioUrl" HAVING count(*)>1
     ) t`,
    tenantId
  )
  const dealRows = await db.$queryRawUnsafe<{ pairs: bigint }[]>(
    `SELECT count(*)::bigint AS pairs FROM "Deal" d1
     JOIN "Deal" d2 ON d1."tenantId"=d2."tenantId"
       AND d1."managerId"=d2."managerId"
       AND d1.id<d2.id
       AND abs(extract(epoch from (d1."createdAt"-d2."createdAt")))<86400*7
       AND lower(trim(d1.title))=lower(trim(d2.title))
     WHERE d1."tenantId"=$1 AND d1."managerId" IS NOT NULL`,
    tenantId
  )
  const msgRows = await db.$queryRawUnsafe<{ extra: bigint }[]>(
    `SELECT COALESCE(SUM(c-1),0)::bigint AS extra FROM (
       SELECT count(*)::bigint AS c FROM "Message"
       WHERE "tenantId"=$1 AND content IS NOT NULL
         AND length(content)>10 AND "dealId" IS NOT NULL
       GROUP BY content, sender, "dealId" HAVING count(*)>1
     ) t`,
    tenantId
  )
  return {
    callDuplicates: Number(callRows[0]?.extra ?? 0),
    dealDuplicateCandidates: Number(dealRows[0]?.pairs ?? 0),
    messageDuplicateRows: Number(msgRows[0]?.extra ?? 0),
  }
}

export async function getFunnelList(
  tenantId: string
): Promise<{ id: string; name: string; dealCount: number }[]> {
  const funnels = await db.funnel.findMany({
    where: { tenantId },
    include: { _count: { select: { deals: true } } },
    orderBy: { name: "asc" },
  })
  return funnels.map((f) => ({
    id: f.id,
    name: f.name,
    dealCount: f._count.deals,
  }))
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
  source?: "transcript" | "message" | null
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

      const [deals, managers, dealsWithContent] = await Promise.all([
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
        // Pull transcripts + message content for the insight's deals to detect quote source
        dealIds.length > 0
          ? db.deal.findMany({
              where: { id: { in: dealIds } },
              select: {
                callRecords: {
                  where: { transcript: { not: null } },
                  select: { transcript: true },
                },
                messages: { select: { content: true } },
              },
            })
          : Promise.resolve([]),
      ])

      // Detect source of each quote — search first 30 chars in transcripts vs messages
      const transcriptBlob = dealsWithContent
        .flatMap((d) => d.callRecords.map((c) => c.transcript ?? ""))
        .join(" \n ")
        .toLowerCase()
      const messagesBlob = dealsWithContent
        .flatMap((d) => d.messages.map((m) => m.content ?? ""))
        .join(" \n ")
        .toLowerCase()
      const quotesWithSource: InsightQuote[] = quotes.map((q) => {
        const needle = q.text.trim().slice(0, 30).toLowerCase()
        if (!needle) return { ...q, source: null }
        const inT = transcriptBlob.includes(needle)
        const inM = messagesBlob.includes(needle)
        let source: "transcript" | "message" | null = null
        if (inT && !inM) source = "transcript"
        else if (inM && !inT) source = "message"
        else if (inT) source = "transcript"
        return { ...q, source }
      })

      return {
        id: insight.id,
        type: insight.type as "SUCCESS_INSIGHT" | "FAILURE_INSIGHT",
        title: insight.title,
        content: insight.content,
        detailedDescription: insight.detailedDescription,
        dealIds,
        managerIds,
        quotes: quotesWithSource,
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
  tenantId: string,
  period?: Period
): Promise<DailyConversion[]> {
  const cutoff = periodToCutoff(period)
  const deals = await db.deal.findMany({
    where: {
      tenantId,
      status: { in: ["WON", "LOST"] },
      closedAt: { gte: cutoff },
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
