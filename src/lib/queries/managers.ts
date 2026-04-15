import { db } from "@/lib/db"

export interface ManagerListItem {
  id: string
  name: string
  totalDeals: number | null
  successDeals: number | null
  conversionRate: number | null
  avgDealValue: number | null
  avgDealTime: number | null
  talkRatio: number | null
  status: string | null
}

export interface ManagersSummary {
  total: number
  excellent: number
  watch: number
  critical: number
}

export async function getManagersList(tenantId: string): Promise<{
  managers: ManagerListItem[]
  summary: ManagersSummary
}> {
  const managers = await db.manager.findMany({
    where: { tenantId },
    orderBy: { conversionRate: "desc" },
    select: {
      id: true,
      name: true,
      totalDeals: true,
      successDeals: true,
      conversionRate: true,
      avgDealValue: true,
      avgDealTime: true,
      talkRatio: true,
      status: true,
    },
  })

  const summary: ManagersSummary = {
    total: managers.length,
    excellent: managers.filter((m) => m.status === "EXCELLENT").length,
    watch: managers.filter((m) => m.status === "WATCH").length,
    critical: managers.filter((m) => m.status === "CRITICAL").length,
  }

  return { managers, summary }
}

