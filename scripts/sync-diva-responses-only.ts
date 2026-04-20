/**
 * RESPONSES-ONLY GetCourse sync для diva — без DEALS/CONTACTS step.
 * Использует уже существующие Deal + Manager в БД (загружены основным sync).
 * Цель — быстро дотянуть Messages для AI-анализа сделок.
 *
 * Run on server:
 *   docker run --rm --network smart-analyze_default -v /root/smart-analyze:/app -w /app \
 *     node:22-slim sh -c 'set -a && . /app/.env && set +a && \
 *       ./node_modules/.bin/tsx scripts/sync-diva-responses-only.ts [maxPages=20]'
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { GetCourseAdapter } from "../src/lib/crm/getcourse/adapter"

const maxPages = Number(process.argv[2] ?? 30)

async function main() {
  const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter: adapterPg })

  const cfg = await db.crmConfig.findFirstOrThrow({
    where: { tenant: { name: "diva-school" }, provider: "GETCOURSE" },
    include: { tenant: true },
  })
  if (!cfg.subdomain || !cfg.gcCookie) throw new Error("missing subdomain/cookie")

  const adapter = new GetCourseAdapter(
    `https://${cfg.subdomain}.getcourse.ru`,
    cfg.gcCookie
  )
  const tenantId = cfg.tenantId
  console.log(`Starting responses-only sync for diva (maxPages=${maxPages})`)

  // Pre-load deal + manager maps (built once from DB, no need to re-pull)
  const deals = await db.deal.findMany({
    where: { tenantId, crmId: { not: null } },
    select: { id: true, crmId: true },
  })
  const dealIdMap = new Map<string, string>()
  for (const d of deals) if (d.crmId) dealIdMap.set(d.crmId, d.id)
  console.log(`Loaded ${dealIdMap.size} deals from DB`)

  const managers = await db.manager.findMany({
    where: { tenantId, crmId: { not: null } },
    select: { id: true, crmId: true },
  })
  const managerIdMap = new Map<string, string>()
  for (const m of managers) if (m.crmId) managerIdMap.set(m.crmId, m.id)
  console.log(`Loaded ${managerIdMap.size} managers from DB`)

  let totalResponses = 0
  let totalMessages = 0
  let pagesProcessed = 0

  // Open responses (active deals — most likely to have client conversations)
  for (const status of ["open", "closed"] as const) {
    console.log(`\n[${status}] starting…`)
    await adapter.streamResponses(
      status,
      async (responses) => {
        for (const resp of responses) {
          try {
            const messages = await adapter.getResponseThread(resp.crmId)
            if (messages.length === 0) continue

            // dealId: ParsedResponse doesn't have direct dealId — match by clientUserId later if needed
            const managerId = resp.managerUserId
              ? managerIdMap.get(String(resp.managerUserId))
              : null

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
                    sender,
                    content: msg.text ?? "",
                    timestamp: msg.timestamp ?? new Date(),
                    isAudio: false,
                    channel: msg.channel ?? null,
                  },
                })
                totalMessages++
              } catch {
                // skip duplicate or malformed
              }
            }
          } catch (e) {
            console.error(`resp ${resp.crmId} failed: ${(e as Error).message.slice(0, 80)}`)
          }
        }
        totalResponses += responses.length
        pagesProcessed++
        console.log(
          `  [${status}] page ${pagesProcessed}: +${responses.length} responses, total messages: ${totalMessages}`
        )
      },
      { maxPages, rateLimitMs: 600 }
    )
  }

  console.log(`\nDONE: ${totalResponses} responses, ${totalMessages} messages written`)
  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
