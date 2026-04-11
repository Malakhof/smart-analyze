import { db } from "@/lib/db"
import type { InsightWithDetails } from "@/lib/queries/dashboard"
import { getInsights } from "@/lib/queries/dashboard"

interface KeyQuote {
  text: string
  context?: string
  isPositive: boolean
  dealCrmId?: string
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

export interface ManagerDetail {
  id: string
  name: string
  totalDeals: number | null
  successDeals: number | null
  conversionRate: number | null
  avgDealValue: number | null
  talkRatio: number | null
  status: string | null
  wonDeals: DealWithAnalysis[]
  lostDeals: DealWithAnalysis[]
  allDeals: DealListItem[]
  patterns: ManagerPattern[]
  insights: InsightWithDetails[]
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
      talkRatio: true,
      status: true,
      deals: {
        where: { status: { in: ["WON", "LOST"] } },
        include: {
          analysis: true,
          messages: { select: { id: true } },
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

  // Fetch all deals (including OPEN) for the deals list
  const allDealsRaw = await db.deal.findMany({
    where: { managerId },
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
            keyQuotes: (deal.analysis.keyQuotes as KeyQuote[] | null) ?? [],
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

  return {
    id: manager.id,
    name: manager.name,
    totalDeals: manager.totalDeals,
    successDeals: manager.successDeals,
    conversionRate: manager.conversionRate,
    avgDealValue: manager.avgDealValue,
    talkRatio: manager.talkRatio,
    status: manager.status,
    wonDeals,
    lostDeals,
    allDeals,
    patterns: Array.from(patternsMap.values()),
    insights: managerInsights,
  }
}
