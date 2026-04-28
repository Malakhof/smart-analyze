/**
 * backfill-deal-userid-direct.ts
 *
 * Для каждого Deal в БД (без clientCrmId) → GET страницу деала в GC →
 * парсим data-user-id → UPDATE Deal.clientCrmId.
 * Concurrent (10 параллельных) с rate limit ~250ms между запросами.
 *
 * После backfill: UPDATE CallRecord.dealId через clientCrmId = gcContactId.
 *
 * Idempotent: пропускает deals у которых clientCrmId уже заполнен.
 *
 * Usage:
 *   tsx scripts/backfill-deal-userid-direct.ts <tenantId> [--concurrency=10] [--limit=N]
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { decrypt } from "../src/lib/crypto"

function readCookie(stored: string): string {
  if (/^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/i.test(stored)) return decrypt(stored)
  return stored
}

const args = process.argv.slice(2)
const tenantId = args[0]
const limitArg = args.find((a) => a.startsWith("--limit="))
const concArg = args.find((a) => a.startsWith("--concurrency="))
const limit = limitArg ? parseInt(limitArg.split("=")[1]) : 0
const concurrency = concArg ? parseInt(concArg.split("=")[1]) : 10

if (!tenantId) {
  console.error("Usage: tsx backfill-deal-userid-direct.ts <tenantId> [--concurrency=10] [--limit=N]")
  process.exit(1)
}

const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const db = new PrismaClient({ adapter: adapterPg })

async function main() {
  const cfg = await db.crmConfig.findFirst({
    where: { tenantId, provider: "GETCOURSE", isActive: true },
  })
  if (!cfg?.gcCookie || !cfg.subdomain) {
    console.error("No GETCOURSE config")
    process.exit(1)
  }
  const cookie = readCookie(cfg.gcCookie)
  const host = cfg.subdomain.includes(".") ? cfg.subdomain : `${cfg.subdomain}.getcourse.ru`

  // Pull deals without clientCrmId
  const deals = await db.$queryRawUnsafe<{ id: string; crmId: string }[]>(
    `SELECT id, "crmId" FROM "Deal"
     WHERE "tenantId" = $1
       AND "clientCrmId" IS NULL
       AND "crmId" ~ '^[0-9]+$'
     ${limit > 0 ? `LIMIT ${limit}` : ""}`,
    tenantId
  )
  console.log(`Total deals to process: ${deals.length}, concurrency=${concurrency}`)

  let done = 0
  let updated = 0
  let notFound = 0
  let errors = 0
  const t0 = Date.now()

  // Worker pool
  let idx = 0
  async function worker() {
    while (true) {
      const i = idx++
      if (i >= deals.length) break
      const deal = deals[i]
      try {
        const url = `https://${host}/sales/control/deal/update/id/${deal.crmId}`
        const res = await fetch(url, {
          headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0" },
        })
        if (!res.ok) {
          notFound++
        } else {
          const html = await res.text()
          const m = html.match(/data-user-id="(\d+)"/)
          if (m) {
            await db.$executeRawUnsafe(
              `UPDATE "Deal" SET "clientCrmId" = $1 WHERE id = $2`,
              m[1],
              deal.id
            )
            updated++
          } else {
            notFound++
          }
        }
      } catch (e) {
        errors++
      }
      done++
      if (done % 200 === 0) {
        const rate = done / ((Date.now() - t0) / 1000)
        const eta = (deals.length - done) / rate / 60
        console.log(
          `  [${done}/${deals.length}] updated=${updated} notFound=${notFound} errors=${errors} rate=${rate.toFixed(1)}/s ETA=${eta.toFixed(1)}min`
        )
      }
      // Throttle per worker (concurrency=10 × 100ms = 100 req/sec aggregate — мягко)
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  console.log(
    `\n[deal backfill done] processed=${done} updated=${updated} notFound=${notFound} errors=${errors}`
  )

  // Link CallRecord.dealId
  console.log("\n[link CallRecord] resolving dealId via gcContactId=clientCrmId...")
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

  const stats = await db.$queryRawUnsafe<
    { with_deal: bigint; with_contact: bigint; total: bigint }[]
  >(
    `SELECT
       COUNT(*) FILTER (WHERE "dealId" IS NOT NULL) AS with_deal,
       COUNT(*) FILTER (WHERE "gcContactId" IS NOT NULL) AS with_contact,
       COUNT(*) AS total
     FROM "CallRecord" WHERE "tenantId" = $1`,
    tenantId
  )
  console.log("[final CallRecord]", stats[0])

  const dealStats = await db.$queryRawUnsafe<
    { with_client: bigint; total: bigint }[]
  >(
    `SELECT
       COUNT(*) FILTER (WHERE "clientCrmId" IS NOT NULL) AS with_client,
       COUNT(*) AS total
     FROM "Deal" WHERE "tenantId" = $1`,
    tenantId
  )
  console.log("[final Deal]", dealStats[0])

  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
