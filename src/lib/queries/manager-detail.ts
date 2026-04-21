import { db } from "@/lib/db"
import type { InsightWithDetails, DailyConversion } from "@/lib/queries/dashboard"
import { getInsights } from "@/lib/queries/dashboard"

interface KeyQuote {
  text: string
  context?: string
  isPositive: boolean
  dealCrmId?: string
  source?: "transcript" | "message" | null
}

/**
 * Detect for each quote whether it likely came from a transcript or a text message.
 * Heuristic: look for the first 30 chars of the quote in each source.
 */
function detectQuoteSources(
  quotes: KeyQuote[],
  transcripts: string[],
  messageContents: string[]
): KeyQuote[] {
  const transcriptBlob = transcripts.join(" \n ").toLowerCase()
  const messagesBlob = messageContents.join(" \n ").toLowerCase()
  return quotes.map((q) => {
    const needle = q.text.trim().slice(0, 30).toLowerCase()
    if (!needle) return { ...q, source: null }
    const inTranscript = transcriptBlob.includes(needle)
    const inMessages = messagesBlob.includes(needle)
    let source: "transcript" | "message" | null = null
    if (inTranscript && !inMessages) source = "transcript"
    else if (inMessages && !inTranscript) source = "message"
    else if (inTranscript) source = "transcript" // both — prefer transcript
    return { ...q, source }
  })
}

export interface DealWithAnalysis {
  id: string
  crmId: string | null
  title: string
  amount: number | null
  duration: number | null
  status: "WON" | "LOST"
  messageCount: number
  stageCount: number
  analysis: {
    summary: string
    successFactors: string | null
    failureFactors: string | null
    keyQuotes: KeyQuote[]
  } | null
}

export interface ManagerPattern {
  id: string
  type: "SUCCESS" | "FAILURE"
  title: string
  description: string
}

export interface DealListItem {
  id: string
  crmId: string | null
  amount: number | null
  status: string
  duration: number | null
}

export interface LostStageData {
  stageName: string
  count: number
}

export interface ManagerDetail {
  id: string
  name: string
  totalDeals: number | null
  successDeals: number | null
  lostDeals_count: number | null
  conversionRate: number | null
  avgDealValue: number | null
  talkRatio: number | null
  avgResponseTime: number | null
  totalSalesAmount: number | null
  avgDealTime: number | null
  status: string | null
  wonDeals: DealWithAnalysis[]
  lostDeals: DealWithAnalysis[]
  allDeals: DealListItem[]
  patterns: ManagerPattern[]
  insights: InsightWithDetails[]
  dailyConversion: DailyConversion[]
  lostStages: LostStageData[]
}

export async function getManagerDetail(
  managerId: string
): Promise<ManagerDetail | null> {
  const manager = await db.manager.findUnique({
    where: { id: managerId },
    select: {
      id: true,
      tenantId: true,
      name: true,
      totalDeals: true,
      successDeals: true,
      conversionRate: true,
      avgDealValue: true,
      avgDealTime: true,
      talkRatio: true,
      avgResponseTime: true,
      status: true,
      deals: {
        where: {
          status: { in: ["WON", "LOST"] },
          // Exclude empty deals: amount=0 AND no messages AND no transcribed calls
          OR: [
            { amount: { gt: 0 } },
            { messages: { some: {} } },
            { callRecords: { some: { transcript: { not: null } } } },
          ],
        },
        include: {
          analysis: true,
          messages: { select: { id: true, content: true } },
          callRecords: {
            where: { transcript: { not: null } },
            select: { transcript: true },
          },
          stageHistory: { select: { id: true } },
          dealPatterns: {
            include: {
              pattern: {
                select: {
                  id: true,
                  type: true,
                  title: true,
                  description: true,
                },
              },
            },
          },
        },
        orderBy: { amount: "desc" },
      },
    },
  })

  if (!manager) return null

  // Fetch deals — exclude empty/test ones (amount=0 OR title-only webinar regs).
  // Only show deals with amount > 0 OR with content (messages/calls).
  const allDealsRaw = await db.deal.findMany({
    where: {
      managerId,
      OR: [
        { amount: { gt: 0 } },
        { messages: { some: {} } },
        { callRecords: { some: { transcript: { not: null } } } },
      ],
    },
    select: {
      id: true,
      crmId: true,
      amount: true,
      status: true,
      duration: true,
    },
    orderBy: { createdAt: "desc" },
  })

  const allDeals: DealListItem[] = allDealsRaw.map((d) => ({
    id: d.id,
    crmId: d.crmId,
    amount: d.amount,
    status: d.status,
    duration: d.duration,
  }))

  const wonDeals: DealWithAnalysis[] = []
  const lostDeals: DealWithAnalysis[] = []
  const patternsMap = new Map<string, ManagerPattern>()

  for (const deal of manager.deals) {
    const mapped: DealWithAnalysis = {
      id: deal.id,
      crmId: deal.crmId,
      title: deal.title,
      amount: deal.amount,
      duration: deal.duration,
      status: deal.status as "WON" | "LOST",
      messageCount: deal.messages.length,
      stageCount: deal.stageHistory.length,
      analysis: deal.analysis
        ? {
            summary: deal.analysis.summary,
            successFactors: deal.analysis.successFactors,
            failureFactors: deal.analysis.failureFactors,
            keyQuotes: detectQuoteSources(
              (deal.analysis.keyQuotes as KeyQuote[] | null) ?? [],
              deal.callRecords.map((c) => c.transcript ?? ""),
              deal.messages.map((m) => m.content ?? "")
            ),
          }
        : null,
    }

    if (deal.status === "WON") {
      wonDeals.push(mapped)
    } else {
      lostDeals.push(mapped)
    }

    for (const dp of deal.dealPatterns) {
      if (!patternsMap.has(dp.pattern.id)) {
        patternsMap.set(dp.pattern.id, {
          id: dp.pattern.id,
          type: dp.pattern.type as "SUCCESS" | "FAILURE",
          title: dp.pattern.title,
          description: dp.pattern.description,
        })
      }
    }
  }

  // Fetch insights filtered to this manager
  const allInsights = await getInsights(manager.tenantId)
  const managerInsights = allInsights.filter((i) =>
    i.managerIds.includes(managerId)
  )

  // Compute lost deals count and total sales amount
  const lostDealsCount = lostDeals.length
  const totalSalesAmount = wonDeals.reduce(
    (sum, d) => sum + (d.amount ?? 0),
    0
  )

  // Daily conversion for this manager
  const managerDeals = await db.deal.findMany({
    where: {
      managerId,
      status: { in: ["WON", "LOST"] },
      closedAt: { not: null },
    },
    select: { status: true, closedAt: true },
    orderBy: { closedAt: "asc" },
  })

  const dayMap = new Map<string, { won: number; total: number }>()
  for (const deal of managerDeals) {
    if (!deal.closedAt) continue
    const d = deal.closedAt
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    const entry = dayMap.get(key) ?? { won: 0, total: 0 }
    entry.total++
    if (deal.status === "WON") entry.won++
    dayMap.set(key, entry)
  }
  const sortedDays = Array.from(dayMap.entries()).sort(([a], [b]) =>
    a.localeCompare(b)
  )
  const dailyConversion: DailyConversion[] = sortedDays.map(
    ([dateKey, { won, total }]) => {
      const [, mm, dd] = dateKey.split("-")
      return {
        date: `${dd}.${mm}`,
        conversion: total > 0 ? Math.round((won / total) * 1000) / 10 : 0,
      }
    }
  )

  // Lost deals — last stage before loss
  const lostDealIds = lostDeals.map((d) => d.id)
  let lostStages: LostStageData[] = []
  if (lostDealIds.length > 0) {
    const stageHistories = await db.dealStageHistory.findMany({
      where: { dealId: { in: lostDealIds } },
      select: {
        dealId: true,
        stage: { select: { name: true } },
        enteredAt: true,
      },
      orderBy: { enteredAt: "desc" },
    })

    // Get last stage per lost deal
    const lastStagePerDeal = new Map<string, string>()
    for (const sh of stageHistories) {
      if (!lastStagePerDeal.has(sh.dealId)) {
        lastStagePerDeal.set(sh.dealId, sh.stage.name)
      }
    }

    const stageCounts = new Map<string, number>()
    for (const stageName of lastStagePerDeal.values()) {
      stageCounts.set(stageName, (stageCounts.get(stageName) ?? 0) + 1)
    }

    lostStages = Array.from(stageCounts.entries())
      .map(([stageName, count]) => ({ stageName, count }))
      .sort((a, b) => b.count - a.count)
  }

  return {
    id: manager.id,
    name: manager.name,
    totalDeals: manager.totalDeals,
    successDeals: manager.successDeals,
    lostDeals_count: lostDealsCount,
    conversionRate: manager.conversionRate,
    avgDealValue: manager.avgDealValue,
    talkRatio: manager.talkRatio,
    avgResponseTime: manager.avgResponseTime,
    totalSalesAmount,
    avgDealTime: manager.avgDealTime,
    status: manager.status,
    wonDeals,
    lostDeals,
    allDeals,
    patterns: Array.from(patternsMap.values()),
    insights: managerInsights,
    dailyConversion,
    lostStages,
  }
}
