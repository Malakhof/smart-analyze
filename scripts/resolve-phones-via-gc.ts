/**
 * resolve-phones-via-gc.ts — Phone resolve через GetCourse HTML scraping
 *
 * Решает phone matching канон #8 для diva (GC tenant):
 *   1. Уникальные clientPhone из CallRecord (где dealId IS NULL)
 *   2. GET /pl/user/contact/index?ContactSearch[phone]=X с cookie
 *   3. Парсинг HTML → data-key="208994164" = GC user_id (= clientCrmId в нашей БД)
 *   4. UPDATE CallRecord SET gcContactId=user_id, dealId=(SELECT id FROM Deal WHERE clientCrmId=user_id ORDER BY createdAt DESC LIMIT 1)
 *
 * НЕ использует /pl/api/account/users (требует API key которого у нас нет).
 * Использует cookie-auth HTML endpoint который УЖЕ работает.
 *
 * Idempotent: cache в /tmp/phone-to-userid-<tenant>.json
 *
 * Usage:
 *   set -a && . ./.env && set +a && \
 *     ./node_modules/.bin/tsx scripts/resolve-phones-via-gc.ts diva-school
 *
 * Server (matches other scripts):
 *   docker run --rm --network smart-analyze_default -v /root/smart-analyze:/app -w /app \
 *     node:22-slim sh -c 'set -a && . /app/.env && set +a && \
 *       ./node_modules/.bin/tsx scripts/resolve-phones-via-gc.ts diva-school'
 */
import { promises as fs } from "node:fs"
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { decrypt } from "../src/lib/crypto"

// gcCookie может быть либо encrypted (формат iv:tag:enc), либо plain (для diva)
function readCookie(stored: string): string {
  // encrypted имеет 3 ":" разделителя
  if (/^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/i.test(stored)) {
    return decrypt(stored)
  }
  return stored
}

const TENANT_NAME = process.argv[2]
if (!TENANT_NAME) {
  console.error("Usage: resolve-phones-via-gc.ts <tenantName>")
  process.exit(1)
}

const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const db = new PrismaClient({ adapter: adapterPg })

function normalizePhone(phone: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, "")
  // last 10 digits (без +7/8)
  if (digits.length >= 10) return digits.slice(-10)
  return digits
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// Парсит HTML контактного списка GC, ищет contact id из <a href="/contact/update/id/X">
function parseContactIdFromHtml(html: string): string | null {
  // primary pattern — table row data-key
  const dataKey = html.match(/<tr[^>]*data-key="(\d+)"/)
  if (dataKey) return dataKey[1]
  // alternate — link
  const link = html.match(/\/contact\/update\/id\/(\d+)/)
  if (link) return link[1]
  return null
}

async function main() {
  // Tenant
  const tenant = await db.tenant.findFirst({ where: { name: TENANT_NAME } })
  if (!tenant) {
    console.error(`Tenant not found: ${TENANT_NAME}`)
    process.exit(1)
  }
  console.log(`Tenant: ${tenant.name} (${tenant.id})`)

  // GC config
  const cfg = await db.crmConfig.findFirst({
    where: { tenantId: tenant.id, provider: "GETCOURSE", isActive: true },
  })
  if (!cfg?.gcCookie || !cfg.subdomain) {
    console.error("No active GETCOURSE config")
    process.exit(1)
  }
  const cookie = readCookie(cfg.gcCookie)
  const host = cfg.subdomain.includes(".")
    ? cfg.subdomain
    : `${cfg.subdomain}.getcourse.ru`
  console.log(`GC host: ${host}`)

  // Уникальные phones для resolve
  const rows = await db.$queryRawUnsafe<{ clientPhone: string }[]>(
    `SELECT DISTINCT "clientPhone" FROM "CallRecord"
     WHERE "tenantId" = $1
       AND "clientPhone" IS NOT NULL
       AND ("dealId" IS NULL OR "gcContactId" IS NULL)`,
    tenant.id
  )
  console.log(`Total unique phones to resolve: ${rows.length}`)

  // Cache (idempotent)
  const cachePath = `/tmp/phone-to-userid-${TENANT_NAME}.json`
  let cache: Record<string, string | null> = {}
  try {
    cache = JSON.parse(await fs.readFile(cachePath, "utf8"))
    console.log(`Loaded cache: ${Object.keys(cache).length} entries`)
  } catch {
    console.log("No cache, starting fresh")
  }

  let resolved = 0
  let skipped = 0
  let notFound = 0
  let errors = 0
  const t0 = Date.now()

  for (let i = 0; i < rows.length; i++) {
    const phone = normalizePhone(rows[i].clientPhone)
    if (!phone) {
      notFound++
      continue
    }
    if (phone in cache) {
      skipped++
      continue
    }

    const url = `https://${host}/pl/user/contact/index?ContactSearch%5Bphone%5D=${phone}`
    try {
      const res = await fetch(url, {
        headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0" },
      })
      if (!res.ok) {
        console.warn(`  HTTP ${res.status} for ${phone}`)
        errors++
        cache[phone] = null
      } else {
        const html = await res.text()
        const contactId = parseContactIdFromHtml(html)
        cache[phone] = contactId
        if (contactId) resolved++
        else notFound++
      }
    } catch (e) {
      console.warn(`  fetch error ${phone}: ${e}`)
      errors++
      cache[phone] = null
    }

    // Rate limit
    await sleep(250)

    // Checkpoint every 50
    if ((i + 1) % 50 === 0) {
      await fs.writeFile(cachePath, JSON.stringify(cache, null, 2))
      const rate = (i + 1) / ((Date.now() - t0) / 1000)
      const eta = (rows.length - i - 1) / rate / 60
      console.log(
        `  [${i + 1}/${rows.length}] resolved=${resolved} notFound=${notFound} skipped=${skipped} errors=${errors} rate=${rate.toFixed(1)}/s ETA=${eta.toFixed(1)}min`
      )
    }
  }
  await fs.writeFile(cachePath, JSON.stringify(cache, null, 2))
  console.log(
    `\n[lookup done] resolved=${resolved} notFound=${notFound} skipped=${skipped} errors=${errors} cache=${cachePath}`
  )

  // Update CallRecord
  console.log("\n[update] linking CallRecord -> Deal via clientCrmId...")
  let updatedContact = 0
  let updatedDeal = 0
  let dealNotFound = 0
  for (const [phone, userId] of Object.entries(cache)) {
    if (!userId) continue
    // gcContactId always
    const r1 = await db.$executeRawUnsafe(
      `UPDATE "CallRecord" SET "gcContactId" = $1
       WHERE "tenantId" = $2 AND "clientPhone" LIKE $3 AND "gcContactId" IS NULL`,
      userId,
      tenant.id,
      `%${phone}%`
    )
    updatedContact += r1
    // dealId via Deal
    const deal = await db.deal.findFirst({
      where: { tenantId: tenant.id, clientCrmId: userId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    })
    if (deal) {
      const r2 = await db.$executeRawUnsafe(
        `UPDATE "CallRecord" SET "dealId" = $1
         WHERE "tenantId" = $2 AND "clientPhone" LIKE $3 AND "dealId" IS NULL`,
        deal.id,
        tenant.id,
        `%${phone}%`
      )
      updatedDeal += r2
    } else {
      dealNotFound++
    }
  }
  console.log(
    `[update done] gcContactId rows=${updatedContact}, dealId rows=${updatedDeal}, deal not found for ${dealNotFound} contacts`
  )

  // Final stats
  const stats = await db.$queryRawUnsafe<
    { with_contact: bigint; with_deal: bigint; total: bigint }[]
  >(
    `SELECT
       COUNT(*) FILTER (WHERE "gcContactId" IS NOT NULL) AS with_contact,
       COUNT(*) FILTER (WHERE "dealId" IS NOT NULL) AS with_deal,
       COUNT(*) AS total
     FROM "CallRecord"
     WHERE "tenantId" = $1`,
    tenant.id
  )
  console.log(`\n[final] ${TENANT_NAME}:`, stats[0])

  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
