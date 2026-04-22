/**
 * Onboard new amoCRM tenant: coral-chelyabinsk (Coral Travel Челябинск).
 * Template copy from create-shumoff.ts — fill CRED placeholders when client sends creds.
 *
 * ── FILL THESE BEFORE RUN ───────────────────────────────────────────
 */
const SUBDOMAIN = ""       // e.g. "ctravel" — то что в URL amoCRM до .amocrm.ru
const CLIENT_ID = ""       // UUID из "Интеграции" в amoCRM
const CLIENT_SECRET = ""   // длинный токен из той же вкладки
const AUTH_CODE = ""       // одноразовый код (действует 20 минут!) — НЕ refresh_token
const REDIRECT_URI = "https://app.salezguru.ru/api/auth/amocrm/callback"
// ────────────────────────────────────────────────────────────────────

import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { encrypt } from "../src/lib/crypto"
import bcrypt from "bcryptjs"

const TENANT_NAME = "coral-chelyabinsk"
const EMAIL = "kirill+coral@smart-analyze.ru"
const PASSWORD = "demo123"

async function exchangeAuthCode(
  subdomain: string,
  clientId: string,
  clientSecret: string,
  authCode: string,
  redirectUri: string
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const res = await fetch(`https://${subdomain}.amocrm.ru/oauth2/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code: authCode,
      redirect_uri: redirectUri,
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OAuth exchange failed: ${res.status} ${text}`)
  }
  return res.json() as Promise<{
    access_token: string
    refresh_token: string
    expires_in: number
  }>
}

async function main() {
  if (!SUBDOMAIN || !CLIENT_ID || !CLIENT_SECRET || !AUTH_CODE) {
    console.error("❌ Fill SUBDOMAIN/CLIENT_ID/CLIENT_SECRET/AUTH_CODE at top of script")
    process.exit(1)
  }

  console.log(`→ Exchange auth code for refresh_token on ${SUBDOMAIN}.amocrm.ru`)
  const tokens = await exchangeAuthCode(
    SUBDOMAIN,
    CLIENT_ID,
    CLIENT_SECRET,
    AUTH_CODE,
    REDIRECT_URI
  )
  console.log(`  refresh_token: ${tokens.refresh_token.substring(0, 40)}… (length=${tokens.refresh_token.length})`)
  console.log(`  access_token expires in: ${tokens.expires_in}s`)

  const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter: adapterPg })

  // 1) Tenant
  let tenant = await db.tenant.findFirst({ where: { name: TENANT_NAME } })
  if (!tenant) {
    tenant = await db.tenant.create({ data: { name: TENANT_NAME } })
  }
  console.log(`Tenant: ${tenant.id} (${tenant.name})`)

  // 2) User
  const hash = await bcrypt.hash(PASSWORD, 10)
  const user = await db.user.upsert({
    where: { email: EMAIL },
    create: {
      email: EMAIL,
      name: "Coral Travel Челябинск",
      password: hash,
      tenantId: tenant.id,
      role: "OWNER",
    },
    update: { tenantId: tenant.id, password: hash },
  })
  console.log(`User: ${user.id} (${user.email})`)

  // 3) CrmConfig
  const expires = new Date(Date.now() + 3 * 30 * 24 * 3600 * 1000) // ~3 months
  const existing = await db.crmConfig.findFirst({
    where: { tenantId: tenant.id, provider: "AMOCRM" },
  })
  const cfgData = {
    tenantId: tenant.id,
    provider: "AMOCRM" as const,
    subdomain: SUBDOMAIN,
    clientId: CLIENT_ID,
    clientSecret: encrypt(CLIENT_SECRET),
    refreshToken: encrypt(tokens.refresh_token),
    tokenExpiresAt: expires,
    redirectUri: REDIRECT_URI,
    isActive: true,
  }
  const cfg = existing
    ? await db.crmConfig.update({ where: { id: existing.id }, data: cfgData })
    : await db.crmConfig.create({ data: cfgData })
  console.log(`CrmConfig: ${cfg.id} subdomain=${cfg.subdomain}`)

  console.log(
    `\n✅ Tenant ready.\n` +
      `  Login: ${EMAIL} / ${PASSWORD}\n` +
      `  Tenant.id: ${tenant.id}\n` +
      `  amoCRM subdomain: ${SUBDOMAIN}.amocrm.ru\n\n` +
      `Next: run initial sync — scripts/smoke-amocrm-refresh.ts or sync-engine for this tenant.`
  )
  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
