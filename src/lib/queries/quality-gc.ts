import { db } from "@/lib/db"
import { Prisma } from "@/generated/prisma/client"
import {
  gcPeriodToCutoff,
  getCuratorManagerIds,
  type GcPeriod,
} from "@/lib/queries/dashboard-gc"

export interface QualityFilterOptions {
  callTypes: string[]
  callOutcomes: string[]
  managers: Array<{ id: string; name: string }>
}

export async function getQualityFilterOptionsGc(
  tenantId: string
): Promise<QualityFilterOptions> {
  const curatorIds = Array.from(await getCuratorManagerIds(tenantId))

  const [callTypes, callOutcomes, managers] = await Promise.all([
    db.callRecord.findMany({
      where: { tenantId, callType: { not: null } },
      select: { callType: true },
      distinct: ["callType"],
    }),
    db.callRecord.findMany({
      where: { tenantId, callOutcome: { not: null } },
      select: { callOutcome: true },
      distinct: ["callOutcome"],
    }),
    db.manager.findMany({
      where: {
        tenantId,
        ...(curatorIds.length > 0 ? { id: { notIn: curatorIds } } : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ])

  return {
    callTypes: callTypes.map((r) => r.callType!).filter(Boolean).sort(),
    callOutcomes: callOutcomes
      .map((r) => r.callOutcome!)
      .filter(Boolean)
      .sort(),
    managers,
  }
}

export interface QualityFilters {
  period: GcPeriod
  callType?: string
  callOutcome?: string
  managerId?: string
  hadRealConversation?: boolean
  sortBy?: "score" | "date" | "duration"
  sortDir?: "asc" | "desc"
  page?: number
}

export interface QualityCallRow {
  id: string
  pbxUuid: string | null
  createdAt: Date
  duration: number | null
  talkDuration: number | null
  userTalkTime: number | null
  managerName: string | null
  clientName: string | null
  clientPhone: string | null
  callType: string | null
  callOutcome: string | null
  outcome: string | null
  hadRealConversation: boolean | null
  scriptScorePct: number | null
  criticalErrors: unknown
}

export interface QualityListResult {
  rows: QualityCallRow[]
  total: number
  page: number
  pageSize: number
  pages: number
}

const PAGE_SIZE = 50

export async function getQualityCallsListGc(
  tenantId: string,
  filters: QualityFilters
): Promise<QualityListResult> {
  const since = gcPeriodToCutoff(filters.period)
  const curatorIds = Array.from(await getCuratorManagerIds(tenantId))

  const where: Prisma.CallRecordWhereInput = {
    tenantId,
    createdAt: { gte: since },
    ...(curatorIds.length > 0 ? { managerId: { notIn: curatorIds } } : {}),
    ...(filters.callType ? { callType: filters.callType } : {}),
    ...(filters.callOutcome ? { callOutcome: filters.callOutcome } : {}),
    ...(filters.managerId ? { managerId: filters.managerId } : {}),
    ...(filters.hadRealConversation !== undefined
      ? { hadRealConversation: filters.hadRealConversation }
      : {}),
  }

  const sortBy = filters.sortBy ?? "date"
  const sortDir = filters.sortDir ?? "desc"
  const orderBy: Prisma.CallRecordOrderByWithRelationInput =
    sortBy === "score"
      ? { scriptScorePct: sortDir }
      : sortBy === "duration"
        ? { duration: sortDir }
        : { createdAt: sortDir }

  const page = Math.max(1, filters.page ?? 1)

  const [total, calls] = await Promise.all([
    db.callRecord.count({ where }),
    db.callRecord.findMany({
      where,
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        pbxUuid: true,
        createdAt: true,
        duration: true,
        talkDuration: true,
        userTalkTime: true,
        clientName: true,
        clientPhone: true,
        callType: true,
        callOutcome: true,
        outcome: true,
        hadRealConversation: true,
        scriptScorePct: true,
        criticalErrors: true,
        manager: { select: { name: true } },
      },
    }),
  ])

  const rows: QualityCallRow[] = calls.map((c) => ({
    id: c.id,
    pbxUuid: c.pbxUuid,
    createdAt: c.createdAt,
    duration: c.duration,
    talkDuration: c.talkDuration,
    userTalkTime: c.userTalkTime,
    managerName: c.manager?.name ?? null,
    clientName: c.clientName,
    clientPhone: c.clientPhone,
    callType: c.callType,
    callOutcome: c.callOutcome,
    outcome: c.outcome,
    hadRealConversation: c.hadRealConversation,
    scriptScorePct: c.scriptScorePct,
    criticalErrors: c.criticalErrors,
  }))

  return {
    rows,
    total,
    page,
    pageSize: PAGE_SIZE,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  }
}
