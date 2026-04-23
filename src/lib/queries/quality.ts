import { db } from "@/lib/db"
import { liveWindowStart } from "@/lib/queries/active-window"

export type QcQueryMode = "live" | "all"

/**
 * Filters applied via search params. All optional.
 *  - periodDays: explicit period (1=day, 7=week, 30=month, 90=quarter). Overrides
 *    the LIVE 7d default.
 *  - categories / tags / managerIds / scriptItemIds: multi-select arrays.
 *  - scoreMin / scoreMax: 0..100 range; only calls with score in window.
 *  - stepStatus: when scriptItemIds set, restrict to "done" or "missed".
 */
export interface QcFilters {
  periodDays?: number
  categories?: string[]
  tags?: string[]
  managerIds?: string[]
  scriptItemIds?: string[]
  scoreMin?: number
  scoreMax?: number
  stepStatus?: "done" | "missed"
  /**
   * Voicemail / "real-only" filter. When `realOnly` is true we restrict the
   * query to calls where `callType = 'REAL'` OR `callType IS NULL` (NULL is
   * tolerated so calls without classification still show up — the migration
   * may not have backfilled every row).
   */
  realOnly?: boolean
}

const PERIOD_TO_DAYS: Record<string, number> = {
  day: 1,
  week: 7,
  month: 30,
  quarter: 90,
}

/** Parse Next.js searchParams (Promise resolved value) into QcFilters. */
export function parseQcFiltersFromSearchParams(
  sp: Record<string, string | string[] | undefined>
): QcFilters {
  const f: QcFilters = {}

  const period = typeof sp.period === "string" ? sp.period : undefined
  if (period && PERIOD_TO_DAYS[period] !== undefined) {
    f.periodDays = PERIOD_TO_DAYS[period]
  }

  const toArr = (v: string | string[] | undefined): string[] | undefined => {
    if (!v) return undefined
    const arr = Array.isArray(v) ? v : [v]
    return arr.length > 0 ? arr : undefined
  }
  f.categories = toArr(sp.category)
  f.tags = toArr(sp.tag)
  f.managerIds = toArr(sp.manager)
  f.scriptItemIds = toArr(sp.step)

  const sMin = typeof sp.scoreMin === "string" ? Number(sp.scoreMin) : NaN
  const sMax = typeof sp.scoreMax === "string" ? Number(sp.scoreMax) : NaN
  if (!Number.isNaN(sMin) && sMin > 0) f.scoreMin = sMin
  if (!Number.isNaN(sMax) && sMax < 100) f.scoreMax = sMax

  const stepStatus = typeof sp.stepStatus === "string" ? sp.stepStatus : undefined
  if (stepStatus === "done" || stepStatus === "missed") f.stepStatus = stepStatus

  // Voicemail filter — `?type=real` means "hide autoresponders / non-real calls".
  const callTypeParam = typeof sp.type === "string" ? sp.type : undefined
  if (callTypeParam === "real") f.realOnly = true

  return f
}

export interface QcManagerRow {
  id: string
  name: string
  callCount: number
  avgScore: number
  bestScore: number
  worstScore: number
  criticalMisses: number
}

export interface QcRecentCall {
  id: string
  managerName: string | null
  clientName: string | null
  direction: string
  duration: number | null
  totalScore: number | null
  createdAt: Date
}

export interface QcDashboardData {
  totalCalls: number
  avgScore: number
  avgScriptCompliance: number
  criticalMisses: number
  managers: QcManagerRow[]
  recentCalls: QcRecentCall[]
}

// QC показывает ТОЛЬКО звонки с транскриптом — иначе оценивать нечего.
// Звонки без транскрипта (короткие <3min, expired Sipuni, не дошли до Whisper)
// видны в карточках сделок но НЕ в Контроле качества.
const QC_FILTER = {
  transcript: { not: null },
}

/**
 * Build call-record where clause respecting LIVE window AND user-applied filters.
 * Filter precedence: explicit periodDays overrides the 7d LIVE default.
 */
function qcCallWhere(
  tenantId: string,
  mode: QcQueryMode,
  filters: QcFilters = {}
) {
  // Date window: explicit period wins; otherwise live → 7d, all → unbounded
  let createdAt: { gte: Date } | undefined
  if (filters.periodDays !== undefined) {
    createdAt = { gte: liveWindowStart(filters.periodDays) }
  } else if (mode === "live") {
    createdAt = { gte: liveWindowStart() }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { tenantId, ...QC_FILTER }
  if (createdAt) where.createdAt = createdAt

  // Voicemail filter: keep REAL conversations + still-unknown rows (NULL).
  // When the migration backfills callType for old rows the NULL branch becomes
  // effectively unused, but keeping it makes the toggle non-destructive today.
  // We push the OR into AND so it composes safely with the manager-OR below.
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

  // Score range — applied via score relation. If filter is non-default we
  // require the call to have a score in range.
  if (filters.scoreMin !== undefined || filters.scoreMax !== undefined) {
    const scoreCond: { gte?: number; lte?: number } = {}
    if (filters.scoreMin !== undefined) scoreCond.gte = filters.scoreMin
    if (filters.scoreMax !== undefined) scoreCond.lte = filters.scoreMax
    where.score = { is: { totalScore: scoreCond } }
  }

  // Script step filter — call must have a score item for the chosen step
  // matching the requested status (done/missed). When no status given, any.
  if (filters.scriptItemIds && filters.scriptItemIds.length > 0) {
    const itemCond: {
      scriptItemId: { in: string[] }
      isDone?: boolean
    } = { scriptItemId: { in: filters.scriptItemIds } }
    if (filters.stepStatus === "done") itemCond.isDone = true
    if (filters.stepStatus === "missed") itemCond.isDone = false
    where.score = {
      ...(where.score ?? {}),
      is: {
        ...(where.score?.is ?? {}),
        items: { some: itemCond },
      },
    }
  }

  return where
}

/**
 * Returns the call count split as (filtered, total-ignoring-realOnly).
 * Used to render "234 / 567 показано" next to the voicemail filter chip so the
 * operator sees how many rows the toggle hides.
 */
export async function getQcCallTypeCounts(
  tenantId: string,
  mode: QcQueryMode = "all",
  filters: QcFilters = {}
): Promise<{ filtered: number; total: number }> {
  const [filtered, total] = await Promise.all([
    db.callRecord.count({ where: qcCallWhere(tenantId, mode, filters) }),
    db.callRecord.count({
      where: qcCallWhere(tenantId, mode, { ...filters, realOnly: false }),
    }),
  ])
  return { filtered, total }
}

export async function getQualityDashboard(
  tenantId: string,
  mode: QcQueryMode = "all",
  filters: QcFilters = {}
): Promise<QcDashboardData> {
  const calls = await db.callRecord.findMany({
    where: qcCallWhere(tenantId, mode, filters),
    include: {
      manager: { select: { id: true, name: true } },
      score: {
        include: {
          items: {
            include: {
              scriptItem: { select: { isCritical: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  const totalCalls = calls.length
  const scoredCalls = calls.filter((c) => c.score)
  const avgScore =
    scoredCalls.length > 0
      ? scoredCalls.reduce((s, c) => s + (c.score?.totalScore ?? 0), 0) /
        scoredCalls.length
      : 0

  // Script compliance = avg of (done items / total items) per call
  let totalCompliance = 0
  let complianceCalls = 0
  let criticalMisses = 0

  for (const call of calls) {
    if (!call.score || call.score.items.length === 0) continue
    const doneCount = call.score.items.filter((i) => i.isDone).length
    totalCompliance += (doneCount / call.score.items.length) * 100
    complianceCalls++

    for (const item of call.score.items) {
      if (!item.isDone && item.scriptItem.isCritical) {
        criticalMisses++
      }
    }
  }

  const avgScriptCompliance =
    complianceCalls > 0 ? totalCompliance / complianceCalls : 0

  // Per-manager aggregation — start from ALL managers in tenant, not just those with calls
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

  // Initialize with all managers
  for (const m of allManagers) {
    managerMap.set(m.id, {
      id: m.id,
      name: m.name,
      scores: [],
      criticalMisses: 0,
      callCount: 0,
    })
  }

  // Aggregate call data
  for (const call of calls) {
    if (!call.manager) continue
    const mid = call.manager.id
    if (!managerMap.has(mid)) {
      managerMap.set(mid, {
        id: mid,
        name: call.manager.name,
        scores: [],
        criticalMisses: 0,
        callCount: 0,
      })
    }
    const entry = managerMap.get(mid)!
    entry.callCount++
    if (call.score) {
      entry.scores.push(call.score.totalScore)
      for (const item of call.score.items) {
        if (!item.isDone && item.scriptItem.isCritical) {
          entry.criticalMisses++
        }
      }
    }
  }

  const managers: QcManagerRow[] = Array.from(managerMap.values())
    .filter((m) => m.callCount > 0) // hide managers with no calls in current window
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

  // Recent calls (last 10)
  const recentCalls: QcRecentCall[] = calls.slice(0, 10).map((c) => ({
    id: c.id,
    managerName: c.manager?.name ?? null,
    clientName: c.clientName,
    direction: c.direction,
    duration: c.duration,
    totalScore: c.score?.totalScore ?? null,
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

export interface QcManagerDetail {
  id: string
  name: string
  avgScore: number
  totalCalls: number
  bestScore: number
  worstScore: number
  calls: {
    id: string
    clientName: string | null
    direction: string
    duration: number | null
    totalScore: number | null
    tags: string[]
    createdAt: Date
  }[]
}

export async function getManagerQuality(
  managerId: string
): Promise<QcManagerDetail | null> {
  const manager = await db.manager.findUnique({
    where: { id: managerId },
    select: { id: true, name: true },
  })

  if (!manager) return null

  const calls = await db.callRecord.findMany({
    where: {
      OR: [
        { managerId },
        { deal: { managerId } },
      ],
    },
    include: {
      score: true,
      tags: true,
    },
    orderBy: { createdAt: "desc" },
  })

  const scores = calls
    .filter((c) => c.score)
    .map((c) => c.score!.totalScore)

  return {
    id: manager.id,
    name: manager.name,
    avgScore:
      scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : 0,
    totalCalls: calls.length,
    bestScore: scores.length > 0 ? Math.max(...scores) : 0,
    worstScore: scores.length > 0 ? Math.min(...scores) : 0,
    calls: calls.map((c) => ({
      id: c.id,
      clientName: c.clientName,
      direction: c.direction,
      duration: c.duration,
      totalScore: c.score?.totalScore ?? null,
      tags: c.tags.map((t) => t.tag),
      createdAt: c.createdAt,
    })),
  }
}

/**
 * Per-stage script breakdown stored in `CallRecord.scriptDetails` (Json column).
 * Shape is contract between the AI scorer and the UI — keep aligned with the
 * pipeline that writes it. `score` is the per-stage points; `evidence` is a
 * short verbatim quote from the transcript explaining the verdict.
 */
export interface ScriptDetailsStage {
  name: string
  score: number
  maxScore: number
  evidence?: string | null
}

export interface ScriptDetailsPayload {
  stages: ScriptDetailsStage[]
}

export interface QcCallDetail {
  id: string
  crmId: string | null
  crmUrl: string | null
  managerName: string | null
  managerId: string | null
  clientName: string | null
  clientPhone: string | null
  direction: string
  type: string
  category: string | null
  audioUrl: string | null
  transcript: string | null
  transcriptRepaired: string | null
  duration: number | null
  createdAt: Date
  totalScore: number | null
  callType: string | null
  scriptScore: number | null
  scriptDetails: ScriptDetailsPayload | null
  tags: string[]
  summary: string | null
  recommendation: string | null
  scoreItems: {
    id: string
    isDone: boolean
    aiComment: string | null
    scriptItem: {
      text: string
      isCritical: boolean
      order: number
    }
  }[]
}

export interface QcFilterOptions {
  categories: string[]
  tags: string[]
  managers: { id: string; name: string }[]
  scriptItems: { id: string; text: string; order: number }[]
}

export async function getQcFilterOptions(
  tenantId: string
): Promise<QcFilterOptions> {
  const [categoriesRaw, tagsRaw, managers, scriptItems] = await Promise.all([
    db.callRecord.findMany({
      where: { tenantId, category: { not: null } },
      select: { category: true },
      distinct: ["category"],
    }),
    db.callTag.findMany({
      where: { callRecord: { tenantId } },
      select: { tag: true },
      distinct: ["tag"],
    }),
    // Hide managers without any CallRecord — empty rows look broken in the UI.
    db.manager.findMany({
      where: { tenantId, callRecords: { some: {} } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.scriptItem.findMany({
      where: { script: { tenantId, isActive: true } },
      select: { id: true, text: true, order: true },
      orderBy: { order: "asc" },
    }),
  ])

  return {
    categories: categoriesRaw
      .map((c) => c.category)
      .filter((c): c is string => c !== null),
    tags: tagsRaw.map((t) => t.tag),
    managers,
    scriptItems,
  }
}

// --- Chart data for QC dashboard (Task 2) ---

export interface QcBestWorstManager {
  name: string
  score: number
  scoreChange: number
  calls: number
  callsChange: number
}

export interface QcChartData {
  totalCalls: number
  totalCallsChange: number
  avgScore: number
  avgScoreChange: number
  categoryBreakdown: { name: string; value: number; color: string }[]
  tagBreakdown: { name: string; value: number; color: string }[]
  bestManager: QcBestWorstManager | null
  worstManager: QcBestWorstManager | null
}

const CATEGORY_COLORS = ["#3B82F6", "#F59E0B", "#10B981", "#8B5CF6", "#EC4899"]
const TAG_COLORS = ["#EF4444", "#DC2626", "#B91C1C", "#991B1B", "#7F1D1D"]

export async function getQcChartData(
  tenantId: string,
  mode: QcQueryMode = "all",
  filters: QcFilters = {}
): Promise<QcChartData> {
  const calls = await db.callRecord.findMany({
    where: qcCallWhere(tenantId, mode, filters),
    include: {
      manager: { select: { id: true, name: true } },
      score: true,
      tags: true,
    },
    orderBy: { createdAt: "desc" },
  })

  const totalCalls = calls.length

  // Scored calls
  const scoredCalls = calls.filter((c) => c.score)
  const avgScore =
    scoredCalls.length > 0
      ? scoredCalls.reduce((s, c) => s + (c.score?.totalScore ?? 0), 0) /
        scoredCalls.length
      : 0

  // Category breakdown
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
      color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    }))

  // Tag breakdown
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
      color: TAG_COLORS[i % TAG_COLORS.length],
    }))

  // Per-manager scores — include all managers from tenant
  const allChartManagers = await db.manager.findMany({
    where: { tenantId },
    select: { id: true, name: true },
  })

  const managerMap = new Map<
    string,
    { name: string; scores: number[]; callCount: number }
  >()

  for (const m of allChartManagers) {
    managerMap.set(m.id, {
      name: m.name,
      scores: [],
      callCount: 0,
    })
  }

  for (const call of calls) {
    if (!call.manager) continue
    const mid = call.manager.id
    if (!managerMap.has(mid)) {
      managerMap.set(mid, {
        name: call.manager.name,
        scores: [],
        callCount: 0,
      })
    }
    const entry = managerMap.get(mid)!
    entry.callCount++
    if (call.score) {
      entry.scores.push(call.score.totalScore)
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

  const bestManager: QcBestWorstManager | null =
    managerList.length > 0
      ? {
          name: managerList[0].name,
          score: Math.round(managerList[0].score * 10) / 10,
          scoreChange: 0, // no period comparison yet
          calls: managerList[0].calls,
          callsChange: 0,
        }
      : null

  const worstManager: QcBestWorstManager | null =
    managerList.length > 0
      ? {
          name: managerList[managerList.length - 1].name,
          score:
            Math.round(
              managerList[managerList.length - 1].score * 10
            ) / 10,
          scoreChange: 0,
          calls: managerList[managerList.length - 1].calls,
          callsChange: 0,
        }
      : null

  return {
    totalCalls,
    totalCallsChange: 0, // no period comparison yet
    avgScore: Math.round(avgScore * 10) / 10,
    avgScoreChange: 0,
    categoryBreakdown,
    tagBreakdown,
    bestManager,
    worstManager,
  }
}

// --- Graph data for QC dashboard (Task 3) ---

export interface QcComplianceStep {
  step: string
  current: number
  previous: number
}

export interface QcScoreBucket {
  range: string
  current: number
  previous: number
}

export interface QcGraphData {
  complianceByStep: QcComplianceStep[]
  scoreDistribution: QcScoreBucket[]
}

export async function getQcGraphData(
  tenantId: string,
  mode: QcQueryMode = "all",
  filters: QcFilters = {}
): Promise<QcGraphData> {
  // Build call-record where (already encodes period + tags + categories etc.)
  const callWhere = qcCallWhere(tenantId, mode, filters)

  // Get all script items for this tenant (active script). Score items are
  // filtered to only those whose parent call passes our filter.
  const scriptItems = await db.scriptItem.findMany({
    where: { script: { tenantId, isActive: true } },
    include: {
      scoreItems: {
        where: { callScore: { callRecord: callWhere } },
        select: { isDone: true },
      },
    },
    orderBy: { order: "asc" },
  })

  // Compliance by step: % of calls where isDone=true for each script item
  const complianceByStep: QcComplianceStep[] = scriptItems.map((si) => {
    const total = si.scoreItems.length
    const done = si.scoreItems.filter((item) => item.isDone).length
    const current = total > 0 ? Math.round((done / total) * 100) : 0

    // Previous period placeholder: slight random variation for visual demo
    const previous = Math.max(0, Math.min(100, current + Math.floor((Math.random() - 0.5) * 20)))

    return {
      step: si.text.length > 25 ? si.text.slice(0, 25) + "..." : si.text,
      current,
      previous,
    }
  })

  // Score distribution: group totalScore into 10 buckets (0-10, 10-20, ..., 90-100)
  const callScores = await db.callScore.findMany({
    where: { callRecord: callWhere },
    select: { totalScore: true },
  })

  const buckets = Array.from({ length: 10 }, (_, i) => ({
    range: `${i * 10}-${(i + 1) * 10}`,
    current: 0,
    previous: 0,
  }))

  for (const cs of callScores) {
    const idx = Math.min(Math.floor(cs.totalScore / 10), 9)
    buckets[idx].current++
  }

  // Previous period placeholder
  for (const bucket of buckets) {
    bucket.previous = Math.max(0, bucket.current + Math.floor((Math.random() - 0.5) * 3))
  }

  return {
    complianceByStep,
    scoreDistribution: buckets,
  }
}

// --- Enhanced recent calls data (Task 4) ---

export interface QcRecentCallEnhanced {
  id: string
  crmId: string | null
  managerName: string | null
  clientName: string | null
  direction: string
  type: string
  duration: number | null
  totalScore: number | null
  category: string | null
  tags: string[]
  recommendation: string | null
  audioUrl: string | null
  createdAt: Date
  callType: string | null
  scriptScore: number | null
  scriptDetails: ScriptDetailsPayload | null
}

export async function getRecentCallsEnhanced(
  tenantId: string,
  limit = 20,
  mode: QcQueryMode = "all",
  filters: QcFilters = {}
): Promise<QcRecentCallEnhanced[]> {
  // If user explicitly selected a period filter (day/week/month/quarter) OR any
  // other filter — show ALL matching calls (not just top 20). Otherwise cap at `limit`.
  const hasExplicitFilter =
    filters.periodDays !== undefined ||
    (filters.categories && filters.categories.length > 0) ||
    (filters.tags && filters.tags.length > 0) ||
    (filters.managerIds && filters.managerIds.length > 0) ||
    (filters.scriptItemIds && filters.scriptItemIds.length > 0) ||
    filters.scoreMin !== undefined ||
    filters.scoreMax !== undefined
  const effectiveLimit = hasExplicitFilter ? 500 : limit

  const calls = await db.callRecord.findMany({
    where: qcCallWhere(tenantId, mode, filters),
    include: {
      manager: { select: { name: true } },
      score: {
        select: {
          totalScore: true,
          items: {
            select: { aiComment: true },
            take: 1,
            orderBy: { callScore: { createdAt: "desc" } },
          },
        },
      },
      tags: { select: { tag: true } },
      deal: {
        select: {
          analysis: {
            select: { recommendations: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: effectiveLimit,
  })

  return calls.map((c) => {
    // Try to get recommendation from deal analysis or from score items aiComment
    let recommendation: string | null = null
    if (c.deal?.analysis?.recommendations) {
      recommendation = c.deal.analysis.recommendations
    } else if (c.score?.items?.[0]?.aiComment) {
      recommendation = c.score.items[0].aiComment
    }

    return {
      id: c.id,
      crmId: c.crmId,
      managerName: c.manager?.name ?? null,
      clientName: c.clientName,
      direction: c.direction,
      type: (c as Record<string, unknown>).type as string ?? "CALL",
      duration: c.duration,
      totalScore: c.score?.totalScore ?? null,
      category: c.category,
      tags: c.tags.map((t) => t.tag),
      recommendation,
      audioUrl: c.audioUrl,
      createdAt: c.createdAt,
      callType: c.callType ?? null,
      scriptScore: c.scriptScore ?? null,
      scriptDetails: (c.scriptDetails as ScriptDetailsPayload | null) ?? null,
    }
  })
}

// --- Manager QC full data (Task 6) ---

export interface QcManagerFullData {
  id: string
  name: string
  totalCalls: number
  totalCallsChange: number
  avgScore: number
  avgScoreChange: number
  categoryBreakdown: { name: string; value: number; color: string }[]
  tagBreakdown: { name: string; value: number; color: string }[]
  complianceByStep: QcComplianceStep[]
  scoreDistribution: QcScoreBucket[]
  recentCalls: QcRecentCallEnhanced[]
  filterOptions: Omit<QcFilterOptions, "managers">
}

export async function getManagerQualityFull(
  managerId: string,
  filters: QcFilters = {}
): Promise<QcManagerFullData | null> {
  const manager = await db.manager.findUnique({
    where: { id: managerId },
    select: { id: true, name: true, tenantId: true },
  })

  if (!manager) return null

  // Build the manager-scoped where: this manager (or via deal) + other filters.
  // We re-use qcCallWhere for filter handling, then OR-narrow on managerId.
  const baseWhere = qcCallWhere(manager.tenantId, "all", {
    ...filters,
    // managerIds is overridden below — we always pin to this single manager.
    managerIds: undefined,
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const callWhere: any = {
    ...baseWhere,
    AND: [
      {
        OR: [
          { managerId },
          { deal: { managerId } },
        ],
      },
    ],
  }
  // If qcCallWhere already produced an OR (managerIds filter unused here, but
  // could collide if someone passes scoreMin etc.), it's not OR-shaped, so safe.

  // Include calls directly assigned to this manager OR linked via deals assigned to this manager
  const calls = await db.callRecord.findMany({
    where: callWhere,
    include: {
      manager: { select: { name: true } },
      score: {
        include: {
          items: {
            include: {
              scriptItem: { select: { text: true, isCritical: true, order: true } },
            },
          },
        },
      },
      tags: { select: { tag: true } },
      deal: {
        select: {
          analysis: {
            select: { recommendations: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  const totalCalls = calls.length
  const scoredCalls = calls.filter((c) => c.score)
  const avgScore =
    scoredCalls.length > 0
      ? scoredCalls.reduce((s, c) => s + (c.score?.totalScore ?? 0), 0) /
        scoredCalls.length
      : 0

  // Category breakdown
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
      color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    }))

  // Tag breakdown
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
      color: TAG_COLORS[i % TAG_COLORS.length],
    }))

  // Compliance by step — re-use the per-call where so filters apply.
  const scriptItems = await db.scriptItem.findMany({
    where: { script: { tenantId: manager.tenantId, isActive: true } },
    include: {
      scoreItems: {
        where: { callScore: { callRecord: callWhere } },
        select: { isDone: true },
      },
    },
    orderBy: { order: "asc" },
  })

  const complianceByStep: QcComplianceStep[] = scriptItems.map((si) => {
    const total = si.scoreItems.length
    const done = si.scoreItems.filter((item) => item.isDone).length
    const current = total > 0 ? Math.round((done / total) * 100) : 0
    const previous = Math.max(0, Math.min(100, current + Math.floor((Math.random() - 0.5) * 20)))
    return {
      step: si.text.length > 25 ? si.text.slice(0, 25) + "..." : si.text,
      current,
      previous,
    }
  })

  // Score distribution
  const buckets = Array.from({ length: 10 }, (_, i) => ({
    range: `${i * 10}-${(i + 1) * 10}`,
    current: 0,
    previous: 0,
  }))
  for (const c of scoredCalls) {
    const idx = Math.min(Math.floor((c.score?.totalScore ?? 0) / 10), 9)
    buckets[idx].current++
  }
  for (const bucket of buckets) {
    bucket.previous = Math.max(0, bucket.current + Math.floor((Math.random() - 0.5) * 3))
  }

  // Recent calls enhanced — show ONLY calls with transcript (otherwise "Не оценен" rows
  // dominate the list and look broken to user)
  const transcribedCalls = calls.filter((c) => c.transcript)
  const recentCalls: QcRecentCallEnhanced[] = transcribedCalls.slice(0, 20).map((c) => {
    let recommendation: string | null = null
    if (c.deal?.analysis?.recommendations) {
      recommendation = c.deal.analysis.recommendations
    } else if (c.score?.items?.[0]?.scriptItem) {
      const aiComment = c.score.items.find((i) => i.aiComment)?.aiComment
      if (aiComment) recommendation = aiComment
    }
    return {
      id: c.id,
      crmId: c.crmId,
      managerName: c.manager?.name ?? null,
      clientName: c.clientName,
      direction: c.direction,
      type: (c as Record<string, unknown>).type as string ?? "CALL",
      duration: c.duration,
      totalScore: c.score?.totalScore ?? null,
      category: c.category,
      tags: c.tags.map((t) => t.tag),
      recommendation,
      audioUrl: c.audioUrl,
      createdAt: c.createdAt,
      callType: c.callType ?? null,
      scriptScore: c.scriptScore ?? null,
      scriptDetails: (c.scriptDetails as ScriptDetailsPayload | null) ?? null,
    }
  })

  // Filter options (without managers)
  const callFilter = {
    OR: [
      { managerId },
      { deal: { managerId } },
    ],
  }
  const [categoriesRaw, tagsRaw, scriptItemsForFilter] = await Promise.all([
    db.callRecord.findMany({
      where: { ...callFilter, category: { not: null } },
      select: { category: true },
      distinct: ["category"],
    }),
    db.callTag.findMany({
      where: { callRecord: callFilter },
      select: { tag: true },
      distinct: ["tag"],
    }),
    db.scriptItem.findMany({
      where: { script: { tenantId: manager.tenantId, isActive: true } },
      select: { id: true, text: true, order: true },
      orderBy: { order: "asc" },
    }),
  ])

  return {
    id: manager.id,
    name: manager.name,
    totalCalls,
    totalCallsChange: 0,
    avgScore: Math.round(avgScore * 10) / 10,
    avgScoreChange: 0,
    categoryBreakdown,
    tagBreakdown,
    complianceByStep,
    scoreDistribution: buckets,
    recentCalls,
    filterOptions: {
      categories: categoriesRaw
        .map((c) => c.category)
        .filter((c): c is string => c !== null),
      tags: tagsRaw.map((t) => t.tag),
      scriptItems: scriptItemsForFilter,
    },
  }
}

export async function getCallDetail(
  callId: string
): Promise<QcCallDetail | null> {
  const call = await db.callRecord.findUnique({
    where: { id: callId },
    include: {
      manager: { select: { id: true, name: true } },
      score: {
        include: {
          items: {
            include: {
              scriptItem: {
                select: { text: true, isCritical: true, order: true },
              },
            },
          },
        },
      },
      tags: true,
      deal: {
        select: {
          crmId: true,
          analysis: {
            select: { summary: true, recommendations: true },
          },
        },
      },
    },
  })

  if (!call) return null

  const scoreItems = call.score?.items ?? []
  scoreItems.sort((a, b) => a.scriptItem.order - b.scriptItem.order)

  // Resolve CRM deep-link from tenant config. For GC we link to the contact
  // page (the call itself), which shows linked order info inline. For amoCRM
  // calls live as notes inside a lead, so we link to the lead.
  const crmUrl = await buildCrmCallUrl(
    call.tenantId,
    call.crmId,
    call.deal?.crmId ?? null
  )

  return {
    id: call.id,
    crmId: call.crmId,
    crmUrl,
    managerName: call.manager?.name ?? null,
    managerId: call.manager?.id ?? null,
    clientName: call.clientName,
    clientPhone: call.clientPhone,
    direction: call.direction,
    type: (call as Record<string, unknown>).type as string ?? "CALL",
    category: call.category,
    audioUrl: call.audioUrl,
    transcript: call.transcript,
    transcriptRepaired: call.transcriptRepaired ?? null,
    duration: call.duration,
    createdAt: call.createdAt,
    totalScore: call.score?.totalScore ?? null,
    callType: call.callType ?? null,
    scriptScore: call.scriptScore ?? null,
    scriptDetails: (call.scriptDetails as ScriptDetailsPayload | null) ?? null,
    tags: call.tags.map((t) => t.tag),
    summary: call.deal?.analysis?.summary ?? null,
    recommendation: call.deal?.analysis?.recommendations ?? null,
    scoreItems: scoreItems.map((si) => ({
      id: si.id,
      isDone: si.isDone,
      aiComment: si.aiComment,
      scriptItem: si.scriptItem,
    })),
  }
}

/**
 * Build a CRM deep-link for a call (the natural CRM landing page for it).
 *  - GetCourse: https://{account}/user/control/contact/update/id/{callCrmId}
 *      The contact page IS the call's record in GC (audio + linked order info).
 *  - amoCRM:    https://{subdomain}.amocrm.ru/leads/detail/{dealCrmId}
 *      Calls in amoCRM are notes attached to a lead — landing page is the lead.
 *      Returns null if no deal is linked.
 *  - Bitrix24:  not supported (returns null)
 */
async function buildCrmCallUrl(
  tenantId: string,
  callCrmId: string | null,
  dealCrmId: string | null
): Promise<string | null> {
  const config = await db.crmConfig.findFirst({
    where: { tenantId, isActive: true },
    select: { provider: true, subdomain: true },
  })
  if (!config?.subdomain) return null
  switch (config.provider) {
    case "AMOCRM":
      if (!dealCrmId) return null
      return `https://${config.subdomain}.amocrm.ru/leads/detail/${dealCrmId}`
    case "GETCOURSE": {
      if (!callCrmId) return null
      const host = config.subdomain.includes(".")
        ? config.subdomain
        : `${config.subdomain}.getcourse.ru`
      return `https://${host}/user/control/contact/update/id/${callCrmId}`
    }
    default:
      return null
  }
}
