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
  QcGraphData,
  QcManagerRow,
  QcQueryMode,
  QcRecentCall,
} from "./quality"

// Re-export so consumers can import types from a single module if desired.
export type { QcChartData, QcDashboardData, QcFilters, QcGraphData, QcQueryMode, QcRecentCall }

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

// Color palettes mirror the legacy quality.ts so charts look identical when
// the page swaps providers — keeps category #3 always orange, etc.
const CATEGORY_COLORS_GC = ["#3B82F6", "#F59E0B", "#10B981", "#8B5CF6", "#EC4899"]
const TAG_COLORS_GC = ["#EF4444", "#DC2626", "#B91C1C", "#991B1B", "#7F1D1D"]

export async function getQcChartDataGc(
  tenantId: string,
  mode: QcQueryMode = "all",
  filters: QcFilters = {}
): Promise<QcChartData> {
  const calls = await db.callRecord.findMany({
    where: qcCallWhereGc(tenantId, mode, filters),
    select: {
      category: true,
      scriptScorePct: true,
      manager: { select: { id: true, name: true } },
      tags: { select: { tag: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  const totalCalls = calls.length

  const scored = calls.filter((c) => c.scriptScorePct != null)
  const avgScore =
    scored.length > 0
      ? (scored.reduce((s, c) => s + (c.scriptScorePct ?? 0), 0) / scored.length) * 100
      : 0

  // Category breakdown — top by count, deterministic colors by sort order.
  const catMap = new Map<string, number>()
  for (const call of calls) {
    const cat = call.category ?? "Без категории"
    catMap.set(cat, (catMap.get(cat) ?? 0) + 1)
  }
  const categoryBreakdown = Array.from(catMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], i) => ({
      name,
      value,
      color: CATEGORY_COLORS_GC[i % CATEGORY_COLORS_GC.length],
    }))

  // Tag breakdown — top 5.
  const tagMap = new Map<string, number>()
  for (const call of calls) {
    for (const t of call.tags) {
      tagMap.set(t.tag, (tagMap.get(t.tag) ?? 0) + 1)
    }
  }
  const tagBreakdown = Array.from(tagMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, value], i) => ({
      name,
      value,
      color: TAG_COLORS_GC[i % TAG_COLORS_GC.length],
    }))

  // Per-manager scores — only managers with at least one scored call.
  const managerMap = new Map<string, { name: string; scores: number[]; callCount: number }>()
  for (const call of calls) {
    if (!call.manager) continue
    const mid = call.manager.id
    const entry =
      managerMap.get(mid) ??
      managerMap
        .set(mid, { name: call.manager.name, scores: [], callCount: 0 })
        .get(mid)!
    entry.callCount++
    if (call.scriptScorePct != null) {
      entry.scores.push(call.scriptScorePct * 100)
    }
  }

  const managerList = Array.from(managerMap.values())
    .filter((m) => m.scores.length > 0)
    .map((m) => ({
      name: m.name,
      score: m.scores.reduce((a, b) => a + b, 0) / m.scores.length,
      calls: m.callCount,
    }))
    .sort((a, b) => b.score - a.score)

  const bestManager =
    managerList.length > 0
      ? {
          name: managerList[0].name,
          score: Math.round(managerList[0].score * 10) / 10,
          scoreChange: 0, // no period comparison yet
          calls: managerList[0].calls,
          callsChange: 0,
        }
      : null

  const worstManager =
    managerList.length > 0
      ? {
          name: managerList[managerList.length - 1].name,
          score:
            Math.round(managerList[managerList.length - 1].score * 10) / 10,
          scoreChange: 0,
          calls: managerList[managerList.length - 1].calls,
          callsChange: 0,
        }
      : null

  return {
    totalCalls,
    totalCallsChange: 0, // no period comparison yet (parity with legacy)
    avgScore: Math.round(avgScore * 10) / 10,
    avgScoreChange: 0,
    categoryBreakdown,
    tagBreakdown,
    bestManager,
    worstManager,
  }
}

export async function getQcRecentCallsGc(
  tenantId: string,
  mode: QcQueryMode = "all",
  filters: QcFilters = {}
): Promise<QcRecentCall[]> {
  // Top 50 most recent qualifying calls. Legacy `getQualityDashboard` returns
  // 10 in its `recentCalls` field (already provided above); this function is
  // the standalone "recent calls" feed used for the dedicated list view.
  const rows = await db.callRecord.findMany({
    where: qcCallWhereGc(tenantId, mode, filters),
    select: {
      id: true,
      manager: { select: { name: true } },
      clientName: true,
      direction: true,
      duration: true,
      scriptScorePct: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  })

  return rows.map((r) => ({
    id: r.id,
    managerName: r.manager?.name ?? null,
    clientName: r.clientName,
    direction: r.direction,
    duration: r.duration,
    totalScore: r.scriptScorePct != null ? r.scriptScorePct * 100 : null,
    createdAt: r.createdAt,
  }))
}

/**
 * Stub for parity with legacy `getQcGraphData`. The legacy version reads
 * ScriptItem + CallScore.items relations to compute compliance-by-step and
 * a 0-100 score histogram. Diva's flat schema has no per-step ScoreItem rows
 * (the per-step signal lives inside `scriptDetails` Json on CallRecord).
 *
 * Returning an empty graph data shape keeps the page renderable for GC tenants
 * — the QcComplianceChart and QcScoreDistribution components handle empty
 * arrays gracefully (drawn as no-data states). A full implementation would
 * walk scriptDetails Json and build histogram from scriptScorePct buckets,
 * deferred until Task 44/45 (chart redesign) lands.
 */
export async function getQcGraphDataGc(
  _tenantId: string,
  _mode: QcQueryMode = "all",
  _filters: QcFilters = {}
): Promise<QcGraphData> {
  // Silence no-unused-vars while keeping the legacy `(tenantId, mode, filters)`
  // signature stable for the call-site switch in page.tsx.
  void _mode
  void _filters
  return {
    complianceByStep: [],
    scoreDistribution: Array.from({ length: 10 }, (_, i) => ({
      range: `${i * 10}-${(i + 1) * 10}`,
      current: 0,
      previous: 0,
    })),
  }
}
