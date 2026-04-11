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

export interface DealDetailData {
  id: string
  title: string
  amount: number | null
  status: string
  duration: number | null
  createdAt: Date
  manager: { id: string; name: string } | null
  analysis: {
    summary: string
    talkRatio: number | null
    avgResponseTime: number | null
  } | null
  messages: DealDetailMessage[]
  stageHistory: DealDetailStage[]
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

  return {
    id: deal.id,
    title: deal.title,
    amount: deal.amount,
    status: deal.status,
    duration: deal.duration,
    createdAt: deal.createdAt,
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
    stageHistory: deal.stageHistory.map((sh) => ({
      id: sh.id,
      stageId: sh.stageId,
      stageName: sh.stage.name,
      stageOrder: sh.stage.order,
      enteredAt: sh.enteredAt,
      leftAt: sh.leftAt,
      duration: sh.duration,
    })),
  }
}
