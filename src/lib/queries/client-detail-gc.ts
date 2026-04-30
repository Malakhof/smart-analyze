import { db } from "@/lib/db"

export interface ClientCallRow {
  id: string
  pbxUuid: string | null
  createdAt: Date
  startStamp: Date | null
  duration: number | null
  talkDuration: number | null
  userTalkTime: number | null
  managerName: string | null
  callType: string | null
  callOutcome: string | null
  outcome: string | null
  scriptScorePct: number | null
  dealId: string | null
  dealCrmId: string | null
  stageName: string | null
  currentStageCrmId: string | null
}

export interface ClientDetail {
  gcContactId: string
  managerId: string
  managerName: string | null
  clientName: string | null
  clientPhone: string | null
  callsCount: number
  realCallsCount: number
  avgScorePct: number | null
  totalTalkMinutes: number
  firstCallAt: Date | null
  lastCallAt: Date | null
  // GC links
  subdomain: string | null
  primaryDealCrmId: string | null
  // Recent stages — uniques in chronological order
  stageJourney: Array<{ stageName: string; at: Date }>
  calls: ClientCallRow[]
}

export async function getClientDetailGc(
  tenantId: string,
  managerId: string,
  gcContactId: string
): Promise<ClientDetail | null> {
  const calls = await db.callRecord.findMany({
    where: { tenantId, managerId, gcContactId },
    orderBy: { createdAt: "desc" },
    include: {
      manager: { select: { name: true } },
      deal: {
        select: {
          id: true,
          crmId: true,
          currentStageCrmId: true,
          funnel: { include: { stages: true } },
        },
      },
    },
  })

  if (calls.length === 0) return null

  const crmConfig = await db.crmConfig.findFirst({
    where: { tenantId, isActive: true },
    select: { subdomain: true },
  })

  // Aggregate
  const realCalls = calls.filter((c) => c.callOutcome === "real_conversation")
  const scoredCalls = realCalls.filter(
    (c) => c.scriptScorePct !== null && (c.duration ?? 0) >= 60
  )
  const avgScorePct =
    scoredCalls.length > 0
      ? scoredCalls.reduce((s, c) => s + (c.scriptScorePct ?? 0), 0) /
        scoredCalls.length
      : null
  const totalTalkSecs = realCalls.reduce(
    (s, c) => s + (c.talkDuration ?? c.userTalkTime ?? 0),
    0
  )

  // Pick a primary deal to show in 💼 link — the most recent call's deal.
  const primaryDealCrmId =
    calls.find((c) => c.deal?.crmId)?.deal?.crmId ?? null

  // Resolve stage names for each call
  const rows: ClientCallRow[] = calls.map((c) => {
    let stageName: string | null = null
    if (c.deal?.currentStageCrmId && c.deal.funnel?.stages) {
      const matched = c.deal.funnel.stages.find(
        (s) => s.crmId === c.deal!.currentStageCrmId
      )
      stageName = matched?.name ?? null
    }
    return {
      id: c.id,
      pbxUuid: c.pbxUuid,
      createdAt: c.createdAt,
      startStamp: c.startStamp,
      duration: c.duration,
      talkDuration: c.talkDuration,
      userTalkTime: c.userTalkTime,
      managerName: c.manager?.name ?? null,
      callType: c.callType,
      callOutcome: c.callOutcome,
      outcome: c.outcome,
      scriptScorePct: c.scriptScorePct,
      dealId: c.dealId,
      dealCrmId: c.deal?.crmId ?? null,
      stageName,
      currentStageCrmId: c.deal?.currentStageCrmId ?? null,
    }
  })

  // Stage journey — chronological list of unique stages (from oldest call → newest)
  const journey: Array<{ stageName: string; at: Date }> = []
  const reversed = [...rows].reverse()
  let lastStage: string | null = null
  for (const r of reversed) {
    const sn = r.stageName ?? (r.currentStageCrmId ? `Этап #${r.currentStageCrmId}` : null)
    if (!sn) continue
    if (sn !== lastStage) {
      journey.push({ stageName: sn, at: r.createdAt })
      lastStage = sn
    }
  }

  const first = calls[calls.length - 1]
  const last = calls[0]

  return {
    gcContactId,
    managerId,
    managerName: last.manager?.name ?? null,
    clientName: calls.find((c) => c.clientName && c.clientName.trim())?.clientName ?? null,
    clientPhone: calls.find((c) => c.clientPhone)?.clientPhone ?? null,
    callsCount: calls.length,
    realCallsCount: realCalls.length,
    avgScorePct,
    totalTalkMinutes: Math.round((totalTalkSecs / 60) * 10) / 10,
    firstCallAt: first?.createdAt ?? null,
    lastCallAt: last?.createdAt ?? null,
    subdomain: crmConfig?.subdomain ?? null,
    primaryDealCrmId,
    stageJourney: journey,
    calls: rows,
  }
}
