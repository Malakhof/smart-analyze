/**
 * quality-gc.ts — parallel quality queries for diva (GETCOURSE) tenants.
 *
 * The legacy `quality.ts` reads CallScore relations populated by the Sipuni
 * pipeline. Diva's Master Enrich pipeline writes flat fields directly on
 * CallRecord (scriptScorePct / scriptDetails / phraseCompliance /
 * criticalErrors / nextStepRecommendation), and never creates CallScore rows.
 *
 * These functions return the SAME interface shapes as the legacy queries so
 * `/quality` page can switch by `getCrmProvider(tenantId)` (Task 23) without
 * any consumer changes.
 *
 * Signature note: we mirror the legacy `(tenantId, mode, filters)` triple so
 * the call sites in page.tsx can swap implementations one-for-one. Date window
 * resolution lives inside via `qcCallWhereGc`, identical to legacy `qcCallWhere`.
 *
 * Field-mapping notes (CallRecord-flat → QcDashboardData):
 *   scriptScorePct (0..1)  → avgScore = mean(scriptScorePct) * 100
 *   scriptScorePct (0..1)  → avgScriptCompliance = mean(scriptScorePct) * 100
 *                            (proxy: detailed phraseCompliance roll-up could be
 *                             added later, but scriptScorePct is the canonical
 *                             diva quality signal)
 *   criticalErrors (Json[])→ criticalMisses = sum(array.length)
 */
import { db } from "@/lib/db"
import { liveWindowStart } from "@/lib/queries/active-window"
import type {
  QcChartData,
  QcDashboardData,
  QcFilters,
  QcManagerRow,
  QcQueryMode,
  QcRecentCall,
} from "./quality"

// Re-export so consumers can import types from a single module if desired.
export type { QcChartData, QcDashboardData, QcFilters, QcQueryMode, QcRecentCall }

// Diva calls are scored only when:
//   1. Master Enrich produced scriptScorePct (transcript-backed quality signal)
//   2. callOutcome === 'real_conversation' (skip voicemail/unanswered)
//   3. duration ≥ 60s (very short noise filtered out)
const QC_FILTER_GC = {
  scriptScorePct: { not: null as never },
  callOutcome: "real_conversation",
  duration: { gte: 60 },
}

/**
 * Mirror of legacy `qcCallWhere` for diva: same date-window precedence and
 * filter handling, but the QC base predicate keys off CallRecord-flat fields
 * (scriptScorePct/callOutcome/duration) instead of `transcript IS NOT NULL`.
 */
function qcCallWhereGc(
  tenantId: string,
  mode: QcQueryMode,
  filters: QcFilters = {}
) {
  let createdAt: { gte: Date } | undefined
  if (filters.periodDays !== undefined) {
    createdAt = { gte: liveWindowStart(filters.periodDays) }
  } else if (mode === "live") {
    createdAt = { gte: liveWindowStart() }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { tenantId, ...QC_FILTER_GC }
  if (createdAt) where.createdAt = createdAt

  if (filters.realOnly) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const andList: any[] = where.AND ?? []
    andList.push({
      OR: [{ callType: "REAL" }, { callType: null }],
    })
    where.AND = andList
  }

  if (filters.categories && filters.categories.length > 0) {
    where.category = { in: filters.categories }
  }

  if (filters.managerIds && filters.managerIds.length > 0) {
    where.OR = [
      { managerId: { in: filters.managerIds } },
      { deal: { managerId: { in: filters.managerIds } } },
    ]
  }

  if (filters.tags && filters.tags.length > 0) {
    where.tags = { some: { tag: { in: filters.tags } } }
  }

  // Score range: scriptScorePct is 0..1 in DB; QcFilters scoreMin/Max are 0..100.
  if (filters.scoreMin !== undefined || filters.scoreMax !== undefined) {
    const scoreCond: { gte?: number; lte?: number } = {}
    if (filters.scoreMin !== undefined) scoreCond.gte = filters.scoreMin / 100
    if (filters.scoreMax !== undefined) scoreCond.lte = filters.scoreMax / 100
    where.scriptScorePct = { ...where.scriptScorePct, ...scoreCond }
  }

  // scriptItemIds / stepStatus filters intentionally not implemented — diva
  // doesn't have per-step ScoreItem rows. Step-level filtering for diva would
  // need to walk scriptDetails Json; deferred until UI exposes step pickers.

  return where
}

function countCriticalErrors(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

export async function getQualityDashboardGc(
  tenantId: string,
  mode: QcQueryMode = "all",
  filters: QcFilters = {}
): Promise<QcDashboardData> {
  const calls = await db.callRecord.findMany({
    where: qcCallWhereGc(tenantId, mode, filters),
    select: {
      id: true,
      managerId: true,
      manager: { select: { id: true, name: true } },
      clientName: true,
      direction: true,
      duration: true,
      createdAt: true,
      scriptScorePct: true,
      criticalErrors: true,
    },
    orderBy: { createdAt: "desc" },
  })

  const totalCalls = calls.length

  // avgScore: scriptScorePct (0..1) * 100. Skip nulls (where guarantees not-null
  // but TS typing keeps it nullable).
  const scored = calls.filter((c) => c.scriptScorePct != null)
  const avgScore =
    scored.length > 0
      ? (scored.reduce((s, c) => s + (c.scriptScorePct ?? 0), 0) / scored.length) * 100
      : 0

  // avgScriptCompliance: proxy via scriptScorePct until phraseCompliance roll-up
  // is wired. Both metrics measure "how well script was followed" — using the
  // same source keeps the dashboard consistent.
  const avgScriptCompliance = avgScore

  // criticalMisses: total count across all calls' criticalErrors arrays.
  const criticalMisses = calls.reduce(
    (s, c) => s + countCriticalErrors(c.criticalErrors),
    0
  )

  // Per-manager rollup. Start from all tenant managers so the table includes
  // managers with zero qualifying calls (legacy behavior — but those are
  // filtered out at the end by callCount > 0).
  const allManagers = await db.manager.findMany({
    where: { tenantId },
    select: { id: true, name: true },
  })

  const managerMap = new Map<
    string,
    {
      id: string
      name: string
      scores: number[]
      criticalMisses: number
      callCount: number
    }
  >()

  for (const m of allManagers) {
    managerMap.set(m.id, {
      id: m.id,
      name: m.name,
      scores: [],
      criticalMisses: 0,
      callCount: 0,
    })
  }

  for (const call of calls) {
    if (!call.manager) continue
    const mid = call.manager.id
    const entry =
      managerMap.get(mid) ??
      managerMap
        .set(mid, {
          id: mid,
          name: call.manager.name,
          scores: [],
          criticalMisses: 0,
          callCount: 0,
        })
        .get(mid)!
    entry.callCount++
    if (call.scriptScorePct != null) {
      // Store as 0..100 so best/worst/avg downstream are in the same unit.
      entry.scores.push(call.scriptScorePct * 100)
    }
    entry.criticalMisses += countCriticalErrors(call.criticalErrors)
  }

  const managers: QcManagerRow[] = Array.from(managerMap.values())
    .filter((m) => m.callCount > 0)
    .map((m) => ({
      id: m.id,
      name: m.name,
      callCount: m.callCount,
      avgScore:
        m.scores.length > 0
          ? m.scores.reduce((a, b) => a + b, 0) / m.scores.length
          : 0,
      bestScore: m.scores.length > 0 ? Math.max(...m.scores) : 0,
      worstScore: m.scores.length > 0 ? Math.min(...m.scores) : 0,
      criticalMisses: m.criticalMisses,
    }))

  managers.sort((a, b) => b.avgScore - a.avgScore)

  const recentCalls: QcRecentCall[] = calls.slice(0, 10).map((c) => ({
    id: c.id,
    managerName: c.manager?.name ?? null,
    clientName: c.clientName,
    direction: c.direction,
    duration: c.duration,
    totalScore: c.scriptScorePct != null ? c.scriptScorePct * 100 : null,
    createdAt: c.createdAt,
  }))

  return {
    totalCalls,
    avgScore,
    avgScriptCompliance,
    criticalMisses,
    managers,
    recentCalls,
  }
}

export async function getQcChartDataGc(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tenantId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  mode: QcQueryMode = "all",
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  filters: QcFilters = {}
): Promise<QcChartData> {
  throw new Error("not implemented (Task 21)")
}

export async function getQcRecentCallsGc(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tenantId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  mode: QcQueryMode = "all",
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  filters: QcFilters = {}
): Promise<QcRecentCall[]> {
  throw new Error("not implemented (Task 22)")
}
