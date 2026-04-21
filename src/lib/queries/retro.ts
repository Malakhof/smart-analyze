import { db } from "@/lib/db"
import { getInsights, type InsightWithDetails } from "@/lib/queries/dashboard"
import { getPatterns, type PatternData } from "@/lib/queries/patterns"
import type { ManagerListItem } from "@/lib/queries/managers"

/**
 * /retro endpoint = "wow audit" of everything we've ever ingested for this tenant.
 * No period filter — always all-time. Pages that need live 7-day windows live
 * elsewhere; here we want the long narrative for sales demos.
 */

export interface RetroVolume {
  dealsTotal: number
  dealsWithManager: number
  messagesTotal: number
  messagesByRole: {
    manager: number
    client: number
    system: number
  }
  calls: number
  transcripts: number
  callScores: number
  managers: number
  insights: number
  patterns: number
  dealAnalyses: number
  windowDays: number
}

export async function getRetroVolume(tenantId: string): Promise<RetroVolume> {
  const [
    dealsTotal,
    dealsWithManager,
    messagesTotal,
    messagesManager,
    messagesClient,
    messagesSystem,
    calls,
    transcripts,
    callScores,
    managers,
    insights,
    patterns,
    dealAnalyses,
  ] = await Promise.all([
    db.deal.count({ where: { tenantId } }),
    db.deal.count({ where: { tenantId, managerId: { not: null } } }),
    db.message.count({ where: { tenantId } }),
    db.message.count({ where: { tenantId, sender: "MANAGER" } }),
    db.message.count({ where: { tenantId, sender: "CLIENT" } }),
    db.message.count({ where: { tenantId, sender: "SYSTEM" } }),
    db.callRecord.count({ where: { tenantId } }),
    db.callRecord.count({
      where: { tenantId, transcript: { not: null } },
    }),
    // CallScore has no direct tenantId — go through callRecord relation.
    db.callScore.count({
      where: { callRecord: { tenantId } },
    }),
    db.manager.count({ where: { tenantId } }),
    db.insight.count({ where: { tenantId } }),
    db.pattern.count({ where: { tenantId } }),
    // DealAnalysis has no direct tenantId — go through deal relation.
    db.dealAnalysis.count({
      where: { deal: { tenantId } },
    }),
  ])

  return {
    dealsTotal,
    dealsWithManager,
    messagesTotal,
    messagesByRole: {
      manager: messagesManager,
      client: messagesClient,
      system: messagesSystem,
    },
    calls,
    transcripts,
    callScores,
    managers,
    insights,
    patterns,
    dealAnalyses,
    windowDays: 90,
  }
}

/**
 * Top insights ranked by visible "wow" content: how many deals it cites,
 * how many quotes it has, with a tiebreaker that prefers SUCCESS over FAILURE
 * for the lead spot. Re-uses the existing `getInsights` so the same enrichment
 * (quotes-with-source, deals, managers) flows through unchanged.
 */
export async function getRetroTopInsights(
  tenantId: string,
  limit = 4
): Promise<InsightWithDetails[]> {
  const all = await getInsights(tenantId)
  const ranked = [...all].sort((a, b) => {
    const aScore =
      a.deals.length * 10 +
      a.quotes.length * 3 +
      (a.type === "SUCCESS_INSIGHT" ? 1 : 0)
    const bScore =
      b.deals.length * 10 +
      b.quotes.length * 3 +
      (b.type === "SUCCESS_INSIGHT" ? 1 : 0)
    return bScore - aScore
  })
  return ranked.slice(0, limit)
}

export interface RetroManagerPortrait extends ManagerListItem {
  bucket: "best" | "middle" | "worst"
}

/**
 * Pick a 6-portrait spread: 2 best, 2 middle, 2 worst by conversionRate.
 * If we have <=6 managers with deals, return all of them as-is bucketed
 * crudely (top third best, middle third middle, bottom third worst).
 */
export async function getRetroManagerPortraits(
  tenantId: string
): Promise<RetroManagerPortrait[]> {
  const managers = await db.manager.findMany({
    where: { tenantId, totalDeals: { gt: 0 } },
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

  if (managers.length === 0) return []

  if (managers.length <= 6) {
    // Few enough that we just show them all; bucket by terciles.
    const third = Math.max(1, Math.ceil(managers.length / 3))
    return managers.map((m, i) => ({
      ...m,
      bucket:
        i < third
          ? ("best" as const)
          : i < third * 2
            ? ("middle" as const)
            : ("worst" as const),
    }))
  }

  const best = managers.slice(0, 2).map((m) => ({
    ...m,
    bucket: "best" as const,
  }))
  const worst = managers.slice(-2).map((m) => ({
    ...m,
    bucket: "worst" as const,
  }))
  // Middle 2: take from the geometric middle so we skip near-best / near-worst.
  const midStart = Math.floor((managers.length - 2) / 2)
  const middle = managers.slice(midStart, midStart + 2).map((m) => ({
    ...m,
    bucket: "middle" as const,
  }))

  return [...best, ...middle, ...worst]
}

export async function getRetroPatterns(
  tenantId: string,
  limit = 9
): Promise<PatternData[]> {
  const all = await getPatterns(tenantId)
  return [...all].sort((a, b) => b.strength - a.strength).slice(0, limit)
}
