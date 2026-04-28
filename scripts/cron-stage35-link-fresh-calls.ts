/**
 * cron-stage35-link-fresh-calls.ts — Stage 3.5 в real-time pipeline.
 *
 * Запускается каждые 30 минут (cron). Для свежих CallRecord (без gcContactId/dealId):
 *   1. Phone resolve через GC HTML scraping (только новые phones, кэш в БД)
 *   2. UPDATE CallRecord SET gcContactId
 *   3. UPDATE CallRecord SET dealId = JOIN через Deal.clientCrmId
 *
 * Для diva и других GC tenants. Для amoCRM tenants — skip (dealId приходит из CRM API).
 *
 * Usage:
 *   tsx scripts/cron-stage35-link-fresh-calls.ts <tenantName>
 */
import { promises as fs } from "node:fs"
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { decrypt } from "../src/lib/crypto"

const TENANT_NAME = process.argv[2]
if (!TENANT_NAME) {
  console.error("Usage: cron-stage35-link-fresh-calls.ts <tenantName>")
  process.exit(1)
}

function readCookie(s: string): string {
  if (/^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/i.test(s)) return decrypt(s)
  return s
}
function normalizePhone(p: string | null): string | null {
  if (!p) return null
  const d = p.replace(/\D/g, "")
  return d.length >= 10 ? d.slice(-10) : d
}
function parseContactId(html: string): string | null {
  const m1 = html.match(/<tr[^>]*data-key="(\d+)"/)
  if (m1) return m1[1]
  const m2 = html.match(/\/contact\/update\/id\/(\d+)/)
  return m2 ? m2[1] : null
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter: adapterPg })

  const tenant = await db.tenant.findFirst({ where: { name: TENANT_NAME } })
  if (!tenant) {
    console.error("Tenant not found")
    process.exit(1)
  }

  const cfg = await db.crmConfig.findFirst({
    where: { tenantId: tenant.id, provider: "GETCOURSE", isActive: true },
  })
  if (!cfg?.gcCookie || !cfg.subdomain) {
    console.log(`[skip] no GC config — tenant ${TENANT_NAME} probably amoCRM`)
    process.exit(0)
  }
  const cookie = readCookie(cfg.gcCookie)
  const host = cfg.subdomain.includes(".") ? cfg.subdomain : `${cfg.subdomain}.getcourse.ru`

  // 1. Свежие phones без gcContactId
  const fresh = await db.$queryRawUnsafe<{ clientPhone: string }[]>(
    `SELECT DISTINCT "clientPhone" FROM "CallRecord"
     WHERE "tenantId" = $1
       AND "clientPhone" IS NOT NULL
       AND "gcContactId" IS NULL
       AND "createdAt" > NOW() - INTERVAL '7 days'`,
    tenant.id
  )
  console.log(`[stage 3.5] fresh phones to resolve: ${fresh.length}`)

  // 2. Загрузить кэш
  const cachePath = `/tmp/phone-to-userid-${TENANT_NAME}.json`
  let cache: Record<string, string | null> = {}
  try {
    cache = JSON.parse(await fs.readFile(cachePath, "utf8"))
  } catch {}

  let resolved = 0
  let skipped = 0
  for (const { clientPhone } of fresh) {
    const phone = normalizePhone(clientPhone)
    if (!phone) continue
    if (phone in cache) {
      skipped++
      continue
    }
    const url = `https://${host}/pl/user/contact/index?ContactSearch%5Bphone%5D=${phone}`
    try {
      const res = await fetch(url, {
        headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0" },
      })
      if (res.ok) {
        const html = await res.text()
        cache[phone] = parseContactId(html)
        if (cache[phone]) resolved++
      } else {
        cache[phone] = null
      }
    } catch {
      cache[phone] = null
    }
    await sleep(250)
  }
  await fs.writeFile(cachePath, JSON.stringify(cache, null, 2))
  console.log(`[resolve] resolved=${resolved} skipped(in cache)=${skipped}`)

  // 3. UPDATE gcContactId для всех новых
  let cUpdated = 0
  for (const [phone, userId] of Object.entries(cache)) {
    if (!userId) continue
    const r = await db.$executeRawUnsafe(
      `UPDATE "CallRecord" SET "gcContactId" = $1
       WHERE "tenantId" = $2 AND "gcContactId" IS NULL AND "clientPhone" LIKE $3`,
      userId,
      tenant.id,
      `%${phone}%`
    )
    cUpdated += r
  }
  console.log(`[update gcContactId] rows: ${cUpdated}`)

  // 4. UPDATE dealId через JOIN
  const linked = await db.$executeRawUnsafe(
    `UPDATE "CallRecord" cr
     SET "dealId" = (
       SELECT d.id FROM "Deal" d
       WHERE d."tenantId" = cr."tenantId"
         AND d."clientCrmId" = cr."gcContactId"
       ORDER BY d."createdAt" DESC LIMIT 1
     )
     WHERE cr."tenantId" = $1
       AND cr."gcContactId" IS NOT NULL
       AND cr."dealId" IS NULL`,
    tenant.id
  )
  console.log(`[link dealId] rows: ${linked}`)

  await db.$disconnect()
  console.log(`[stage 3.5 done] ${TENANT_NAME}: ${cUpdated} contacts linked, ${linked} deals linked`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
