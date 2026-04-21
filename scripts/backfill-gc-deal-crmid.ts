/**
 * One-shot backfill: re-parse GetCourse deal-list and fix Deal.crmId
 * from stale `data-deal-id` (grid row key) to the real URL deal ID.
 *
 * Background: parser bug — we stored `data-deal-id` as crmId, but GC deal
 * page URLs use a DIFFERENT id embedded in the cell[0] <a href>. Result:
 * every /sales/control/deal/update/id/{crmId} link we generated was broken.
 * Fix is in deal-list.ts; this script heals existing rows.
 *
 * Strategy: for each tenant with GETCOURSE CrmConfig, scan deal-list pages
 * over a given date window. For each parsed row, UPDATE Deal WHERE
 * tenantId=... AND crmId=parsedRow.gridKey SET crmId=parsedRow.crmId.
 *
 * Usage:
 *   tsx scripts/backfill-gc-deal-crmid.ts <tenantId> <YYYY-MM-DD from> <YYYY-MM-DD to>
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { GetCourseAdapter } from "../src/lib/crm/getcourse/adapter"
import { decrypt } from "../src/lib/crypto"

async function main() {
  const [tenantId, fromStr, toStr] = process.argv.slice(2)
  if (!tenantId || !fromStr || !toStr) {
    console.error(
      "Usage: backfill-gc-deal-crmid.ts <tenantId> <from YYYY-MM-DD> <to YYYY-MM-DD>"
    )
    process.exit(1)
  }
  const from = new Date(`${fromStr}T00:00:00Z`)
  const to = new Date(`${toStr}T23:59:59Z`)

  const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter: adapterPg })

  const config = await db.crmConfig.findFirst({
    where: { tenantId, provider: "GETCOURSE", isActive: true },
  })
  if (!config?.cookie || !config.subdomain) {
    console.error("No active GETCOURSE config for tenant", tenantId)
    process.exit(1)
  }

  const cookie = decrypt(config.cookie)
  const adapter = new GetCourseAdapter({
    accountUrl: `https://${config.subdomain}.getcourse.ru`,
    cookie,
  })

  let pagesSeen = 0
  let rowsSeen = 0
  let updated = 0
  let alreadyOk = 0
  let notFound = 0

  await adapter.streamDealsByDateRange(
    from,
    to,
    async (rows, pageNum) => {
      pagesSeen = pageNum
      rowsSeen += rows.length
      for (const row of rows) {
        if (!row.gridKey) continue
        if (row.gridKey === row.crmId) {
          alreadyOk++
          continue
        }
        // Find deal by OLD crmId (which was the gridKey before the fix)
        const existing = await db.deal.findFirst({
          where: { tenantId, crmId: row.gridKey },
        })
        if (!existing) {
          // Maybe already migrated — check by new URL id
          const byNew = await db.deal.findFirst({
            where: { tenantId, crmId: row.crmId },
          })
          if (byNew) alreadyOk++
          else notFound++
          continue
        }
        // Collision guard: make sure a different deal doesn't already own the
        // target URL id under the same tenant.
        const conflict = await db.deal.findFirst({
          where: { tenantId, crmId: row.crmId, id: { not: existing.id } },
        })
        if (conflict) {
          console.warn(
            `conflict: want to set ${existing.id} crmId=${row.crmId} but deal ${conflict.id} already has it`
          )
          continue
        }
        await db.deal.update({
          where: { id: existing.id },
          data: { crmId: row.crmId },
        })
        updated++
      }
      if (pageNum % 10 === 0) {
        console.log(
          `[p=${pageNum}] seen=${rowsSeen} updated=${updated} ok=${alreadyOk} notfound=${notFound}`
        )
      }
    },
    { perPage: 50 }
  )

  console.log(
    `[done] pages=${pagesSeen} rows=${rowsSeen} updated=${updated} already_ok=${alreadyOk} not_found=${notFound}`
  )
  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
