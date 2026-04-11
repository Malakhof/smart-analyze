import { db } from "@/lib/db"
import { getTenantId } from "./dashboard"

export { getTenantId }

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

export async function getQualityDashboard(
  tenantId: string
): Promise<QcDashboardData> {
  const calls = await db.callRecord.findMany({
    where: { tenantId },
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

  // Per-manager aggregation
  const managerMap = new Map<
    string,
    {
      id: string
      name: string
      scores: number[]
      criticalMisses: number
    }
  >()

  for (const call of calls) {
    if (!call.manager) continue
    const mid = call.manager.id
    if (!managerMap.has(mid)) {
      managerMap.set(mid, {
        id: mid,
        name: call.manager.name,
        scores: [],
        criticalMisses: 0,
      })
    }
    const entry = managerMap.get(mid)!
    if (call.score) {
      entry.scores.push(call.score.totalScore)
      for (const item of call.score.items) {
        if (!item.isDone && item.scriptItem.isCritical) {
          entry.criticalMisses++
        }
      }
    }
  }

  const managers: QcManagerRow[] = Array.from(managerMap.values()).map((m) => ({
    id: m.id,
    name: m.name,
    callCount: calls.filter((c) => c.managerId === m.id).length,
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
    where: { managerId },
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

export interface QcCallDetail {
  id: string
  managerName: string | null
  managerId: string | null
  clientName: string | null
  clientPhone: string | null
  direction: string
  category: string | null
  audioUrl: string | null
  transcript: string | null
  duration: number | null
  createdAt: Date
  totalScore: number | null
  tags: string[]
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
    db.manager.findMany({
      where: { tenantId },
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
  tenantId: string
): Promise<QcChartData> {
  const calls = await db.callRecord.findMany({
    where: { tenantId },
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

  // Per-manager scores
  const managerMap = new Map<
    string,
    { name: string; scores: number[]; callCount: number }
  >()
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
    },
  })

  if (!call) return null

  const scoreItems = call.score?.items ?? []
  scoreItems.sort((a, b) => a.scriptItem.order - b.scriptItem.order)

  return {
    id: call.id,
    managerName: call.manager?.name ?? null,
    managerId: call.manager?.id ?? null,
    clientName: call.clientName,
    clientPhone: call.clientPhone,
    direction: call.direction,
    category: call.category,
    audioUrl: call.audioUrl,
    transcript: call.transcript,
    duration: call.duration,
    createdAt: call.createdAt,
    totalScore: call.score?.totalScore ?? null,
    tags: call.tags.map((t) => t.tag),
    scoreItems: scoreItems.map((si) => ({
      id: si.id,
      isDone: si.isDone,
      aiComment: si.aiComment,
      scriptItem: si.scriptItem,
    })),
  }
}
