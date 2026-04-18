/**
 * GetCourse v2 sync flow.
 *
 * Pulls deals + contacts (calls) from GetCourse using the new
 * src/lib/crm/getcourse/adapter.ts and upserts them into our DB with strict
 * tenantId isolation. Manager attribution is derived from contact rows.
 *
 * Idempotent: re-running the same date range will UPSERT by (tenantId, crmId)
 * rather than duplicating.
 *
 * NOT triggered by sync-engine.ts (which is amoCRM-only). Called explicitly
 * from scripts/smoke-getcourse-sync.ts and (later) from a cron route.
 */
import { db } from "@/lib/db"
import { decrypt } from "@/lib/crypto"
import { GetCourseAdapter } from "@/lib/crm/getcourse/adapter"
import { gcStatusToUnified } from "@/lib/crm/getcourse/parsers/deal-list"
import type { CrmConfig } from "@/generated/prisma/client"

export interface GcSyncOptions {
  daysBack: number          // e.g. 7 for first test, 90 for full
  dryRun?: boolean          // skip DB writes, only return what would happen
  maxPages?: number         // pagination cap (test mode = small, prod = high)
  perPage?: number
}

export interface GcSyncReport {
  tenantId: string
  range: { from: Date; to: Date }
  dryRun: boolean
  totals: {
    dealsFromGc: number
    contactsFromGc: number
    expectedDealsTotal: number | null
    expectedContactsTotal: number | null
  }
  written: {
    managers: { created: number; updated: number }
    deals: { created: number; updated: number }
    callRecords: { created: number; updated: number }
  }
  warnings: string[]
}

export async function syncGetCourseTenant(
  tenantId: string,
  options: GcSyncOptions
): Promise<GcSyncReport> {
  const cfg = await db.crmConfig.findFirstOrThrow({
    where: { tenantId, provider: "GETCOURSE" },
  })

  const accountUrl = resolveAccountUrl(cfg)
  const cookie = decryptCookie(cfg)
  const adapter = new GetCourseAdapter(accountUrl, cookie)

  const to = new Date()
  const from = new Date(Date.now() - options.daysBack * 24 * 60 * 60 * 1000)

  const report: GcSyncReport = {
    tenantId,
    range: { from, to },
    dryRun: !!options.dryRun,
    totals: {
      dealsFromGc: 0,
      contactsFromGc: 0,
      expectedDealsTotal: null,
      expectedContactsTotal: null,
    },
    written: {
      managers: { created: 0, updated: 0 },
      deals: { created: 0, updated: 0 },
      callRecords: { created: 0, updated: 0 },
    },
    warnings: [],
  }

  // Step 1: cheap probe — how much should be there?
  await adapter.testConnection()
  report.totals.expectedDealsTotal = await adapter.getTotalDealsInRange(from, to)
  report.totals.expectedContactsTotal = await adapter.getTotalContactsInRange(from, to)

  // Step 2: fetch (paginated)
  const deals = await adapter.getDealsByDateRange(from, to, {
    maxPages: options.maxPages ?? 5,
    perPage: options.perPage ?? 100,
  })
  report.totals.dealsFromGc = deals.length

  const contacts = await adapter.getContactsByDateRange(from, to, {
    maxPages: options.maxPages ?? 5,
    perPage: options.perPage ?? 100,
  })
  report.totals.contactsFromGc = contacts.length

  if (options.dryRun) return report

  // Step 3: write managers (upsert from unique manager IDs in contacts)
  const uniqueManagers = new Map<string, string>()
  for (const c of contacts) {
    if (c.managerCrmId && c.managerName && !uniqueManagers.has(c.managerCrmId)) {
      uniqueManagers.set(c.managerCrmId, c.managerName)
    }
  }

  const managerIdMap = new Map<string, string>() // GC id → our DB id
  for (const [crmId, name] of uniqueManagers) {
    const existing = await db.manager.findFirst({ where: { tenantId, crmId } })
    if (existing) {
      managerIdMap.set(crmId, existing.id)
      if (existing.name !== name) {
        await db.manager.update({ where: { id: existing.id }, data: { name } })
        report.written.managers.updated++
      }
    } else {
      const m = await db.manager.create({
        data: { tenantId, crmId, name },
      })
      managerIdMap.set(crmId, m.id)
      report.written.managers.created++
    }
  }

  // Step 4: write deals (upsert by tenantId + crmId)
  const dealIdMap = new Map<string, string>() // GC deal id → our DB id
  for (const d of deals) {
    const existing = await db.deal.findFirst({
      where: { tenantId, crmId: d.crmId },
    })
    const data = {
      tenantId,
      crmId: d.crmId,
      title: d.title || `Deal ${d.crmId}`,
      amount: d.amount ?? null,
      status: gcStatusToUnified(d.status).toUpperCase() as "OPEN" | "WON" | "LOST",
    }
    if (existing) {
      await db.deal.update({ where: { id: existing.id }, data })
      dealIdMap.set(d.crmId, existing.id)
      report.written.deals.updated++
    } else {
      const created = await db.deal.create({ data })
      dealIdMap.set(d.crmId, created.id)
      report.written.deals.created++
    }
  }

  // Step 5: write call records (upsert by tenantId + crmId)
  for (const c of contacts) {
    const existing = await db.callRecord.findFirst({
      where: { tenantId, crmId: c.crmId },
    })
    const data = {
      tenantId,
      crmId: c.crmId,
      direction: (c.direction === "income" ? "INCOMING" : "OUTGOING") as
        | "INCOMING"
        | "OUTGOING",
      type: "CALL" as const,
      audioUrl: c.audioUrl ?? null,
      duration: null,
      clientPhone: c.clientPhone ?? null,
      managerId: c.managerCrmId
        ? managerIdMap.get(c.managerCrmId) ?? null
        : null,
      dealId: c.linkedDealId ? dealIdMap.get(c.linkedDealId) ?? null : null,
      createdAt: c.callDate ?? new Date(),
    }
    if (existing) {
      await db.callRecord.update({ where: { id: existing.id }, data })
      report.written.callRecords.updated++
    } else {
      await db.callRecord.create({ data })
      report.written.callRecords.created++
    }
  }

  // Step 6: update CrmConfig.lastSyncAt
  await db.crmConfig.update({
    where: { id: cfg.id },
    data: { lastSyncAt: new Date() },
  })

  return report
}

function resolveAccountUrl(cfg: Pick<CrmConfig, "subdomain">): string {
  const sub = cfg.subdomain
  if (!sub) {
    throw new Error("CrmConfig.subdomain is required for GetCourse")
  }
  // If subdomain contains a dot, treat it as a full host (e.g. "web.diva.school").
  // Otherwise build the canonical *.getcourse.ru URL.
  if (sub.includes(".")) return `https://${sub}`
  return `https://${sub}.getcourse.ru`
}

function decryptCookie(cfg: Pick<CrmConfig, "gcCookie">): string {
  if (!cfg.gcCookie) {
    throw new Error("CrmConfig.gcCookie is missing — cookie not provisioned yet")
  }
  // Cookie may be stored as plain or encrypted. Try decrypt; on failure assume plain.
  try {
    return decrypt(cfg.gcCookie)
  } catch {
    return cfg.gcCookie
  }
}
