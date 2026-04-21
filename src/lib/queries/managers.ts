import { db } from "@/lib/db"
import { getActiveManagerIds } from "@/lib/queries/active-window"

export type ManagersQueryMode = "live" | "all"

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

export async function getManagersList(
  tenantId: string,
  mode: ManagersQueryMode = "all"
): Promise<{
  managers: ManagerListItem[]
  summary: ManagersSummary
}> {
  const allManagers = await db.manager.findMany({
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

  // In LIVE mode: keep only managers with calls/messages activity in window.
  // Summary counts always reflect the post-filter list shown to the user.
  const managers =
    mode === "live"
      ? await (async () => {
          const activeIds = await getActiveManagerIds(tenantId)
          return allManagers.filter((m) => activeIds.has(m.id))
        })()
      : allManagers

  const summary: ManagersSummary = {
    total: managers.length,
    excellent: managers.filter((m) => m.status === "EXCELLENT").length,
    watch: managers.filter((m) => m.status === "WATCH").length,
    critical: managers.filter((m) => m.status === "CRITICAL").length,
  }

  return { managers, summary }
}

