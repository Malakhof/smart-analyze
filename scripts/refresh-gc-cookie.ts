/**
 * Refresh GetCourse cookie via Playwright login + write encrypted to CrmConfig.
 *
 * Creds via env:
 *   GC_DIVA_EMAIL    = "malakhoff@gmail.com"
 *   GC_DIVA_PASSWORD = "<password>"
 *
 * Run on server (Playwright needs Chromium in container):
 *   docker run --rm --network smart-analyze_default \
 *     -v /root/smart-analyze:/app -w /app \
 *     -e GC_DIVA_EMAIL='...' -e GC_DIVA_PASSWORD='...' \
 *     mcr.microsoft.com/playwright:v1.49.0-jammy \
 *     sh -c 'set -a && . /app/.env && set +a && ./node_modules/.bin/tsx scripts/refresh-gc-cookie.ts diva-school'
 *
 * Idempotent: re-running just refreshes the stored cookie.
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { encrypt } from "../src/lib/crypto"
import { getGcSession } from "../src/lib/crm/getcourse-session"

const tenantName = process.argv[2]
if (!tenantName) {
  console.error("Usage: tsx scripts/refresh-gc-cookie.ts <tenantName>")
  process.exit(1)
}

const ACCOUNT_URL = process.env.GC_ACCOUNT_URL ?? "https://web.diva.school"
const email = process.env.GC_DIVA_EMAIL
const password = process.env.GC_DIVA_PASSWORD

if (!email || !password) {
  console.error("Missing env: GC_DIVA_EMAIL / GC_DIVA_PASSWORD")
  process.exit(1)
}
if (!process.env.DATABASE_URL || !process.env.ENCRYPTION_KEY) {
  console.error("Missing env: DATABASE_URL / ENCRYPTION_KEY")
  process.exit(1)
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log(`[refresh-gc-cookie] tenant=${tenantName} accountUrl=${ACCOUNT_URL}`)

  console.log("  → Playwright login...")
  const started = Date.now()
  const session = await getGcSession(ACCOUNT_URL, email!, password!)
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`  ✓ login OK in ${elapsed}s`)
  console.log(`    cookie length: ${session.cookie.length} chars`)
  // Verify expected GC session cookies present
  const hasPhpSession = /PHPSESSID5=/.test(session.cookie)
  console.log(`    has PHPSESSID5: ${hasPhpSession}`)
  if (!hasPhpSession) {
    throw new Error("Login succeeded but no PHPSESSID5 cookie returned")
  }

  const tenant = await prisma.tenant.findFirstOrThrow({
    where: { name: tenantName },
  })
  const cfg = await prisma.crmConfig.findFirstOrThrow({
    where: { tenantId: tenant.id, provider: "GETCOURSE" },
  })

  await prisma.crmConfig.update({
    where: { id: cfg.id },
    data: {
      gcCookie: encrypt(session.cookie),
      gcCookieAt: new Date(),
    },
  })
  console.log(`  ✓ cookie stored encrypted in CrmConfig ${cfg.id}`)
}

main()
  .catch((e) => { console.error("FAILED:", e); process.exit(1) })
  .finally(() => prisma.$disconnect())
