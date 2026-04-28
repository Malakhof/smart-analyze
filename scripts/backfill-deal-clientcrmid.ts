/**
 * backfill-deal-clientcrmid.ts — заполнить Deal.clientCrmId из data-user-id
 *
 * Контекст: GC adapter парсит clientUserId (data-user-id), но при upsert Deal
 * это поле НЕ записывалось в Deal.clientCrmId. Из-за этого phone matching
 * CallRecord → Deal не работает: phone → gcContactId резолвится, а join
 * Deal.clientCrmId = gcContactId не срабатывает (clientCrmId NULL).
 *
 * Этот скрипт:
 *   1. Использует streamDealsByDateRange (тот же что в backfill-gc-deal-crmid.ts)
 *   2. Для каждого распарсенного deal — UPDATE Deal SET clientCrmId
 *   3. После — UPDATE CallRecord SET dealId через clientCrmId = gcContactId
 *
 * Usage:
 *   tsx scripts/backfill-deal-clientcrmid.ts <tenantId> <YYYY-MM-DD from> <YYYY-MM-DD to>
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { GetCourseAdapter } from "../src/lib/crm/getcourse/adapter"
import { decrypt } from "../src/lib/crypto"

function readCookie(stored: string): string {
  if (/^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/i.test(stored)) return decrypt(stored)
  return stored
}

async function main() {
  const [tenantId, fromStr, toStr] = process.argv.slice(2)
  if (!tenantId || !fromStr || !toStr) {
    console.error("Usage: backfill-deal-clientcrmid.ts <tenantId> <from> <to>")
    process.exit(1)
  }

  const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter: adapterPg })

  const config = await db.crmConfig.findFirst({
    where: { tenantId, provider: "GETCOURSE", isActive: true },
  })
  if (!config?.gcCookie || !config.subdomain) {
    console.error("No active GETCOURSE config")
    process.exit(1)
  }
  const cookie = readCookie(config.gcCookie)
  const host = config.subdomain.includes(".")
    ? config.subdomain
    : `${config.subdomain}.getcourse.ru`
  const adapter = new GetCourseAdapter(`https://${host}`, cookie)

  const from = new Date(`${fromStr}T00:00:00Z`)
  const to = new Date(`${toStr}T23:59:59Z`)

  let pagesSeen = 0
  let parsed = 0
  let updatedDeal = 0
  let alreadyOk = 0
  let dealNotFoundInDb = 0

  await adapter.streamDealsByDateRange(from, to, async (rows, pageNum) => {
    pagesSeen = pageNum
    parsed += rows.length
    for (const row of rows) {
      if (!row.crmId || !row.clientUserId) continue
      // Найти Deal в БД
      const deal = await db.deal.findFirst({
        where: { tenantId, crmId: row.crmId },
        select: { id: true, clientCrmId: true },
      })
      if (!deal) {
        // попробовать через gridKey (legacy fallback)
        const dealByGrid = await db.deal.findFirst({
          where: { tenantId, crmId: row.gridKey },
          select: { id: true, clientCrmId: true },
        })
        if (!dealByGrid) {
          dealNotFoundInDb++
          continue
        }
        // у этого Deal stale crmId = gridKey; обновим оба поля
        if (
          dealByGrid.clientCrmId !== row.clientUserId
        ) {
          await db.deal.update({
            where: { id: dealByGrid.id },
            data: { clientCrmId: row.clientUserId },
          })
          updatedDeal++
        } else {
          alreadyOk++
        }
        continue
      }
      if (deal.clientCrmId === row.clientUserId) {
        alreadyOk++
        continue
      }
      await db.deal.update({
        where: { id: deal.id },
        data: { clientCrmId: row.clientUserId },
      })
      updatedDeal++
    }
    if (pageNum % 5 === 0) {
      console.log(
        `  [page ${pageNum}] parsed=${parsed} updated=${updatedDeal} alreadyOk=${alreadyOk} notFound=${dealNotFoundInDb}`
      )
    }
  })
  console.log(
    `\n[deal backfill done] pages=${pagesSeen} parsed=${parsed} updated=${updatedDeal} alreadyOk=${alreadyOk} dealNotFoundInDb=${dealNotFoundInDb}`
  )

  // Теперь резолв CallRecord.dealId через gcContactId = clientCrmId
  console.log(
    "\n[link CallRecord] resolving dealId via gcContactId=clientCrmId..."
  )
  const linked = await db.$executeRawUnsafe(
    `UPDATE "CallRecord" cr
     SET "dealId" = (
       SELECT d.id FROM "Deal" d
       WHERE d."tenantId" = cr."tenantId"
         AND d."clientCrmId" = cr."gcContactId"
       ORDER BY d."createdAt" DESC
       LIMIT 1
     )
     WHERE cr."tenantId" = $1
       AND cr."gcContactId" IS NOT NULL
       AND cr."dealId" IS NULL`,
    tenantId
  )
  console.log(`[link done] CallRecord rows updated with dealId: ${linked}`)

  // Final stats
  const stats = await db.$queryRawUnsafe<
    { with_deal: bigint; total_with_contact: bigint }[]
  >(
    `SELECT
       COUNT(*) FILTER (WHERE "dealId" IS NOT NULL) AS with_deal,
       COUNT(*) FILTER (WHERE "gcContactId" IS NOT NULL) AS total_with_contact
     FROM "CallRecord" WHERE "tenantId" = $1`,
    tenantId
  )
  console.log("[final]", stats[0])

  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
