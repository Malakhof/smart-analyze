import { db } from "@/lib/db"

export const LIVE_WINDOW_DAYS = 7

const TENANTS_WITH_LIVE_MODE = new Set(["diva-school"])

/** Per-tenant: only diva uses LIVE 7d; reklama/vastu stay on legacy "all". */
export async function getTenantMode(tenantId: string): Promise<"live" | "all"> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true },
  })
  return tenant && TENANTS_WITH_LIVE_MODE.has(tenant.name) ? "live" : "all"
}

/**
 * Returns the active CRM provider for the tenant. Tenants with provider=GETCOURSE
 * see the new RОП dashboard UI (canon #37); others (AMOCRM/BITRIX24) keep the legacy UI.
 */
export async function getCrmProvider(
  tenantId: string
): Promise<"GETCOURSE" | "AMOCRM" | "BITRIX24" | null> {
  const cfg = await db.crmConfig.findFirst({
    where: { tenantId, isActive: true },
    select: { provider: true },
  })
  return cfg?.provider ?? null
}

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
