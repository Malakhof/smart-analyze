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

  // Synthesize a single stage entry when DealStageHistory was never written
  // (common for amoCRM/GC initial syncs that don't pull transition logs).
  // Falls back to deal.currentStageCrmId → FunnelStage to give the user
  // at least the CURRENT stage instead of "no data".
  if (stageHistory.length === 0 && deal.funnelId && deal.currentStageCrmId) {
    const stage = await db.funnelStage.findFirst({
      where: { funnelId: deal.funnelId, crmId: deal.currentStageCrmId },
      select: { id: true, name: true, order: true },
    })
    if (stage) {
      stageHistory = [
        {
          id: `synthetic-${stage.id}`,
          stageId: stage.id,
          stageName: stage.name,
          stageOrder: stage.order,
          enteredAt: deal.createdAt,
          leftAt: deal.closedAt,
          duration: deal.duration,
        },
      ]
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
    messages: deal.messages.map((m) => ({
      id: m.id,
      sender: m.sender as "MANAGER" | "CLIENT" | "SYSTEM",
      content: m.content,
      timestamp: m.timestamp,
      isAudio: m.isAudio,
      audioUrl: m.audioUrl ?? null,
      duration: m.duration ?? null,
    })),
    stageHistory,
    funnel,
  }
}
