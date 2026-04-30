import { db } from "@/lib/db"
import { Prisma } from "@/generated/prisma/client"

export type GcPeriod = "today" | "week" | "month"

const MOSCOW_TZ = "Europe/Moscow"

const CURATOR_LASTNAMES = [
  "Лукашенко",
  "Чернышева",
  "Марьяна",
  "Чиркова",
  "Добренькова",
  "Романова",
  "Довгалева",
  "Николае",
]

export function gcPeriodToCutoff(period: GcPeriod): Date {
  const now = new Date()
  const days = period === "today" ? 1 : period === "week" ? 7 : 30
  const c = new Date(now)
  c.setDate(c.getDate() - days)
  return c
}

/**
 * Manager IDs that look like curators — either any of their enriched calls is
 * flagged isCurator=true, or their lastname matches the diva curator list.
 * Used to exclude curators from /managers and dashboard MOП metrics.
 */
export async function getCuratorManagerIds(tenantId: string): Promise<Set<string>> {
  const fromCalls = await db.callRecord.findMany({
    where: { tenantId, isCurator: true, managerId: { not: null } },
    select: { managerId: true },
    distinct: ["managerId"],
  })
  const ids = new Set<string>()
  fromCalls.forEach((r) => r.managerId && ids.add(r.managerId))

  const byName = await db.manager.findMany({
    where: {
      tenantId,
      OR: CURATOR_LASTNAMES.map((ln) => ({ name: { contains: ln } })),
    },
    select: { id: true },
  })
  byName.forEach((m) => ids.add(m.id))
  return ids
}

export interface DailyActivityRow {
  managerId: string
  managerName: string
  dialed: number
  real: number
  ndz: number
  voicemail: number
  talkMinutes: number
  pipelineGap: number
  scriptScorePctAvg: number | null
}

export async function getDailyActivityPerManager(
  tenantId: string,
  period: GcPeriod
): Promise<DailyActivityRow[]> {
  const since = gcPeriodToCutoff(period)
  const curatorIds = await getCuratorManagerIds(tenantId)
  const curatorList = Array.from(curatorIds)

  const rows = await db.$queryRaw<
    Array<{
      managerId: string
      managerName: string
      dialed: bigint
      real: bigint
      ndz: bigint
      voicemail: bigint
      talk_seconds: number | null
      pipeline_gap: bigint
      avg_score: number | null
    }>
  >`
    SELECT
      m.id AS "managerId",
      m.name AS "managerName",
      COUNT(*)::bigint AS dialed,
      COUNT(*) FILTER (WHERE c."callOutcome" = 'real_conversation')::bigint AS real,
      COUNT(*) FILTER (WHERE c."callOutcome" IN ('no_answer', 'hung_up'))::bigint AS ndz,
      COUNT(*) FILTER (WHERE c."callOutcome" IN ('voicemail', 'ivr'))::bigint AS voicemail,
      SUM(COALESCE(c."talkDuration", c."userTalkTime"))
        FILTER (WHERE c."callOutcome" = 'real_conversation')::float AS talk_seconds,
      COUNT(*) FILTER (WHERE c.transcript IS NULL AND c."audioUrl" IS NULL)::bigint AS pipeline_gap,
      AVG(c."scriptScorePct") FILTER (
        WHERE c."callOutcome" = 'real_conversation' AND c.duration >= 60
      )::float AS avg_score
    FROM "CallRecord" c
    JOIN "Manager" m ON c."managerId" = m.id
    WHERE c."tenantId" = ${tenantId}
      AND c."createdAt" >= ${since}
      ${
        curatorList.length > 0
          ? Prisma.sql`AND m.id NOT IN (${Prisma.join(curatorList)})`
          : Prisma.empty
      }
    GROUP BY m.id, m.name
    ORDER BY dialed DESC
  `

  return rows.map((r) => ({
    managerId: r.managerId,
    managerName: r.managerName,
    dialed: Number(r.dialed),
    real: Number(r.real),
    ndz: Number(r.ndz),
    voicemail: Number(r.voicemail),
    talkMinutes: r.talk_seconds ? Math.round((r.talk_seconds / 60) * 10) / 10 : 0,
    pipelineGap: Number(r.pipeline_gap),
    scriptScorePctAvg: r.avg_score,
  }))
}

export interface WorstCall {
  pbxUuid: string | null
  id: string
  managerName: string | null
  clientName: string | null
  createdAt: Date
  userTalkTime: number | null
  talkDuration: number | null
  scriptScorePct: number | null
  managerWeakSpot: string | null
  callType: string | null
  criticalErrors: unknown
}

export async function getWorstCallsToday(
  tenantId: string,
  period: GcPeriod,
  limit = 10
): Promise<WorstCall[]> {
  const since = gcPeriodToCutoff(period)
  const calls = await db.callRecord.findMany({
    where: {
      tenantId,
      createdAt: { gte: since },
      callOutcome: "real_conversation",
      transcript: { not: null },
      duration: { gte: 60 },
      scriptScorePct: { not: null },
    },
    orderBy: { scriptScorePct: "asc" },
    take: limit,
    select: {
      id: true,
      pbxUuid: true,
      clientName: true,
      createdAt: true,
      userTalkTime: true,
      talkDuration: true,
      scriptScorePct: true,
      managerWeakSpot: true,
      callType: true,
      criticalErrors: true,
      manager: { select: { name: true } },
    },
  })
  return calls.map((c) => ({
    id: c.id,
    pbxUuid: c.pbxUuid,
    managerName: c.manager?.name ?? null,
    clientName: c.clientName,
    createdAt: c.createdAt,
    userTalkTime: c.userTalkTime,
    talkDuration: c.talkDuration,
    scriptScorePct: c.scriptScorePct,
    managerWeakSpot: c.managerWeakSpot,
    callType: c.callType,
    criticalErrors: c.criticalErrors,
  }))
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

export interface MissingPhrase {
  technique: string
  missingCount: number
  totalCount: number
  pct: number
}

export async function getTopMissingPhrases(
  tenantId: string,
  period: GcPeriod,
  topN = 3
): Promise<MissingPhrase[]> {
  const since = gcPeriodToCutoff(period)
  const results: MissingPhrase[] = []
  for (const tech of PHRASE_TECHNIQUES) {
    const row = await db.$queryRaw<Array<{ missing: bigint; total: bigint }>>`
      SELECT
        COUNT(*) FILTER (WHERE "phraseCompliance"->${tech}->>'used' = 'false')::bigint AS missing,
        COUNT(*) FILTER (WHERE "phraseCompliance" IS NOT NULL)::bigint AS total
      FROM "CallRecord"
      WHERE "tenantId" = ${tenantId}
        AND "createdAt" >= ${since}
        AND "callOutcome" = 'real_conversation'
        AND duration >= 60
    `
    const missing = Number(row[0]?.missing ?? 0)
    const total = Number(row[0]?.total ?? 0)
    if (total > 0) {
      results.push({
        technique: tech,
        missingCount: missing,
        totalCount: total,
        pct: missing / total,
      })
    }
  }
  return results.sort((a, b) => b.pct - a.pct).slice(0, topN)
}

export interface DepartmentPattern {
  weakSpot: string
  occurrences: number
  managers: number
}

export async function getDepartmentTopWeakSpots(
  tenantId: string,
  period: GcPeriod,
  topN = 5
): Promise<DepartmentPattern[]> {
  const since = gcPeriodToCutoff(period)
  const rows = await db.$queryRaw<
    Array<{ spot: string; occurrences: bigint; managers: bigint }>
  >`
    SELECT
      "managerWeakSpot" AS spot,
      COUNT(*)::bigint AS occurrences,
      COUNT(DISTINCT "managerId")::bigint AS managers
    FROM "CallRecord"
    WHERE "tenantId" = ${tenantId}
      AND "managerWeakSpot" IS NOT NULL
      AND "managerWeakSpot" != ''
      AND "createdAt" >= ${since}
    GROUP BY "managerWeakSpot"
    ORDER BY occurrences DESC
    LIMIT ${topN}
  `
  return rows.map((r) => ({
    weakSpot: r.spot,
    occurrences: Number(r.occurrences),
    managers: Number(r.managers),
  }))
}

export interface CriticalErrorAgg {
  error: string
  count: number
  pct: number
}

export async function getDepartmentTopCriticalErrors(
  tenantId: string,
  period: GcPeriod,
  topN = 5
): Promise<CriticalErrorAgg[]> {
  const since = gcPeriodToCutoff(period)
  // criticalErrors is jsonb array — items can be either strings or objects
  // {error, evidence, severity}. Normalize via CASE so we extract `.error` from
  // objects and the value itself from string elements.
  const rows = await db.$queryRaw<
    Array<{ err: string; count: bigint; total: bigint }>
  >`
    WITH base AS (
      SELECT id, "criticalErrors"
      FROM "CallRecord"
      WHERE "tenantId" = ${tenantId}
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
    SELECT
      err,
      COUNT(*)::bigint AS count,
      (SELECT total FROM total_calls) AS total
    FROM flat
    WHERE err IS NOT NULL
    GROUP BY err
    ORDER BY count DESC
    LIMIT ${topN}
  `
  return rows.map((r) => {
    const total = Number(r.total)
    const count = Number(r.count)
    return {
      error: r.err.replace(/^"|"$/g, ""),
      count,
      pct: total > 0 ? count / total : 0,
    }
  })
}

export interface UnfulfilledCommitment {
  callId: string
  pbxUuid: string | null
  managerName: string | null
  clientName: string | null
  createdAt: Date
  hoursAgo: number
  commitments: Array<{
    speaker?: string
    quote?: string
    timestamp?: string
    action?: string
    deadline?: string
    target?: string
  }>
}

export async function getUnfulfilledCommitments(
  tenantId: string,
  limit = 10
): Promise<UnfulfilledCommitment[]> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const rows = await db.callRecord.findMany({
    where: {
      tenantId,
      commitmentsTracked: false,
      commitmentsCount: { gt: 0 },
      createdAt: { lt: cutoff },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      pbxUuid: true,
      clientName: true,
      createdAt: true,
      extractedCommitments: true,
      manager: { select: { name: true } },
    },
  })
  const now = Date.now()
  return rows
    .map((r) => {
      const arr = Array.isArray(r.extractedCommitments)
        ? (r.extractedCommitments as Array<Record<string, unknown>>)
        : []
      const commitments = arr.slice(0, 3).map((c) => ({
        speaker: typeof c.speaker === "string" ? c.speaker : undefined,
        quote: typeof c.quote === "string" ? c.quote : undefined,
        timestamp: typeof c.timestamp === "string" ? c.timestamp : undefined,
        action: typeof c.action === "string" ? c.action : undefined,
        deadline: typeof c.deadline === "string" ? c.deadline : undefined,
        target: typeof c.target === "string" ? c.target : undefined,
      }))
      return {
        callId: r.id,
        pbxUuid: r.pbxUuid,
        managerName: r.manager?.name ?? null,
        clientName: r.clientName,
        createdAt: r.createdAt,
        hoursAgo: Math.floor((now - r.createdAt.getTime()) / (60 * 60 * 1000)),
        commitments,
      }
    })
    .filter((r) => r.commitments.length > 0)
}

export interface HeatmapCell {
  dow: number // 0..6, Sunday=0
  hour: number // 0..23
  total: number
  successRate: number // 0..1
}

export async function getCallHeatmap(
  tenantId: string,
  managerId?: string
): Promise<HeatmapCell[]> {
  const rows = await db.$queryRaw<
    Array<{ dow: number; hour: number; total: bigint; success: bigint }>
  >`
    SELECT
      EXTRACT(DOW FROM "startStamp" AT TIME ZONE ${MOSCOW_TZ})::int AS dow,
      EXTRACT(HOUR FROM "startStamp" AT TIME ZONE ${MOSCOW_TZ})::int AS hour,
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE "callOutcome" = 'real_conversation')::bigint AS success
    FROM "CallRecord"
    WHERE "tenantId" = ${tenantId}
      AND "startStamp" IS NOT NULL
      AND "startStamp" >= NOW() - INTERVAL '30 days'
      ${managerId ? Prisma.sql`AND "managerId" = ${managerId}` : Prisma.empty}
    GROUP BY dow, hour
  `
  return rows.map((r) => {
    const total = Number(r.total)
    const success = Number(r.success)
    return {
      dow: r.dow,
      hour: r.hour,
      total,
      successRate: total > 0 ? success / total : 0,
    }
  })
}

export interface FunnelStageCount {
  stageName: string
  stageCrmId: string | null
  count: number
}

export async function getOpenDealsByStage(
  tenantId: string
): Promise<FunnelStageCount[]> {
  const rows = await db.$queryRaw<
    Array<{ stageName: string | null; stageCrmId: string | null; count: bigint }>
  >`
    SELECT
      fs.name AS "stageName",
      fs."crmId" AS "stageCrmId",
      COUNT(*)::bigint AS count
    FROM "Deal" d
    LEFT JOIN "Funnel" f ON d."funnelId" = f.id
    LEFT JOIN "FunnelStage" fs
      ON fs."funnelId" = f.id AND fs."crmId" = d."currentStageCrmId"
    WHERE d."tenantId" = ${tenantId}
      AND d.status = 'OPEN'
    GROUP BY fs.name, fs."crmId"
    ORDER BY count DESC
    LIMIT 20
  `
  return rows
    .filter((r) => r.stageName)
    .map((r) => ({
      stageName: r.stageName as string,
      stageCrmId: r.stageCrmId,
      count: Number(r.count),
    }))
}

export async function getLastSyncTimestamp(
  tenantId: string
): Promise<Date | null> {
  const last = await db.callRecord.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  })
  return last?.createdAt ?? null
}

export async function getPipelineGapPct(
  tenantId: string,
  period: GcPeriod
): Promise<{
  total: number
  gap: number
  pct: number
  pendingEnrich: number
  pendingPct: number
}> {
  const since = gcPeriodToCutoff(period)
  const [total, gap, pendingEnrich] = await Promise.all([
    db.callRecord.count({ where: { tenantId, createdAt: { gte: since } } }),
    db.callRecord.count({
      where: {
        tenantId,
        createdAt: { gte: since },
        transcript: null,
        audioUrl: null,
      },
    }),
    db.callRecord.count({
      where: {
        tenantId,
        createdAt: { gte: since },
        callOutcome: null,
        // Pending = synced but not yet enriched. Excludes pipeline_gap (no audio).
        OR: [{ transcript: { not: null } }, { audioUrl: { not: null } }],
      },
    }),
  ])
  return {
    total,
    gap,
    pct: total > 0 ? gap / total : 0,
    pendingEnrich,
    pendingPct: total > 0 ? pendingEnrich / total : 0,
  }
}
