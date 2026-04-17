/**
 * Seed production clients (reklamalift74, vastu) into CrmConfig.
 * Reads OAuth creds from process.env, encrypts sensitive fields, creates Tenant + CrmConfig.
 *
 * Run inside the smart-analyze-app container so DATABASE_URL resolves to the in-network Postgres:
 *   docker exec -w /app -it smart-analyze-app npx tsx scripts/seed-clients.ts
 *
 * Idempotent: if a CrmConfig with matching subdomain already exists, it is updated instead of duplicated.
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { encrypt } from "../src/lib/crypto"

type ClientSpec = {
  tenantName: string
  envPrefix: "REKLAMA_AMO" | "VASTU_AMO"
}

const CLIENTS: ClientSpec[] = [
  { tenantName: "reklamalift74", envPrefix: "REKLAMA_AMO" },
  { tenantName: "vastu", envPrefix: "VASTU_AMO" },
]

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v || v.trim() === "") throw new Error(`Missing env: ${name}`)
  return v.trim()
}

async function main() {
  for (const c of CLIENTS) {
    requireEnv(`${c.envPrefix}_SUBDOMAIN`)
    requireEnv(`${c.envPrefix}_CLIENT_ID`)
    requireEnv(`${c.envPrefix}_CLIENT_SECRET`)
    requireEnv(`${c.envPrefix}_REFRESH_TOKEN`)
  }
  requireEnv("ENCRYPTION_KEY")

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
  const prisma = new PrismaClient({ adapter })

  try {
    for (const c of CLIENTS) {
      const subdomain = requireEnv(`${c.envPrefix}_SUBDOMAIN`)
      const clientId = requireEnv(`${c.envPrefix}_CLIENT_ID`)
      const clientSecret = requireEnv(`${c.envPrefix}_CLIENT_SECRET`)
      const refreshToken = requireEnv(`${c.envPrefix}_REFRESH_TOKEN`)

      // 1) Tenant — upsert by name
      let tenant = await prisma.tenant.findFirst({ where: { name: c.tenantName } })
      if (!tenant) {
        tenant = await prisma.tenant.create({
          data: { name: c.tenantName, plan: "DEMO", dealsLimit: 50 },
        })
        console.log(`  Tenant CREATED: ${c.tenantName} (${tenant.id})`)
      } else {
        console.log(`  Tenant exists:  ${c.tenantName} (${tenant.id})`)
      }

      // 2) CrmConfig — upsert by (tenantId, provider=AMOCRM, subdomain)
      const existing = await prisma.crmConfig.findFirst({
        where: { tenantId: tenant.id, provider: "AMOCRM", subdomain },
      })

      const payload = {
        tenantId: tenant.id,
        provider: "AMOCRM" as const,
        subdomain,
        clientId,
        clientSecret: encrypt(clientSecret),
        refreshToken: encrypt(refreshToken),
        apiKey: null,
        tokenExpiresAt: null,
        isActive: true,
      }

      if (existing) {
        await prisma.crmConfig.update({ where: { id: existing.id }, data: payload })
        console.log(`  CrmConfig UPDATED: ${c.tenantName}/${subdomain} (${existing.id})`)
      } else {
        const created = await prisma.crmConfig.create({ data: payload })
        console.log(`  CrmConfig CREATED: ${c.tenantName}/${subdomain} (${created.id})`)
      }
    }
    console.log("Done.")
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
