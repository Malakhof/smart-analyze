/**
 * setup-tenant-intelion.ts — store Intelion API token (encrypted) per tenant.
 *
 * Usage:
 *   tsx scripts/setup-tenant-intelion.ts <tenantName> <apiToken> [dailyCapUsd]
 *
 * Idempotent: re-running rotates token. Default cap = 20 USD/day.
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { encrypt } from "../src/lib/crypto"

async function main() {
  const tenantName = process.argv[2]
  const token = process.argv[3]
  const cap = process.argv[4] ? Number(process.argv[4]) : 20.0
  if (!tenantName || !token) {
    console.error("Usage: setup-tenant-intelion.ts <tenantName> <apiToken> [dailyCapUsd]")
    process.exit(1)
  }

  const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter: adapterPg })

  const tenant = await db.tenant.findFirst({ where: { name: tenantName } })
  if (!tenant) { console.error(`Tenant not found: ${tenantName}`); process.exit(2) }

  await db.$executeRawUnsafe(
    `UPDATE "Tenant" SET "intelionToken" = $1, "dailyGpuCapUsd" = $2 WHERE id = $3`,
    encrypt(token),
    cap,
    tenant.id
  )

  console.log(`✓ ${tenantName}: intelionToken stored encrypted, dailyGpuCapUsd=${cap}`)
  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
