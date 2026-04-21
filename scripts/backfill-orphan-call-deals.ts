/**
 * Backfill orphan CallRecord.dealId for GC tenants.
 *
 * Why: contact-list HTML carries linkedDealId per call, but writeContactsPage
 * stores dealId only when resolveDealId finds an existing Deal. When the
 * linked deal isn't yet in our DB (e.g. it lives outside the deal-list sync
 * window), the call is silently orphaned. Diva: 386 of 445 transcripts
 * (87%) are orphans → /patterns analysis pool collapses to 31 instead of
 * 150+ usable deals.
 *
 * Strategy: one re-scan of contact-list over a date window. For each row:
 *   1) Look up CallRecord by crmId
 *   2) If dealId already set → skip (alreadyOk)
 *   3) Else if linkedDealId in HTML → either find local Deal by crmId, or
 *      create stub Deal (we have crmId + status from the contact row), then
 *      link the call.
 *
 * Forward fix lives in the sync code separately (resolveDealId enhancement).
 *
 * Usage:
 *   tsx scripts/backfill-orphan-call-deals.ts <tenantId> <YYYY-MM-DD from> <YYYY-MM-DD to>
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { GetCourseAdapter } from "../src/lib/crm/getcourse/adapter"
import { decrypt } from "../src/lib/crypto"

function gcOutcomeToStatus(label: string | null): "OPEN" | "WON" | "LOST" {
  // Contact list cell 3 has the deal status badge alongside the deal id.
  // We only get a coarse signal; default OPEN so /patterns analysis can
  // include the deal once a real sync overwrites the status.
  if (!label) return "OPEN"
  const t = label.toLowerCase()
  if (t.includes("оплач") || t.includes("заверш") || t.includes("выпол")) return "WON"
  if (t.includes("отмен") || t.includes("отказ")) return "LOST"
  return "OPEN"
}

async function main() {
  const [tenantId, fromStr, toStr] = process.argv.slice(2)
  if (!tenantId || !fromStr || !toStr) {
    console.error(
      "Usage: backfill-orphan-call-deals.ts <tenantId> <from YYYY-MM-DD> <to YYYY-MM-DD>"
    )
    process.exit(1)
  }
  const from = new Date(`${fromStr}T00:00:00Z`)
  const to = new Date(`${toStr}T23:59:59Z`)

  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  })

  const config = await db.crmConfig.findFirst({
    where: { tenantId, provider: "GETCOURSE", isActive: true },
  })
  if (!config?.gcCookie || !config.subdomain) {
    console.error("No active GETCOURSE config for tenant", tenantId)
    process.exit(1)
  }
  const cookie = decrypt(config.gcCookie)
  const host = config.subdomain.includes(".")
    ? config.subdomain
    : `${config.subdomain}.getcourse.ru`

  const adapter = new GetCourseAdapter(`https://${host}`, cookie)

  let pages = 0
  let rowsSeen = 0
  let alreadyOk = 0
  let linked = 0
  let createdStubDeals = 0
  let noLinkedDeal = 0
  let callNotInDb = 0

  await adapter.streamContactsByDateRange(
    from,
    to,
    async (rows, pageNum) => {
      pages = pageNum
      rowsSeen += rows.length
      for (const row of rows) {
        const call = await db.callRecord.findFirst({
          where: { tenantId, crmId: row.crmId },
          select: { id: true, dealId: true },
        })
        if (!call) {
          callNotInDb++
          continue
        }
        if (call.dealId) {
          alreadyOk++
          continue
        }
        if (!row.linkedDealId) {
          noLinkedDeal++
          continue
        }

        let deal = await db.deal.findFirst({
          where: { tenantId, crmId: row.linkedDealId },
          select: { id: true, clientCrmId: true },
        })
        if (!deal) {
          deal = await db.deal.create({
            data: {
              tenantId,
              crmId: row.linkedDealId,
              title: `Deal ${row.linkedDealId}`,
              status: gcOutcomeToStatus(row.outcomeLabel),
              clientCrmId: row.clientUserId || null,
              createdAt: row.callDate ?? new Date(),
            },
            select: { id: true, clientCrmId: true },
          })
          createdStubDeals++
        } else if (!deal.clientCrmId && row.clientUserId) {
          // Heal stubs from a previous run that lacked clientCrmId —
          // without it the anonymous-deal filter would exclude them
          // from metrics even though they represent real conversations.
          await db.deal.update({
            where: { id: deal.id },
            data: { clientCrmId: row.clientUserId },
          })
        }
        await db.callRecord.update({
          where: { id: call.id },
          data: { dealId: deal.id },
        })
        linked++
      }
      if (pageNum % 5 === 0) {
        console.log(
          `[p=${pageNum}] seen=${rowsSeen} linked=${linked} stubs=${createdStubDeals} ok=${alreadyOk} no_link=${noLinkedDeal} not_in_db=${callNotInDb}`
        )
      }
    },
    { perPage: 50 }
  )

  console.log(
    `[done] pages=${pages} rows=${rowsSeen} linked=${linked} stubs_created=${createdStubDeals} already_ok=${alreadyOk} no_linked_deal=${noLinkedDeal} call_not_in_db=${callNotInDb}`
  )
  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
