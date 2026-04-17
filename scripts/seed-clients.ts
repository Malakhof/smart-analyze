/**
 * Seed production clients (reklamalift74, vastu) into CrmConfig.
 * Reads OAuth creds from process.env, encrypts sensitive fields, creates Tenant + CrmConfig.
 *
 * Run inside the smart-analyze-app container so DATABASE_URL resolves to the in-network Postgres:
 *   docker exec -w /app -it smart-analyze-app npx tsx scripts/seed-clients.ts
 *
 * Idempotent: if a CrmConfig with matching subdomain already exists, it is updated instead of duplicated.
 */
// Use explicit `/client` path: tsx's Node resolver does not handle the directory
// import that Next.js-bundled code (`@/generated/prisma`) can, so we point at the
// file directly.
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
  const databaseUrl = requireEnv("DATABASE_URL")

  const adapter = new PrismaPg({ connectionString: databaseUrl })
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
          data: { name: c.tenantName },
        })
        console.log(`  Tenant CREATED: ${c.tenantName} (${tenant.id})`)
      } else {
        console.log(`  Tenant exists:  ${c.tenantName} (${tenant.id})`)
      }

      // 2) CrmConfig — upsert by (tenantId, provider=AMOCRM, subdomain)
      const existing = await prisma.crmConfig.findFirst({
        where: { tenantId: tenant.id, provider: "AMOCRM", subdomain },
      })

      // Split create vs update:
      // - createData: full payload; new rows explicitly start with no access token.
      // - updateData: omits apiKey / tokenExpiresAt so re-running the seed does not
      //   wipe a freshly minted access token that the OAuth refresh flow populated.
      const updateData = {
        tenantId: tenant.id,
        provider: "AMOCRM" as const,
        subdomain,
        clientId,
        clientSecret: encrypt(clientSecret),
        refreshToken: encrypt(refreshToken),
        isActive: true,
      }
      const createData = {
        ...updateData,
        apiKey: null,
        tokenExpiresAt: null,
      }

      if (existing) {
        await prisma.crmConfig.update({ where: { id: existing.id }, data: updateData })
        console.log(`  CrmConfig UPDATED: ${c.tenantName}/${subdomain} (${existing.id})`)
      } else {
        const created = await prisma.crmConfig.create({ data: createData })
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
