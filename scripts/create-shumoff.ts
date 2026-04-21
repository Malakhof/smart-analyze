/**
 * Onboard new amoCRM tenant: shumoff174.
 * - Tenant + User (email/password)
 * - CrmConfig (provider=AMOCRM, subdomain, tokens)
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { encrypt } from "../src/lib/crypto"
import bcrypt from "bcryptjs"

const TENANT_NAME = "shumoff174"
const SUBDOMAIN = "Shumoff174"
const EMAIL = "kirill+shumoff@smart-analyze.ru"
const PASSWORD = "demo123"
const CLIENT_ID = "9356c995-d9b2-4df9-b510-bbc7fe8e1d4c"
const CLIENT_SECRET = "e9uLN6YVQ98CEsGx5u4GhcwymVYRMNZv19Lle52DjdtLYSIJbO0OmylxEk5F2aa4"
const REFRESH_TOKEN = "def502002f1125acb1cafa630c2f0ae25f761dfa3488a1f07ee57bbb9c17796e413777d94a11140b33a50adb8fa0ba88eb5e2993c38ce0b411ec8e4ea16a97256ebe4bad7e914057fbe0e7e0837dba6ddc2b51893405e1118b1a7b94e8251280d563491bdc9387b6873e87a3b4d9f85378ce2370a4ff6b4a4831345780f66a26f802582225983eb4e03ad224193addb4bfcf6a6c25c5b6649511376ec5a7495cc175ab81fa7b3a693778c036f584317292aff93bc561a01ed58ed286d0b2ba3d0cafa9b6bf39575b7cbf4b1d30b37fd290fbb80034ae678ea5afdfc770298b34ea180ccdb57d238273a3d79c827b6680e785d4291d089cc4e0e36038c2cac50c1ebf78ca742dcba84831c70b2c3dd3ee373c9d0f0e0d941b639b9aba29bfb1e15b3ba3ac59343597bd907fbe6e48a706625b976c2574e53a1735ceed3410376fdf9f3a2b413f596bf0cd82f13ebf07b901cda2bb3585f4bf9239e58016487805e8a847683238391c4fe3dd4582e36f171c1c58184bf9248916128bbd1a5c8aaac68209fa057ae9bc89e759fd51677df44fd812942c7d460655f04e21bb861d537c37748b7c86490cb81fa77beb49293e16406980b622110e0c8ae23a624920fc8b2ea0c9174e2b6551d3954462b4fb6a3be04d5710d083e4884cf13ffbe7168635b8dec7af025fb50c6d93b452b8"
const REDIRECT_URI = "https://app.salezguru.ru/api/auth/amocrm/callback"

async function main() {
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
      name: "Шумов Кирилл",
      password: hash,
      tenantId: tenant.id,
      role: "OWNER",
    },
    update: { tenantId: tenant.id, password: hash },
  })
  console.log(`User: ${user.id} (${user.email})`)

  // 3) CrmConfig — refreshToken encrypted
  const encRefresh = encrypt(REFRESH_TOKEN)
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
    refreshToken: encRefresh,
    tokenExpiresAt: expires,
    redirectUri: REDIRECT_URI,
    isActive: true,
  }
  const cfg = existing
    ? await db.crmConfig.update({ where: { id: existing.id }, data: cfgData })
    : await db.crmConfig.create({ data: cfgData })
  console.log(`CrmConfig: ${cfg.id} subdomain=${cfg.subdomain}`)

  console.log(`\n✅ Tenant ready. Login: ${EMAIL} / ${PASSWORD}`)
  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
