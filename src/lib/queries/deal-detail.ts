import { db } from "@/lib/db"

export interface DealDetailMessage {
  id: string
  sender: "MANAGER" | "CLIENT" | "SYSTEM"
  content: string
  timestamp: Date
  isAudio: boolean
  audioUrl: string | null
  duration: number | null
}

export interface DealDetailStage {
  id: string
  stageId: string
  stageName: string
  stageOrder: number
  enteredAt: Date
  leftAt: Date | null
  duration: number | null
}

export interface DealDetailFunnelStage {
  id: string
  name: string
  order: number
  crmId: string | null
  totalDeals: number
  conversion: number
  isCurrent: boolean
  wasVisited: boolean
}

export interface DealDetailFunnel {
  id: string
  name: string
  stages: DealDetailFunnelStage[]
}

export interface DealDetailData {
  id: string
  title: string
  amount: number | null
  status: string
  duration: number | null
  createdAt: Date
  closedAt: Date | null
  currentStageCrmId: string | null
  manager: { id: string; name: string } | null
  analysis: {
    summary: string
    talkRatio: number | null
    avgResponseTime: number | null
  } | null
  messages: DealDetailMessage[]
  stageHistory: DealDetailStage[]
  funnel: DealDetailFunnel | null
}

export async function getDealDetail(
  dealId: string
): Promise<DealDetailData | null> {
  const deal = await db.deal.findUnique({
    where: { id: dealId },
    include: {
      manager: { select: { id: true, name: true } },
      analysis: {
        select: {
          summary: true,
          talkRatio: true,
          avgResponseTime: true,
        },
      },
      messages: {
        orderBy: { timestamp: "asc" },
        select: {
          id: true,
          sender: true,
          content: true,
          timestamp: true,
          isAudio: true,
          audioUrl: true,
          duration: true,
        },
      },
      callRecords: {
        where: { transcript: { not: null } },
        select: { audioUrl: true, transcript: true },
      },
      stageHistory: {
        orderBy: { enteredAt: "asc" },
        include: {
          stage: { select: { name: true, order: true } },
        },
      },
    },
  })

  if (!deal) return null

  let stageHistory: DealDetailStage[] = deal.stageHistory.map((sh) => ({
    id: sh.id,
    stageId: sh.stageId,
    stageName: sh.stage.name,
    stageOrder: sh.stage.order,
    enteredAt: sh.enteredAt,
    leftAt: sh.leftAt,
    duration: sh.duration,
  }))

  // Synthesize stage history when DealStageHistory was never written
  // (common for amoCRM/GC initial syncs without transition logs).
  // We can't reconstruct intermediate stages — but at least show:
  //   ENTRY (first stage of funnel, entered at deal.createdAt)
  //   → CURRENT (the deal.currentStageCrmId, entered estimated halfway, leftAt=deal.closedAt or null)
  // This gives the user a 2-point timeline + note that intermediates were lost.
  if (stageHistory.length === 0 && deal.funnelId) {
    const stages = await db.funnelStage.findMany({
      where: { funnelId: deal.funnelId },
      orderBy: { order: "asc" },
      select: { id: true, name: true, order: true, crmId: true },
    })
    if (stages.length > 0) {
      const entryStage = stages[0]
      const currentStage = deal.currentStageCrmId
        ? stages.find((s) => s.crmId === deal.currentStageCrmId)
        : null
      const closedAt = deal.closedAt ?? null
      const totalSpan =
        (closedAt ? closedAt.getTime() : Date.now()) -
        deal.createdAt.getTime()
      const days = totalSpan / (1000 * 60 * 60 * 24)

      const synthetic: DealDetailStage[] = []

      // ENTRY (always — the deal had to start somewhere)
      synthetic.push({
        id: `synthetic-entry-${entryStage.id}`,
        stageId: entryStage.id,
        stageName: entryStage.name,
        stageOrder: entryStage.order,
        enteredAt: deal.createdAt,
        // Halfway point as approximate "left" — only if there is a current stage transition we can show
        leftAt: currentStage && currentStage.id !== entryStage.id
          ? new Date(deal.createdAt.getTime() + totalSpan / 2)
          : closedAt,
        duration:
          currentStage && currentStage.id !== entryStage.id
            ? days / 2
            : days,
      })

      // CURRENT (only if different from entry)
      if (currentStage && currentStage.id !== entryStage.id) {
        synthetic.push({
          id: `synthetic-current-${currentStage.id}`,
          stageId: currentStage.id,
          stageName: currentStage.name,
          stageOrder: currentStage.order,
          enteredAt: new Date(deal.createdAt.getTime() + totalSpan / 2),
          leftAt: closedAt,
          duration: days / 2,
        })
      }

      stageHistory = synthetic
    }
  }

  // Build mini-funnel: all stages of this deal's funnel + per-stage progressive
  // conversion + flag of which stages this deal visited / is currently at.
  let funnel: DealDetailFunnel | null = null
  if (deal.funnelId) {
    const f = await db.funnel.findUnique({
      where: { id: deal.funnelId },
      include: {
        stages: { orderBy: { order: "asc" } },
        _count: { select: { deals: true } },
      },
    })
    if (f) {
      const totalFunnelDeals = f._count.deals
      const visitedCrmIds = new Set<string>()
      for (const sh of deal.stageHistory) {
        // Look up stage crmId from history's stage relation; we already loaded order
        // but not crmId, so derive from funnel stages list
        const fs = f.stages.find((s) => s.id === sh.stageId)
        if (fs?.crmId) visitedCrmIds.add(fs.crmId)
      }
      if (deal.currentStageCrmId) visitedCrmIds.add(deal.currentStageCrmId)

      const stagesData = await Promise.all(
        f.stages.map(async (stage) => {
          const futureStageCrmIds = f.stages
            .filter((s) => s.order >= stage.order)
            .map((s) => s.crmId)
            .filter((c): c is string => Boolean(c))

          const [historyDealIds, currentDeals] = await Promise.all([
            db.dealStageHistory.findMany({
              where: { stageId: stage.id },
              select: { dealId: true },
              distinct: ["dealId"],
            }),
            db.deal.findMany({
              where: {
                funnelId: f.id,
                currentStageCrmId: { in: futureStageCrmIds },
              },
              select: { id: true },
            }),
          ])
          const set = new Set<string>()
          for (const h of historyDealIds) set.add(h.dealId)
          for (const d of currentDeals) set.add(d.id)
          const stageDealCount = set.size
          return {
            id: stage.id,
            name: stage.name,
            order: stage.order,
            crmId: stage.crmId,
            totalDeals: stageDealCount,
            conversion:
              totalFunnelDeals > 0
                ? (stageDealCount / totalFunnelDeals) * 100
                : 0,
            isCurrent: stage.crmId === deal.currentStageCrmId,
            wasVisited: stage.crmId
              ? visitedCrmIds.has(stage.crmId)
              : false,
          }
        })
      )
      funnel = { id: f.id, name: f.name, stages: stagesData }
    }
  }

  return {
    id: deal.id,
    title: deal.title,
    amount: deal.amount,
    status: deal.status,
    duration: deal.duration,
    createdAt: deal.createdAt,
    closedAt: deal.closedAt,
    currentStageCrmId: deal.currentStageCrmId,
    manager: deal.manager,
    analysis: deal.analysis,
    messages: deal.messages.map((m) => {
      // Overlay CallRecord.transcript onto Message.content when they share audioUrl.
      // Whisper batch writes to CallRecord — this exposes those transcripts to the UI.
      const matchingCall =
        m.isAudio && m.audioUrl
          ? deal.callRecords.find((c) => c.audioUrl === m.audioUrl)
          : null
      const effectiveContent =
        matchingCall?.transcript || m.content || ""
      return {
        id: m.id,
        sender: m.sender as "MANAGER" | "CLIENT" | "SYSTEM",
        content: effectiveContent,
        timestamp: m.timestamp,
        isAudio: m.isAudio,
        audioUrl: m.audioUrl ?? null,
        duration: m.duration ?? null,
      }
    }),
    stageHistory,
    funnel,
  }
}
