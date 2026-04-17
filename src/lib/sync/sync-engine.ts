import { db } from "@/lib/db"
import { createCrmAdapter } from "@/lib/crm/adapter"
import { getAmoCrmAccessToken } from "@/lib/crm/amocrm-oauth"
import type { CrmDeal, CrmMessage } from "@/lib/crm/types"
import type { DealStatus, MessageSender, CallDirection } from "@/generated/prisma"

export interface SyncProgress {
  step: string
  current: number
  total: number
}

export interface SyncResult {
  managers: number
  funnels: number
  deals: number
  messages: number
}

const DEAL_BATCH_SIZE = 10

function mapDealStatus(status: CrmDeal["status"]): DealStatus {
  switch (status) {
    case "won":
      return "WON"
    case "lost":
      return "LOST"
    default:
      return "OPEN"
  }
}

function mapSender(sender: CrmMessage["sender"]): MessageSender {
  switch (sender) {
    case "manager":
      return "MANAGER"
    case "client":
      return "CLIENT"
    default:
      return "SYSTEM"
  }
}

function calcDuration(createdAt: Date, closedAt: Date | null): number | null {
  if (!closedAt) return null
  return (closedAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60) // hours
}

export interface SyncOptions {
  pipelines?: string[]     // amoCRM pipeline IDs to include (others skipped)
  sinceDays?: number       // only deals created in last N days
}

export async function syncFromCrm(
  tenantId: string,
  crmConfigId: string,
  onProgress?: (progress: SyncProgress) => void,
  options?: SyncOptions,
): Promise<SyncResult> {
  // 1. Fetch CrmConfig from DB
  const crmConfig = await db.crmConfig.findFirst({
    where: { id: crmConfigId, tenantId },
  })

  if (!crmConfig) {
    throw new Error("CRM config not found")
  }

  if (!crmConfig.isActive) {
    throw new Error("CRM config is not active")
  }

  // 2. Create adapter via factory
  // For amoCRM — fetch a fresh access_token (refresh via stored refreshToken if expired/missing).
  // For other providers, pass apiKey as stored.
  let apiKeyForAdapter = crmConfig.apiKey
  if (crmConfig.provider === "AMOCRM") {
    apiKeyForAdapter = await getAmoCrmAccessToken(crmConfig.id)
  }

  const adapter = createCrmAdapter({
    provider: crmConfig.provider,
    webhookUrl: crmConfig.webhookUrl,
    subdomain: crmConfig.subdomain,
    apiKey: apiKeyForAdapter,
    gcCookie: crmConfig.gcCookie,
  })

  const stats: SyncResult = { managers: 0, funnels: 0, deals: 0, messages: 0 }

  // 3. Sync managers
  onProgress?.({ step: "managers", current: 0, total: 0 })
  const crmManagers = await adapter.getManagers()
  onProgress?.({ step: "managers", current: 0, total: crmManagers.length })

  for (let i = 0; i < crmManagers.length; i++) {
    const cm = crmManagers[i]
    await db.manager.upsert({
      where: {
        id: (
          await db.manager.findFirst({
            where: { crmId: cm.crmId, tenantId },
            select: { id: true },
          })
        )?.id ?? "",
      },
      create: {
        tenantId,
        crmId: cm.crmId,
        name: cm.name,
        email: cm.email ?? null,
      },
      update: {
        name: cm.name,
        email: cm.email ?? null,
      },
    })
    stats.managers++
    onProgress?.({ step: "managers", current: i + 1, total: crmManagers.length })
  }

  // 4. Sync funnels + stages
  onProgress?.({ step: "funnels", current: 0, total: 0 })
  const crmFunnels = await adapter.getFunnels()
  onProgress?.({ step: "funnels", current: 0, total: crmFunnels.length })

  for (let i = 0; i < crmFunnels.length; i++) {
    const cf = crmFunnels[i]

    const existingFunnel = await db.funnel.findFirst({
      where: { crmId: cf.crmId, tenantId },
    })

    const funnel = existingFunnel
      ? await db.funnel.update({
          where: { id: existingFunnel.id },
          data: { name: cf.name },
        })
      : await db.funnel.create({
          data: { tenantId, crmId: cf.crmId, name: cf.name },
        })

    // Upsert stages
    for (const cs of cf.stages) {
      const existingStage = await db.funnelStage.findFirst({
        where: { crmId: cs.crmId, funnelId: funnel.id },
      })

      if (existingStage) {
        await db.funnelStage.update({
          where: { id: existingStage.id },
          data: { name: cs.name, order: cs.order },
        })
      } else {
        await db.funnelStage.create({
          data: {
            funnelId: funnel.id,
            crmId: cs.crmId,
            name: cs.name,
            order: cs.order,
          },
        })
      }
    }

    stats.funnels++
    onProgress?.({ step: "funnels", current: i + 1, total: crmFunnels.length })
  }

  // 5. Sync deals — optional pipeline + since filter
  onProgress?.({ step: "deals", current: 0, total: 0 })
  const since = options?.sinceDays
    ? new Date(Date.now() - options.sinceDays * 24 * 60 * 60 * 1000)
    : undefined
  let crmDeals: CrmDeal[]
  if (options?.pipelines && options.pipelines.length > 0) {
    crmDeals = []
    for (const pid of options.pipelines) {
      const pipelineDeals = await adapter.getDeals(pid, since)
      crmDeals = crmDeals.concat(pipelineDeals)
    }
  } else {
    crmDeals = await adapter.getDeals(undefined, since)
  }
  onProgress?.({ step: "deals", current: 0, total: crmDeals.length })

  for (let i = 0; i < crmDeals.length; i++) {
    const cd = crmDeals[i]

    try {
      // Resolve manager by crmId
      const manager = cd.managerId
        ? await db.manager.findFirst({
            where: { crmId: cd.managerId, tenantId },
            select: { id: true },
          })
        : null

      // Resolve funnel by crmId
      const funnel = cd.funnelId
        ? await db.funnel.findFirst({
            where: { crmId: cd.funnelId, tenantId },
            select: { id: true },
          })
        : null

      const existingDeal = await db.deal.findFirst({
        where: { crmId: cd.crmId, tenantId },
        select: { id: true, messages: { select: { id: true }, take: 1 } },
      })

      const dealData = {
        title: cd.title,
        amount: cd.amount,
        status: mapDealStatus(cd.status),
        managerId: manager?.id ?? null,
        funnelId: funnel?.id ?? null,
        closedAt: cd.closedAt,
        duration: calcDuration(cd.createdAt, cd.closedAt),
      }

      const deal = existingDeal
        ? await db.deal.update({
            where: { id: existingDeal.id },
            data: dealData,
          })
        : await db.deal.create({
            data: {
              ...dealData,
              tenantId,
              crmId: cd.crmId,
              createdAt: cd.createdAt,
            },
          })

      stats.deals++

      // 6. Sync messages in batches
      if (i % DEAL_BATCH_SIZE === 0) {
        onProgress?.({ step: "messages", current: i, total: crmDeals.length })
      }

      // Skip if deal already has messages (unless it's still open and might have new ones)
      const hasExistingMessages = existingDeal && existingDeal.messages.length > 0
      if (hasExistingMessages && cd.status !== "open") {
        continue
      }

      try {
        const crmMessages = await adapter.getMessages(cd.crmId)

        if (crmMessages.length > 0) {
          // Get existing message timestamps to avoid duplicates
          const existingTimestamps = new Set(
            (
              await db.message.findMany({
                where: { dealId: deal.id },
                select: { timestamp: true },
              })
            ).map((m) => m.timestamp.getTime()),
          )

          const newMessages = crmMessages.filter(
            (m) => !existingTimestamps.has(m.timestamp.getTime()),
          )

          if (newMessages.length > 0) {
            await db.message.createMany({
              data: newMessages.map((m) => ({
                dealId: deal.id,
                sender: mapSender(m.sender),
                content: m.content,
                timestamp: m.timestamp,
                isAudio: m.isAudio,
                audioUrl: m.audioUrl ?? null,
                duration: m.duration ?? null,
              })),
            })
            stats.messages += newMessages.length

            // Create CallRecord entries for audio messages (for QC module)
            const audioMessages = newMessages.filter((m) => m.isAudio)
            for (const am of audioMessages) {
              const direction: CallDirection =
                am.sender === "manager" ? "OUTGOING" : "INCOMING"

              // Check if CallRecord already exists for this audio URL
              const existingCall = am.audioUrl
                ? await db.callRecord.findFirst({
                    where: { audioUrl: am.audioUrl, tenantId },
                  })
                : null

              if (!existingCall) {
                await db.callRecord.create({
                  data: {
                    tenantId,
                    managerId: manager?.id ?? null,
                    dealId: deal.id,
                    direction,
                    audioUrl: am.audioUrl ?? null,
                    duration: am.duration ?? null,
                    clientPhone: am.phone ?? null,
                    createdAt: am.timestamp,
                  },
                })
              }
            }
          }
        }
      } catch (msgError) {
        // Log but continue -- don't break entire sync for message errors
        console.error(
          `Failed to sync messages for deal ${cd.crmId}:`,
          msgError,
        )
      }
    } catch (dealError) {
      // Log but continue -- don't break entire sync for individual deal errors
      console.error(`Failed to sync deal ${cd.crmId}:`, dealError)
    }

    onProgress?.({ step: "deals", current: i + 1, total: crmDeals.length })
  }

  // 7. Update CrmConfig.lastSyncAt
  await db.crmConfig.update({
    where: { id: crmConfigId },
    data: { lastSyncAt: new Date() },
  })

  // 8. Update Tenant.dealsUsed count
  const totalDeals = await db.deal.count({ where: { tenantId } })
  await db.tenant.update({
    where: { id: tenantId },
    data: { dealsUsed: totalDeals },
  })

  return stats
}
