/**
 * GetCourse v2 sync flow.
 *
 * Streaming pull: each page from GetCourse is written to our DB immediately,
 * then released from memory. Allows full 22K+ deal sync without OOM and gives
 * resumability — if the run is killed at page N, restarting at startPage=N+1
 * just continues.
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
import {
  gcStatusToUnified,
  type ParsedDeal,
} from "@/lib/crm/getcourse/parsers/deal-list"
import type { ParsedContact } from "@/lib/crm/getcourse/parsers/contact-list"
import type { ParsedResponse } from "@/lib/crm/getcourse/parsers/responses"
import type {
  ParsedFunnel,
  ParsedStage,
} from "@/lib/crm/getcourse/parsers/funnels"
import type { CrmConfig } from "@/generated/prisma/client"

export interface GcSyncOptions {
  daysBack: number          // e.g. 7 for first test, 90 for full
  dryRun?: boolean          // skip DB writes, only return what would happen
  maxDealPages?: number     // pagination cap for deals (default 1000)
  maxContactPages?: number  // pagination cap for contacts (default 500)
  maxResponsePages?: number // pagination cap for responses (default 50, ~1000 threads)
  startDealPage?: number    // resume from this page (default 1)
  startContactPage?: number // resume from this page (default 1)
  startResponsePage?: number // resume from this page (default 1)
  syncResponses?: boolean   // enable responses sync (default true)
  syncClosedResponses?: boolean // include closed (default false — open only)
  syncFunnels?: boolean     // sync funnels + stages (default true) — Wave 1 #15
  syncDealStat?: boolean    // capture dealstat snapshot (default true) — Wave 1 #16
  rateLimitMs?: number      // sleep between page fetches (default 1000)
  onPageProgress?: (kind: "deal" | "contact" | "response" | "thread" | "funnel" | "stat", page: number, written: number) => void
}

export interface GcSyncReport {
  tenantId: string
  range: { from: Date; to: Date }
  dryRun: boolean
  totals: {
    dealsFromGc: number
    contactsFromGc: number
    responsesFromGc: number
    threadMessagesFromGc: number
    expectedDealsTotal: number | null
    expectedContactsTotal: number | null
    expectedResponsesOpen: number | null
  }
  written: {
    managers: { created: number; updated: number }
    deals: { created: number; updated: number }
    callRecords: { created: number; updated: number }
    messages: { created: number; updated: number }
    funnels: { created: number; updated: number }
    stages: { created: number; updated: number }
    dealStatSnapshots: number
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
      responsesFromGc: 0,
      threadMessagesFromGc: 0,
      expectedDealsTotal: null,
      expectedContactsTotal: null,
      expectedResponsesOpen: null,
    },
    written: {
      managers: { created: 0, updated: 0 },
      deals: { created: 0, updated: 0 },
      callRecords: { created: 0, updated: 0 },
      messages: { created: 0, updated: 0 },
      funnels: { created: 0, updated: 0 },
      stages: { created: 0, updated: 0 },
      dealStatSnapshots: 0,
    },
    warnings: [],
  }

  // 1) Probe — cheap totals
  await adapter.testConnection()
  report.totals.expectedDealsTotal = await adapter.getTotalDealsInRange(from, to)
  report.totals.expectedContactsTotal = await adapter.getTotalContactsInRange(from, to)

  // 1b) Sync funnels + stages (Wave 1 #15) — must run BEFORE deals so we
  // can later map Deal.funnelId / currentStageCrmId. Cheap: 1 + N requests
  // where N = number of funnels (4 for diva).
  if (options.syncFunnels !== false) {
    try {
      const funnels = await adapter.getFunnels()
      for (const funnel of funnels) {
        const dbFunnelId = await upsertFunnel(tenantId, funnel)
        if (dbFunnelId.created) report.written.funnels.created++
        else report.written.funnels.updated++

        const stages = await adapter.getFunnelStages(funnel.id)
        for (const stage of stages) {
          const w = await upsertStage(dbFunnelId.id, stage)
          if (w.created) report.written.stages.created++
          else report.written.stages.updated++
        }
        options.onPageProgress?.(
          "funnel",
          -1,
          report.written.stages.created + report.written.stages.updated
        )
      }
    } catch (e) {
      report.warnings.push(`funnels/stages sync failed: ${String(e)}`)
    }
  }

  if (options.dryRun) {
    // For dryRun, fetch one sample page only to get a sense of structure.
    const sampleDeals = await adapter.getDealsByDateRange(from, to, { maxPages: 1 })
    const sampleContacts = await adapter.getContactsByDateRange(from, to, { maxPages: 1 })
    report.totals.dealsFromGc = sampleDeals.length
    report.totals.contactsFromGc = sampleContacts.length
    return report
  }

  // 2) Stream deals → write per page
  const dealIdMap = new Map<string, string>() // crmId → DB id
  await adapter.streamDealsByDateRange(
    from,
    to,
    async (rows) => {
      const pageWritten = await writeDealsPage(tenantId, rows, dealIdMap)
      report.written.deals.created += pageWritten.created
      report.written.deals.updated += pageWritten.updated
      report.totals.dealsFromGc += rows.length
      options.onPageProgress?.("deal", -1, report.written.deals.created + report.written.deals.updated)
    },
    {
      maxPages: options.maxDealPages ?? 1000,
      startPage: options.startDealPage ?? 1,
      rateLimitMs: options.rateLimitMs ?? 1000,
    }
  )

  // 3) Stream contacts → write per page (with manager + deal linking)
  const managerIdMap = new Map<string, string>()
  await adapter.streamContactsByDateRange(
    from,
    to,
    async (rows) => {
      const pageWritten = await writeContactsPage(tenantId, rows, managerIdMap, dealIdMap)
      report.written.callRecords.created += pageWritten.callsCreated
      report.written.callRecords.updated += pageWritten.callsUpdated
      report.written.managers.created += pageWritten.managersCreated
      report.written.managers.updated += pageWritten.managersUpdated
      report.totals.contactsFromGc += rows.length
      options.onPageProgress?.(
        "contact",
        -1,
        report.written.callRecords.created + report.written.callRecords.updated
      )
    },
    {
      maxPages: options.maxContactPages ?? 500,
      startPage: options.startContactPage ?? 1,
      rateLimitMs: options.rateLimitMs ?? 1000,
    }
  )

  // 4) Stream responses (обращения) → write each thread to Message table
  if (options.syncResponses !== false) {
    const statuses: Array<"open" | "closed"> =
      options.syncClosedResponses ? ["open", "closed"] : ["open"]
    for (const status of statuses) {
      await adapter.streamResponses(
        status,
        async (responses) => {
          for (const resp of responses) {
            const written = await writeResponseThread(
              tenantId,
              resp,
              adapter,
              managerIdMap
            )
            report.written.messages.created += written.messagesCreated
            report.written.messages.updated += written.messagesUpdated
            report.written.managers.created += written.managersCreated
            report.totals.threadMessagesFromGc += written.fetchedCount
          }
          report.totals.responsesFromGc += responses.length
          options.onPageProgress?.(
            "response",
            -1,
            report.written.messages.created + report.written.messages.updated
          )
        },
        {
          maxPages: options.maxResponsePages ?? 50,
          startPage: options.startResponsePage ?? 1,
          rateLimitMs: options.rateLimitMs ?? 1000,
        }
      )
    }
  }

  // 5) Capture dealstat snapshot (Wave 1 #16) — pre-aggregated totals + chart
  if (options.syncDealStat !== false) {
    try {
      const stat = await adapter.getDealStat()
      await db.dealStatSnapshot.create({
        data: {
          tenantId,
          source: "getcourse:dealstat",
          scopeJson: { ruleString: "", locationId: 0, allTime: true },
          ordersCreatedCount: stat.totals.ordersCreatedCount,
          ordersCreatedAmount: stat.totals.ordersCreatedAmount,
          ordersPaidCount: stat.totals.ordersPaidCount,
          ordersPaidAmount: stat.totals.ordersPaidAmount,
          buyersCount: stat.totals.buyersCount,
          prepaymentsCount: stat.totals.prepaymentsCount,
          prepaymentsAmount: stat.totals.prepaymentsAmount,
          taxAmount: stat.totals.taxAmount,
          commissionAmount: stat.totals.commissionAmount,
          earnedAmount: stat.totals.earnedAmount,
          seriesJson: JSON.parse(JSON.stringify(stat.series)),
          rawJson: JSON.parse(JSON.stringify(stat.rawJson)),
        },
      })
      report.written.dealStatSnapshots = 1
      options.onPageProgress?.("stat", -1, 1)
    } catch (e) {
      report.warnings.push(`dealstat snapshot failed: ${String(e)}`)
    }
  }

  // 6) Mark sync complete
  await db.crmConfig.update({
    where: { id: cfg.id },
    data: { lastSyncAt: new Date() },
  })

  return report
}

/**
 * UPSERT funnel by (tenantId, crmId). Returns DB id + whether it was newly created.
 */
async function upsertFunnel(
  tenantId: string,
  f: ParsedFunnel
): Promise<{ id: string; created: boolean }> {
  const existing = await db.funnel.findFirst({
    where: { tenantId, crmId: f.id },
  })
  if (existing) {
    if (existing.name !== f.name) {
      await db.funnel.update({ where: { id: existing.id }, data: { name: f.name } })
    }
    return { id: existing.id, created: false }
  }
  const created = await db.funnel.create({
    data: { tenantId, crmId: f.id, name: f.name },
  })
  return { id: created.id, created: true }
}

/**
 * UPSERT funnel stage by (funnelId, crmId). Maps GC `system` field to terminalKind.
 */
async function upsertStage(
  dbFunnelId: string,
  s: ParsedStage
): Promise<{ created: boolean }> {
  const terminalKind = s.system === 2 ? "WON" : s.system === 1 ? "LOST" : null
  const existing = await db.funnelStage.findFirst({
    where: { funnelId: dbFunnelId, crmId: s.id },
  })
  const data = {
    name: s.name,
    order: s.position,
    terminalKind,
  }
  if (existing) {
    if (
      existing.name !== s.name ||
      existing.order !== s.position ||
      existing.terminalKind !== terminalKind
    ) {
      await db.funnelStage.update({ where: { id: existing.id }, data })
    }
    return { created: false }
  }
  await db.funnelStage.create({
    data: { funnelId: dbFunnelId, crmId: s.id, ...data },
  })
  return { created: true }
}

/**
 * Fetch one response thread + write each message to DB.
 * - threadId = response crmId
 * - sender derived from authorUserId match against managerIdMap
 * - Manager auto-created if seen in thread but not yet in DB
 */
async function writeResponseThread(
  tenantId: string,
  resp: ParsedResponse,
  adapter: GetCourseAdapter,
  managerIdMap: Map<string, string>
): Promise<{
  messagesCreated: number
  messagesUpdated: number
  managersCreated: number
  fetchedCount: number
}> {
  let messagesCreated = 0
  let messagesUpdated = 0
  let managersCreated = 0

  let messages
  try {
    messages = await adapter.getResponseThread(resp.crmId)
  } catch (e) {
    console.error(`[GC_SYNC_V2] Failed to fetch thread ${resp.crmId}:`, e)
    return { messagesCreated: 0, messagesUpdated: 0, managersCreated: 0, fetchedCount: 0 }
  }
  const fetchedCount = messages.length

  // Ensure responsible manager exists (from list metadata)
  if (resp.managerUserId && resp.managerUserName && !managerIdMap.has(resp.managerUserId)) {
    const existing = await db.manager.findFirst({
      where: { tenantId, crmId: resp.managerUserId },
    })
    if (existing) {
      managerIdMap.set(resp.managerUserId, existing.id)
    } else {
      const created = await db.manager.create({
        data: {
          tenantId,
          crmId: resp.managerUserId,
          name: resp.managerUserName,
        },
      })
      managerIdMap.set(resp.managerUserId, created.id)
      managersCreated++
    }
  }

  for (const msg of messages) {
    // Skip empty/system events with no content for now (can be enabled later)
    if (!msg.text || msg.text.length === 0) continue

    // Determine sender role
    const isAuthorManager = msg.authorUserId && managerIdMap.has(msg.authorUserId)
    let sender: "MANAGER" | "CLIENT" | "SYSTEM"
    if (msg.isSystem) sender = "SYSTEM"
    else if (isAuthorManager) sender = "MANAGER"
    else if (msg.authorUserId === resp.clientUserId) sender = "CLIENT"
    else sender = "SYSTEM" // unknown → safe default

    const data = {
      tenantId,
      managerId: isAuthorManager ? managerIdMap.get(msg.authorUserId!) : null,
      crmId: msg.commentId,
      threadId: resp.crmId,
      channel: msg.channel,
      sender,
      content: msg.text,
      timestamp: msg.timestamp ?? new Date(),
      isAudio: false,
    }

    const existing = await db.message.findFirst({
      where: { tenantId, crmId: msg.commentId },
    })
    if (existing) {
      await db.message.update({ where: { id: existing.id }, data })
      messagesUpdated++
    } else {
      await db.message.create({ data })
      messagesCreated++
    }
  }

  // SECOND LAYER — bot/auto-mailing messages for the same conversation.
  // Stored as sender=SYSTEM with channel prefixed by "bot:" so AI consumer
  // can distinguish bot vs system events. Skipped if no conversationId.
  let botFetched = 0
  if (resp.conversationId) {
    try {
      const botMessages = await adapter.getBotMessages(resp.conversationId)
      botFetched = botMessages.length
      for (const bot of botMessages) {
        if (!bot.text || bot.text.length === 0) continue
        const botCrmId = bot.crmId
          ? `bot-${bot.crmId}`
          : `bot-${resp.crmId}-${bot.timestamp?.getTime() ?? Math.random()}`
        const data = {
          tenantId,
          managerId: null,
          crmId: botCrmId,
          threadId: resp.crmId,
          channel: bot.channel ? `bot:${bot.channel}` : "bot",
          sender: "SYSTEM" as const,
          content: bot.botName ? `[${bot.botName}] ${bot.text}` : bot.text,
          timestamp: bot.timestamp ?? new Date(),
          isAudio: false,
        }
        const existing = await db.message.findFirst({
          where: { tenantId, crmId: botCrmId },
        })
        if (existing) {
          await db.message.update({ where: { id: existing.id }, data })
          messagesUpdated++
        } else {
          await db.message.create({ data })
          messagesCreated++
        }
      }
    } catch (e) {
      // Bot endpoint failures are non-critical — log and continue.
      console.warn(
        `[GC_SYNC_V2] Bot messages fetch failed for conv ${resp.conversationId}:`,
        e
      )
    }
  }

  return {
    messagesCreated,
    messagesUpdated,
    managersCreated,
    fetchedCount: fetchedCount + botFetched,
  }
}

async function writeDealsPage(
  tenantId: string,
  rows: ParsedDeal[],
  dealIdMap: Map<string, string>
): Promise<{ created: number; updated: number }> {
  let created = 0
  let updated = 0
  for (const d of rows) {
    const data = {
      tenantId,
      crmId: d.crmId,
      title: d.title || `Deal ${d.crmId}`,
      amount: d.amount ?? null,
      status: gcStatusToUnified(d.status).toUpperCase() as
        | "OPEN"
        | "WON"
        | "LOST",
      // CRITICAL: clientCrmId — без него phone matching CallRecord→Deal не работает.
      // Парсер deal-list.ts вытаскивает d.clientUserId из data-user-id, но раньше
      // здесь не записывалось → 97% Deals имели clientCrmId=NULL. Backfill через
      // scripts/backfill-deal-userid-direct.ts. Цепочка резолва — canon #8.
      clientCrmId: d.clientUserId || null,
    }
    const existing = await db.deal.findFirst({
      where: { tenantId, crmId: d.crmId },
    })
    if (existing) {
      await db.deal.update({ where: { id: existing.id }, data })
      dealIdMap.set(d.crmId, existing.id)
      updated++
    } else {
      const createdRow = await db.deal.create({ data })
      dealIdMap.set(d.crmId, createdRow.id)
      created++
    }
  }
  return { created, updated }
}

async function writeContactsPage(
  tenantId: string,
  rows: ParsedContact[],
  managerIdMap: Map<string, string>,
  dealIdMap: Map<string, string>
): Promise<{
  callsCreated: number
  callsUpdated: number
  managersCreated: number
  managersUpdated: number
}> {
  // 1) ensure managers
  let managersCreated = 0
  let managersUpdated = 0
  for (const c of rows) {
    if (!c.managerCrmId || !c.managerName || managerIdMap.has(c.managerCrmId)) continue
    const existing = await db.manager.findFirst({
      where: { tenantId, crmId: c.managerCrmId },
    })
    if (existing) {
      managerIdMap.set(c.managerCrmId, existing.id)
      if (existing.name !== c.managerName) {
        await db.manager.update({
          where: { id: existing.id },
          data: { name: c.managerName },
        })
        managersUpdated++
      }
    } else {
      const m = await db.manager.create({
        data: { tenantId, crmId: c.managerCrmId, name: c.managerName },
      })
      managerIdMap.set(c.managerCrmId, m.id)
      managersCreated++
    }
  }

  // 2) call records
  let callsCreated = 0
  let callsUpdated = 0
  for (const c of rows) {
    const linkedDealId = c.linkedDealId
      ? await resolveDealId(tenantId, c.linkedDealId, dealIdMap)
      : null

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
      dealId: linkedDealId,
      createdAt: c.callDate ?? new Date(),
    }
    const existing = await db.callRecord.findFirst({
      where: { tenantId, crmId: c.crmId },
    })
    if (existing) {
      await db.callRecord.update({ where: { id: existing.id }, data })
      callsUpdated++
    } else {
      await db.callRecord.create({ data })
      callsCreated++
    }
  }

  return { callsCreated, callsUpdated, managersCreated, managersUpdated }
}

/**
 * Look up dealId from cache; on miss, query DB once and cache.
 * Returns null if deal isn't in our DB yet (e.g. older than the sync window).
 */
async function resolveDealId(
  tenantId: string,
  crmId: string,
  cache: Map<string, string>
): Promise<string | null> {
  if (cache.has(crmId)) return cache.get(crmId)!
  const found = await db.deal.findFirst({
    where: { tenantId, crmId },
    select: { id: true },
  })
  if (found) {
    cache.set(crmId, found.id)
    return found.id
  }
  return null
}

function resolveAccountUrl(cfg: Pick<CrmConfig, "subdomain">): string {
  const sub = cfg.subdomain
  if (!sub) {
    throw new Error("CrmConfig.subdomain is required for GetCourse")
  }
  if (sub.includes(".")) return `https://${sub}`
  return `https://${sub}.getcourse.ru`
}

function decryptCookie(cfg: Pick<CrmConfig, "gcCookie">): string {
  if (!cfg.gcCookie) {
    throw new Error("CrmConfig.gcCookie is missing — cookie not provisioned yet")
  }
  try {
    return decrypt(cfg.gcCookie)
  } catch {
    return cfg.gcCookie
  }
}
