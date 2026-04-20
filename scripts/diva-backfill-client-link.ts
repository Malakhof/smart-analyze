/**
 * Plan B for diva: backfill Deal.clientCrmId + Message.clientCrmId, then link
 * orphan Messages to Deals so AI can analyze them at deal level.
 *
 * Steps:
 *  1. Re-pull diva responses (list pages only, fast) → build map respId→clientUserId
 *  2. Re-pull diva deal pages last 90 days → write Deal.clientCrmId for each
 *  3. Re-pull diva responses with thread fetch → write Message.clientCrmId from response.clientUserId
 *     (matching existing Message rows by content+timestamp+manager — fragile, so we just delete + reinsert)
 *  4. SQL UPDATE Message SET dealId = Deal.id WHERE clientCrmId match
 *
 * Run on server:
 *   docker run --rm --network smart-analyze_default -v /root/smart-analyze:/app -w /app \
 *     node:22-slim sh -c 'set -a && . /app/.env && set +a && \
 *       ./node_modules/.bin/tsx scripts/diva-backfill-client-link.ts'
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { GetCourseAdapter } from "../src/lib/crm/getcourse/adapter"
import { decrypt } from "../src/lib/crypto"

async function main() {
  const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter: adapterPg })
  const cfg = await db.crmConfig.findFirstOrThrow({
    where: { tenant: { name: "diva-school" }, provider: "GETCOURSE" },
    include: { tenant: true },
  })
  const accountUrl = cfg.subdomain!.includes(".")
    ? `https://${cfg.subdomain}`
    : `https://${cfg.subdomain}.getcourse.ru`
  let cookie: string
  try { cookie = decrypt(cfg.gcCookie!) } catch { cookie = cfg.gcCookie! }
  const adapter = new GetCourseAdapter(accountUrl, cookie)
  const tenantId = cfg.tenantId

  // ---- 1. Backfill Deal.clientCrmId from re-pulling deal pages last 90 days
  const deals = await db.deal.findMany({
    where: { tenantId, clientCrmId: null, crmId: { not: null } },
    select: { id: true, crmId: true },
  })
  console.log(`Deals without clientCrmId: ${deals.length}`)

  let updatedDeals = 0
  // Use streamDealsByDateRange — pages contain clientUserId
  const dealCrmToClientMap = new Map<string, string>()
  await adapter.streamDealsByDateRange(
    new Date(Date.now() - 90 * 24 * 3600 * 1000),
    new Date(),
    async (rows) => {
      for (const r of rows) {
        if (r.crmId && r.clientUserId) {
          dealCrmToClientMap.set(r.crmId, r.clientUserId)
        }
      }
      console.log(`  fetched page: total mapped = ${dealCrmToClientMap.size}`)
    },
    { maxPages: 200, rateLimitMs: 600 }
  )

  for (const d of deals) {
    if (d.crmId && dealCrmToClientMap.has(d.crmId)) {
      await db.deal.update({
        where: { id: d.id },
        data: { clientCrmId: dealCrmToClientMap.get(d.crmId)! },
      })
      updatedDeals++
    }
  }
  console.log(`Updated Deal.clientCrmId on ${updatedDeals} deals`)

  // ---- 2. Re-pull responses (list only) to map response thread → clientUserId
  // We don't refetch threads — instead we delete+reinsert with proper clientCrmId
  // This is faster: just rewrite messages with clientCrmId attached.
  console.log(`Deleting existing diva orphan messages…`)
  const deleted = await db.message.deleteMany({
    where: { tenantId, dealId: null },
  })
  console.log(`Deleted ${deleted.count} orphan messages`)

  // Re-fetch managers map
  const managers = await db.manager.findMany({
    where: { tenantId, crmId: { not: null } },
    select: { id: true, crmId: true },
  })
  const managerIdMap = new Map<string, string>()
  for (const m of managers) if (m.crmId) managerIdMap.set(m.crmId, m.id)

  let totalMessages = 0
  let totalResponses = 0
  let messagesWithClientCrmId = 0

  for (const status of ["open", "closed"] as const) {
    console.log(`\n[${status}] re-pulling responses with clientCrmId…`)
    await adapter.streamResponses(
      status,
      async (responses) => {
        for (const resp of responses) {
          try {
            const messages = await adapter.getResponseThread(resp.crmId)
            if (messages.length === 0) continue
            const managerId = resp.managerUserId
              ? managerIdMap.get(String(resp.managerUserId))
              : null
            const clientCrmId = resp.clientUserId

            for (const msg of messages) {
              try {
                const sender = msg.isSystem
                  ? "SYSTEM"
                  : msg.authorUserId === resp.clientUserId
                    ? "CLIENT"
                    : "MANAGER"
                await db.message.create({
                  data: {
                    tenantId,
                    managerId: managerId ?? null,
                    crmId: msg.commentId,
                    threadId: resp.crmId,
                    clientCrmId,
                    sender,
                    content: msg.text ?? "",
                    timestamp: msg.timestamp ?? new Date(),
                    isAudio: false,
                    channel: msg.channel ?? null,
                  },
                })
                totalMessages++
                if (clientCrmId) messagesWithClientCrmId++
              } catch {
                // skip duplicate
              }
            }
          } catch (e) {
            console.error(`resp ${resp.crmId}: ${(e as Error).message.slice(0, 80)}`)
          }
        }
        totalResponses += responses.length
        console.log(`  [${status}] +${responses.length} resp, ${totalMessages} msgs (${messagesWithClientCrmId} w/clientCrmId)`)
      },
      { maxPages: 30, rateLimitMs: 600 }
    )
  }

  // ---- 3. SQL link: UPDATE Message SET dealId based on clientCrmId match
  console.log(`\nLinking messages to deals via clientCrmId…`)
  const linked = await db.$executeRawUnsafe(`
    UPDATE "Message" m
    SET "dealId" = d.id
    FROM (
      SELECT DISTINCT ON ("clientCrmId") id, "clientCrmId"
      FROM "Deal"
      WHERE "tenantId"=$1 AND "clientCrmId" IS NOT NULL
      ORDER BY "clientCrmId", "createdAt" DESC
    ) d
    WHERE m."tenantId"=$1
      AND m."dealId" IS NULL
      AND m."clientCrmId" IS NOT NULL
      AND d."clientCrmId" = m."clientCrmId"
  `, tenantId)

  console.log(`Linked ${linked} messages to deals`)

  // Final stats
  const finalLinked = await db.message.count({
    where: { tenantId, dealId: { not: null } },
  })
  const finalOrphan = await db.message.count({
    where: { tenantId, dealId: null },
  })
  console.log(`\nFINAL: ${finalLinked} messages linked to deals, ${finalOrphan} orphan`)

  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
