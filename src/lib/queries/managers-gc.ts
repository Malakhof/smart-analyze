import { db } from "@/lib/db"
import { Prisma } from "@/generated/prisma/client"
import {
  gcPeriodToCutoff,
  getCuratorManagerIds,
  type GcPeriod,
} from "@/lib/queries/dashboard-gc"

export interface ManagerListRow {
  managerId: string
  managerName: string
  dialed: number
  real: number
  scriptScorePctAvg: number | null
  phraseUsedAvg: number | null
  pipelineGap: number
  pipelineGapPct: number
  topCriticalError: string | null
}

const PHRASE_TECHNIQUES = [
  "программирование_звонка",
  "искренние_комплименты",
  "эмоциональный_подхват",
  "юмор_забота",
  "крюк_к_боли",
  "презентация_под_боль",
  "попытка_сделки_без_паузы",
  "выбор_без_выбора",
  "бонусы_с_дедлайном",
  "повторная_попытка_после_возражения",
  "маленькая_просьба",
  "следующий_шаг_с_временем",
] as const

export async function getManagersListGc(
  tenantId: string,
  period: GcPeriod
): Promise<ManagerListRow[]> {
  const since = gcPeriodToCutoff(period)
  const curatorIds = Array.from(await getCuratorManagerIds(tenantId))

  const rows = await db.$queryRaw<
    Array<{
      managerId: string
      managerName: string
      dialed: bigint
      real: bigint
      avg_score: number | null
      pipeline_gap: bigint
      total_for_gap: bigint
    }>
  >`
    SELECT
      m.id AS "managerId",
      m.name AS "managerName",
      COUNT(*) FILTER (WHERE c."callOutcome" IS NOT NULL)::bigint AS dialed,
      COUNT(*) FILTER (WHERE c."callOutcome" = 'real_conversation')::bigint AS real,
      AVG(c."scriptScorePct") FILTER (
        WHERE c."callOutcome" = 'real_conversation' AND c.duration >= 60
      )::float AS avg_score,
      COUNT(*) FILTER (WHERE c.transcript IS NULL AND c."audioUrl" IS NULL)::bigint AS pipeline_gap,
      COUNT(*)::bigint AS total_for_gap
    FROM "CallRecord" c
    JOIN "Manager" m ON c."managerId" = m.id
    WHERE c."tenantId" = ${tenantId}
      AND c."createdAt" >= ${since}
      ${
        curatorIds.length > 0
          ? Prisma.sql`AND m.id NOT IN (${Prisma.join(curatorIds)})`
          : Prisma.empty
      }
    GROUP BY m.id, m.name
    HAVING COUNT(*) > 0
    ORDER BY dialed DESC
  `

  // For each manager, compute phraseCompliance avg used:true count and top
  // critical error in parallel.
  const enriched: ManagerListRow[] = await Promise.all(
    rows.map(async (r) => {
      const [phraseAvg, topErr] = await Promise.all([
        getManagerPhraseUsedAvg(tenantId, r.managerId, since),
        getManagerTopCriticalError(tenantId, r.managerId, since),
      ])
      const totalForGap = Number(r.total_for_gap)
      const pipelineGap = Number(r.pipeline_gap)
      return {
        managerId: r.managerId,
        managerName: r.managerName,
        dialed: Number(r.dialed),
        real: Number(r.real),
        scriptScorePctAvg: r.avg_score,
        phraseUsedAvg: phraseAvg,
        pipelineGap,
        pipelineGapPct: totalForGap > 0 ? pipelineGap / totalForGap : 0,
        topCriticalError: topErr,
      }
    })
  )

  return enriched
}

async function getManagerPhraseUsedAvg(
  tenantId: string,
  managerId: string,
  since: Date
): Promise<number | null> {
  const calls = await db.callRecord.findMany({
    where: {
      tenantId,
      managerId,
      createdAt: { gte: since },
      callOutcome: "real_conversation",
      duration: { gte: 60 },
      phraseCompliance: { not: Prisma.JsonNull },
    },
    select: { phraseCompliance: true },
  })
  if (calls.length === 0) return null
  let totalUsed = 0
  for (const c of calls) {
    const pc = c.phraseCompliance as
      | Record<string, { used?: boolean }>
      | null
      | undefined
    if (!pc || typeof pc !== "object") continue
    const usedCount = PHRASE_TECHNIQUES.filter(
      (t) => pc[t]?.used === true
    ).length
    totalUsed += usedCount
  }
  return totalUsed / calls.length
}

async function getManagerTopCriticalError(
  tenantId: string,
  managerId: string,
  since: Date
): Promise<string | null> {
  const rows = await db.$queryRaw<Array<{ err: string; count: bigint }>>`
    WITH base AS (
      SELECT id, "criticalErrors"
      FROM "CallRecord"
      WHERE "tenantId" = ${tenantId}
        AND "managerId" = ${managerId}
        AND "createdAt" >= ${since}
        AND "callOutcome" = 'real_conversation'
        AND duration >= 60
        AND "criticalErrors" IS NOT NULL
        AND jsonb_array_length("criticalErrors") > 0
    ),
    flat AS (
      SELECT
        CASE
          WHEN jsonb_typeof(elem) = 'string' THEN elem #>> '{}'
          WHEN jsonb_typeof(elem) = 'object' THEN elem ->> 'error'
          ELSE NULL
        END AS err
      FROM base, jsonb_array_elements(base."criticalErrors") AS elem
    )
    SELECT err, COUNT(*)::bigint AS count
    FROM flat WHERE err IS NOT NULL
    GROUP BY err ORDER BY count DESC LIMIT 1
  `
  return rows[0]?.err ?? null
}

// ─── Manager detail ────────────────────────────────────────────────────────

export interface ManagerDetailCounters {
  dialed: number
  real: number
  ndz: number
  voicemail: number
  talkMinutes: number
  pipelineGap: number
  pipelineGapPct: number
}

export interface ManagerDetail {
  managerId: string
  managerName: string
  scriptScorePctAvg: number | null
  counters: ManagerDetailCounters
  callTypeDistribution: Array<{ key: string; count: number; pct: number }>
  managerStyleDistribution: Array<{ key: string; count: number; pct: number }>
  topCriticalErrors: Array<{ error: string; count: number; pct: number }>
  weakSpots: Array<{ spot: string; count: number }>
  phraseStats: {
    usedAvg: number | null
    deptAvg: number | null
    topMissing: Array<{ technique: string; missingPct: number }>
  }
  clients: Array<{
    gcContactId: string
    callsCount: number
    lastCallAt: Date
    avgScorePct: number | null
    clientName: string | null
    clientPhone: string | null
    dealId: string | null
  }>
}

export async function getManagerDetailGc(
  tenantId: string,
  managerId: string,
  period: GcPeriod
): Promise<ManagerDetail | null> {
  const since = gcPeriodToCutoff(period)
  const manager = await db.manager.findFirst({
    where: { id: managerId, tenantId },
    select: { id: true, name: true },
  })
  if (!manager) return null

  // Counters via single SQL
  const counterRows = await db.$queryRaw<
    Array<{
      dialed: bigint
      real: bigint
      ndz: bigint
      voicemail: bigint
      talk_seconds: number | null
      pipeline_gap: bigint
      total: bigint
      avg_score: number | null
    }>
  >`
    SELECT
      COUNT(*) FILTER (WHERE c."callOutcome" IS NOT NULL)::bigint AS dialed,
      COUNT(*) FILTER (WHERE c."callOutcome" = 'real_conversation')::bigint AS real,
      COUNT(*) FILTER (WHERE c."callOutcome" IN ('no_answer', 'hung_up'))::bigint AS ndz,
      COUNT(*) FILTER (WHERE c."callOutcome" IN ('voicemail', 'ivr'))::bigint AS voicemail,
      SUM(COALESCE(c."talkDuration", c."userTalkTime"))
        FILTER (WHERE c."callOutcome" = 'real_conversation')::float AS talk_seconds,
      COUNT(*) FILTER (WHERE c.transcript IS NULL AND c."audioUrl" IS NULL)::bigint AS pipeline_gap,
      COUNT(*)::bigint AS total,
      AVG(c."scriptScorePct") FILTER (
        WHERE c."callOutcome" = 'real_conversation' AND c.duration >= 60
      )::float AS avg_score
    FROM "CallRecord" c
    WHERE c."tenantId" = ${tenantId}
      AND c."managerId" = ${managerId}
      AND c."createdAt" >= ${since}
  `
  const cr = counterRows[0]
  const total = cr ? Number(cr.total) : 0
  const counters: ManagerDetailCounters = {
    dialed: cr ? Number(cr.dialed) : 0,
    real: cr ? Number(cr.real) : 0,
    ndz: cr ? Number(cr.ndz) : 0,
    voicemail: cr ? Number(cr.voicemail) : 0,
    talkMinutes: cr?.talk_seconds
      ? Math.round((cr.talk_seconds / 60) * 10) / 10
      : 0,
    pipelineGap: cr ? Number(cr.pipeline_gap) : 0,
    pipelineGapPct:
      total > 0 && cr ? Number(cr.pipeline_gap) / total : 0,
  }

  // Distributions
  const callTypeDist = await getDistribution(tenantId, managerId, since, "callType")
  const managerStyleDist = await getDistribution(
    tenantId,
    managerId,
    since,
    "managerStyle"
  )

  // Top critical errors
  const errorRows = await db.$queryRaw<
    Array<{ err: string; count: bigint; total: bigint }>
  >`
    WITH base AS (
      SELECT id, "criticalErrors"
      FROM "CallRecord"
      WHERE "tenantId" = ${tenantId}
        AND "managerId" = ${managerId}
        AND "createdAt" >= ${since}
        AND "callOutcome" = 'real_conversation'
        AND duration >= 60
        AND "criticalErrors" IS NOT NULL
        AND jsonb_array_length("criticalErrors") > 0
    ),
    total_calls AS (SELECT COUNT(*)::bigint AS total FROM base),
    flat AS (
      SELECT
        CASE
          WHEN jsonb_typeof(elem) = 'string' THEN elem #>> '{}'
          WHEN jsonb_typeof(elem) = 'object' THEN elem ->> 'error'
          ELSE NULL
        END AS err
      FROM base, jsonb_array_elements(base."criticalErrors") AS elem
    )
    SELECT err, COUNT(*)::bigint AS count, (SELECT total FROM total_calls) AS total
    FROM flat WHERE err IS NOT NULL
    GROUP BY err ORDER BY count DESC LIMIT 5
  `
  const topCriticalErrors = errorRows.map((r) => {
    const totalErr = Number(r.total)
    const count = Number(r.count)
    return {
      error: r.err.replace(/^"|"$/g, ""),
      count,
      pct: totalErr > 0 ? count / totalErr : 0,
    }
  })

  // Top weakSpots
  const weakSpotRows = await db.$queryRaw<
    Array<{ spot: string; count: bigint }>
  >`
    SELECT "managerWeakSpot" AS spot, COUNT(*)::bigint AS count
    FROM "CallRecord"
    WHERE "tenantId" = ${tenantId}
      AND "managerId" = ${managerId}
      AND "createdAt" >= ${since}
      AND "managerWeakSpot" IS NOT NULL
      AND "managerWeakSpot" != ''
    GROUP BY "managerWeakSpot" ORDER BY count DESC LIMIT 3
  `
  const weakSpots = weakSpotRows.map((r) => ({
    spot: r.spot,
    count: Number(r.count),
  }))

  // Phrase stats: manager avg + dept avg + top missing
  const [usedAvg, deptAvg] = await Promise.all([
    getManagerPhraseUsedAvg(tenantId, managerId, since),
    getDeptPhraseUsedAvgExcluding(tenantId, managerId, since),
  ])
  const topMissing = await getManagerTopMissingPhrases(
    tenantId,
    managerId,
    since,
    3
  )

  // Clients list
  const clientRows = await db.$queryRaw<
    Array<{
      gcContactId: string
      calls_count: bigint
      last_call: Date
      avg_score: number | null
      client_name: string | null
      client_phone: string | null
      deal_id: string | null
    }>
  >`
    SELECT
      c."gcContactId" AS "gcContactId",
      COUNT(*)::bigint AS calls_count,
      MAX(c."createdAt") AS last_call,
      AVG(c."scriptScorePct") FILTER (
        WHERE c."callOutcome" = 'real_conversation' AND c.duration >= 60
      )::float AS avg_score,
      MAX(c."clientName") AS client_name,
      MAX(c."clientPhone") AS client_phone,
      MAX(c."dealId") AS deal_id
    FROM "CallRecord" c
    WHERE c."tenantId" = ${tenantId}
      AND c."managerId" = ${managerId}
      AND c."createdAt" >= ${since}
      AND c."gcContactId" IS NOT NULL
    GROUP BY c."gcContactId"
    ORDER BY last_call DESC
    LIMIT 100
  `
  const clients = clientRows.map((r) => ({
    gcContactId: r.gcContactId,
    callsCount: Number(r.calls_count),
    lastCallAt: r.last_call,
    avgScorePct: r.avg_score,
    clientName: r.client_name,
    clientPhone: r.client_phone,
    dealId: r.deal_id,
  }))

  return {
    managerId: manager.id,
    managerName: manager.name,
    scriptScorePctAvg: cr?.avg_score ?? null,
    counters,
    callTypeDistribution: callTypeDist,
    managerStyleDistribution: managerStyleDist,
    topCriticalErrors,
    weakSpots,
    phraseStats: {
      usedAvg,
      deptAvg,
      topMissing,
    },
    clients,
  }
}

async function getDistribution(
  tenantId: string,
  managerId: string,
  since: Date,
  column: "callType" | "managerStyle"
): Promise<Array<{ key: string; count: number; pct: number }>> {
  const col = Prisma.raw(`"${column}"`)
  const rows = await db.$queryRaw<Array<{ key: string; count: bigint }>>`
    SELECT ${col} AS key, COUNT(*)::bigint AS count
    FROM "CallRecord"
    WHERE "tenantId" = ${tenantId}
      AND "managerId" = ${managerId}
      AND "createdAt" >= ${since}
      AND ${col} IS NOT NULL
    GROUP BY ${col} ORDER BY count DESC LIMIT 10
  `
  const total = rows.reduce((s, r) => s + Number(r.count), 0)
  return rows.map((r) => ({
    key: r.key,
    count: Number(r.count),
    pct: total > 0 ? Number(r.count) / total : 0,
  }))
}

async function getDeptPhraseUsedAvgExcluding(
  tenantId: string,
  excludeManagerId: string,
  since: Date
): Promise<number | null> {
  const calls = await db.callRecord.findMany({
    where: {
      tenantId,
      managerId: { not: excludeManagerId },
      createdAt: { gte: since },
      callOutcome: "real_conversation",
      duration: { gte: 60 },
      phraseCompliance: { not: Prisma.JsonNull },
    },
    select: { phraseCompliance: true },
  })
  if (calls.length === 0) return null
  let totalUsed = 0
  for (const c of calls) {
    const pc = c.phraseCompliance as
      | Record<string, { used?: boolean }>
      | null
      | undefined
    if (!pc || typeof pc !== "object") continue
    const used = PHRASE_TECHNIQUES.filter((t) => pc[t]?.used === true).length
    totalUsed += used
  }
  return totalUsed / calls.length
}

async function getManagerTopMissingPhrases(
  tenantId: string,
  managerId: string,
  since: Date,
  topN: number
): Promise<Array<{ technique: string; missingPct: number }>> {
  const calls = await db.callRecord.findMany({
    where: {
      tenantId,
      managerId,
      createdAt: { gte: since },
      callOutcome: "real_conversation",
      duration: { gte: 60 },
      phraseCompliance: { not: Prisma.JsonNull },
    },
    select: { phraseCompliance: true },
  })
  if (calls.length === 0) return []
  const counts: Record<string, number> = {}
  for (const t of PHRASE_TECHNIQUES) counts[t] = 0
  for (const c of calls) {
    const pc = c.phraseCompliance as
      | Record<string, { used?: boolean }>
      | null
      | undefined
    if (!pc || typeof pc !== "object") continue
    for (const t of PHRASE_TECHNIQUES) {
      if (pc[t]?.used === false) counts[t]++
    }
  }
  return Object.entries(counts)
    .map(([technique, c]) => ({
      technique,
      missingPct: calls.length > 0 ? c / calls.length : 0,
    }))
    .sort((a, b) => b.missingPct - a.missingPct)
    .slice(0, topN)
}
