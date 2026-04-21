import { db } from "@/lib/db"

export const LIVE_WINDOW_DAYS = 7

export function liveWindowStart(days = LIVE_WINDOW_DAYS): Date {
  return new Date(Date.now() - days * 86_400_000)
}

/** Where-fragment for Deal: had Message OR CallRecord activity in window. */
export function dealActivityWhere(days = LIVE_WINDOW_DAYS) {
  const since = liveWindowStart(days)
  return {
    OR: [
      { messages: { some: { timestamp: { gte: since } } } },
      { callRecords: { some: { createdAt: { gte: since } } } },
    ],
  }
}

/** Set of manager IDs that had activity (calls or messages, own or via deal) in window. */
export async function getActiveManagerIds(
  tenantId: string,
  days = LIVE_WINDOW_DAYS
): Promise<Set<string>> {
  const since = liveWindowStart(days)
  const [fromCalls, fromMsgs, fromDealCalls, fromDealMsgs] = await Promise.all([
    db.callRecord.findMany({
      where: { tenantId, createdAt: { gte: since }, managerId: { not: null } },
      select: { managerId: true },
      distinct: ["managerId"],
    }),
    db.message.findMany({
      where: { tenantId, timestamp: { gte: since }, managerId: { not: null } },
      select: { managerId: true },
      distinct: ["managerId"],
    }),
    db.callRecord.findMany({
      where: { tenantId, createdAt: { gte: since }, deal: { managerId: { not: null } } },
      select: { deal: { select: { managerId: true } } },
    }),
    db.message.findMany({
      where: { tenantId, timestamp: { gte: since }, deal: { managerId: { not: null } } },
      select: { deal: { select: { managerId: true } } },
    }),
  ])
  const ids = new Set<string>()
  fromCalls.forEach((r) => r.managerId && ids.add(r.managerId))
  fromMsgs.forEach((r) => r.managerId && ids.add(r.managerId))
  fromDealCalls.forEach((r) => r.deal?.managerId && ids.add(r.deal.managerId))
  fromDealMsgs.forEach((r) => r.deal?.managerId && ids.add(r.deal.managerId))
  return ids
}
