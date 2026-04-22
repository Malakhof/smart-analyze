/**
 * Re-authenticate existing amoCRM tenant with a fresh authorization code.
 *
 * When to use: client's refresh_token got revoked (e.g. after domain migration,
 * redirect_uri mismatch, or inactivity), they sent a new auth_code from their
 * integration panel. We exchange it → new refresh_token and update the SAME
 * CrmConfig row. Data in DB is preserved.
 *
 * What it does (without creating anything new):
 *   1. Finds existing Tenant + active AMOCRM CrmConfig by tenantName
 *   2. Forces redirectUri to canonical value https://app.salezguru.ru/api/auth/amocrm/callback
 *   3. Exchanges authorization_code → { access_token, refresh_token } on amoCRM
 *   4. Updates apiKey, refreshToken, tokenExpiresAt, redirectUri in the row
 *
 * Usage:
 *   tsx scripts/re-auth-amo.ts <tenantName> <auth_code>
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { decrypt, encrypt } from "../src/lib/crypto"

const CANONICAL_REDIRECT_URI =
  "https://app.salezguru.ru/api/auth/amocrm/callback"

const [tenantName, authCode] = process.argv.slice(2)
if (!tenantName || !authCode) {
  console.error("Usage: re-auth-amo.ts <tenantName> <auth_code>")
  process.exit(1)
}

async function main() {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  })

  const tenant = await db.tenant.findFirst({ where: { name: tenantName } })
  if (!tenant) throw new Error(`Tenant not found: ${tenantName}`)
  const cfg = await db.crmConfig.findFirst({
    where: { tenantId: tenant.id, provider: "AMOCRM", isActive: true },
  })
  if (!cfg) throw new Error(`Active AMOCRM CrmConfig not found for ${tenantName}`)
  if (!cfg.clientId || !cfg.clientSecret || !cfg.subdomain) {
    throw new Error("CrmConfig is missing clientId/clientSecret/subdomain")
  }

  console.log(`Tenant: ${tenantName} (${tenant.id})`)
  console.log(`Current redirectUri in DB: ${cfg.redirectUri ?? "(null)"}`)
  console.log(`Using redirectUri for exchange: ${CANONICAL_REDIRECT_URI}`)

  const clientSecret = decrypt(cfg.clientSecret)
  const tokenUrl = `https://${cfg.subdomain}.amocrm.ru/oauth2/access_token`

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code: authCode,
      redirect_uri: CANONICAL_REDIRECT_URI,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OAuth exchange failed: ${res.status} ${text}`)
  }

  const tokens = (await res.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
  }
  console.log(
    `✅ Exchange OK: access_token len=${tokens.access_token.length}, ` +
      `refresh_token len=${tokens.refresh_token.length}, expires in ${tokens.expires_in}s`
  )

  await db.crmConfig.update({
    where: { id: cfg.id },
    data: {
      apiKey: encrypt(tokens.access_token),
      refreshToken: encrypt(tokens.refresh_token),
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      redirectUri: CANONICAL_REDIRECT_URI,
    },
  })
  console.log(
    `✅ Updated CrmConfig ${cfg.id}: new tokens stored, redirectUri set to canonical`
  )

  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
