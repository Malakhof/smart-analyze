/**
 * Daily preventive auto-refresh for all active amoCRM CrmConfigs.
 *
 * Why: amoCRM silently revokes refresh_token if it sits unused too long (~3 months),
 * or after redirect_uri mismatches. Fresh call every day keeps the token rotated
 * and prevents surprise failures. Run via cron at 03:00.
 *
 * What it does:
 *   For each active AMOCRM CrmConfig — call getAmoCrmAccessToken (which triggers
 *   refresh if token is near expiry). Success = token rotated. Failure = alert.
 *
 * On failure: log to stderr so cron email/alert picks it up; also persist a flag
 * CrmConfig.lastRefreshError via raw SQL if you want UI to show it (optional).
 *
 * Usage:
 *   tsx scripts/cron-amo-refresh-all.ts
 *   tsx scripts/cron-amo-refresh-all.ts --force  # force refresh even if not near expiry
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { getAmoCrmAccessToken } from "../src/lib/crm/amocrm-oauth"

const FORCE = process.argv.includes("--force")

interface Result {
  tenantName: string
  subdomain: string
  ok: boolean
  error?: string
}

async function main() {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  })

  const configs = await db.crmConfig.findMany({
    where: { provider: "AMOCRM", isActive: true },
    include: { tenant: true },
  })

  console.log(`[${new Date().toISOString()}] auto-refresh: ${configs.length} amoCRM configs`)

  const results: Result[] = []

  for (const cfg of configs) {
    const tenantName = cfg.tenant.name
    const subdomain = cfg.subdomain ?? "—"

    // If FORCE, zero out expiry so refresh is guaranteed; keep tokens.
    if (FORCE) {
      await db.crmConfig.update({
        where: { id: cfg.id },
        data: { tokenExpiresAt: new Date(0) },
      })
    }

    try {
      const token = await getAmoCrmAccessToken(cfg.id)
      const ok = typeof token === "string" && token.length > 100
      results.push({ tenantName, subdomain, ok })
      console.log(`  ✅ ${tenantName.padEnd(25)} ${subdomain.padEnd(20)} OK`)
    } catch (e) {
      const msg = (e as Error).message ?? String(e)
      results.push({ tenantName, subdomain, ok: false, error: msg })
      console.error(`  ❌ ${tenantName.padEnd(25)} ${subdomain.padEnd(20)} FAIL: ${msg}`)
    }
  }

  const failed = results.filter((r) => !r.ok)
  console.log(
    `\n[${new Date().toISOString()}] Summary: ${results.length - failed.length}/${results.length} refreshed OK`
  )

  if (failed.length > 0) {
    console.error(`\n🚨 FAILED (${failed.length}):`)
    for (const r of failed) {
      console.error(`  - ${r.tenantName} (${r.subdomain}): ${r.error}`)
    }
    // Exit 1 → cron sees failure → email/alert
    await db.$disconnect()
    process.exit(1)
  }

  await db.$disconnect()
}

main().catch((e) => {
  console.error("FATAL:", e)
  process.exit(1)
})
