/**
 * Seed diva.school GetCourse client into Tenant + CrmConfig.
 * Cookie is read from env GC_DIVA_COOKIE (raw string with both PHPSESSID5 + PHPSESSID5_glob),
 * then encrypted before write. Subdomain stores the full host "web.diva.school" — adapter
 * resolveAccountUrl detects the dot and constructs https://{host} accordingly.
 *
 * Run on server:
 *   docker exec -w /app -e GC_DIVA_COOKIE="PHPSESSID5=...; PHPSESSID5_glob=..." \
 *     smart-analyze-app npx tsx scripts/seed-diva-getcourse.ts
 *
 * Idempotent: re-running upserts the cookie only.
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { encrypt } from "../src/lib/crypto"

const TENANT_NAME = "diva-school"
const SUBDOMAIN = "web.diva.school"

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v || v.trim() === "") throw new Error(`Missing env: ${name}`)
  return v.trim()
}

async function main() {
  const cookie = requireEnv("GC_DIVA_COOKIE")
  requireEnv("ENCRYPTION_KEY")
  const databaseUrl = requireEnv("DATABASE_URL")

  // Sanity-check cookie format
  if (!/PHPSESSID5=/.test(cookie)) {
    throw new Error("GC_DIVA_COOKIE must contain PHPSESSID5=...")
  }

  const adapter = new PrismaPg({ connectionString: databaseUrl })
  const prisma = new PrismaClient({ adapter })

  try {
    // 1) Tenant
    let tenant = await prisma.tenant.findFirst({ where: { name: TENANT_NAME } })
    if (!tenant) {
      tenant = await prisma.tenant.create({ data: { name: TENANT_NAME } })
      console.log(`  Tenant CREATED: ${TENANT_NAME} (${tenant.id})`)
    } else {
      console.log(`  Tenant exists:  ${TENANT_NAME} (${tenant.id})`)
    }

    // 2) CrmConfig (provider=GETCOURSE, subdomain="web.diva.school")
    const existing = await prisma.crmConfig.findFirst({
      where: { tenantId: tenant.id, provider: "GETCOURSE", subdomain: SUBDOMAIN },
    })

    const data = {
      tenantId: tenant.id,
      provider: "GETCOURSE" as const,
      subdomain: SUBDOMAIN,
      gcCookie: encrypt(cookie),
      gcCookieAt: new Date(),
      isActive: true,
    }

    if (existing) {
      await prisma.crmConfig.update({ where: { id: existing.id }, data })
      console.log(`  CrmConfig UPDATED: ${TENANT_NAME}/${SUBDOMAIN} (${existing.id})`)
    } else {
      const created = await prisma.crmConfig.create({ data })
      console.log(`  CrmConfig CREATED: ${TENANT_NAME}/${SUBDOMAIN} (${created.id})`)
    }
    console.log("Done. Now run smoke-getcourse-sync.ts for this tenant.")
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
