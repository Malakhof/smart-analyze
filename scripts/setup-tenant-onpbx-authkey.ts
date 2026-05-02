/**
 * setup-tenant-onpbx-authkey.ts — one-shot: encrypt and stash the permanent
 * onPBX auth_key into Tenant.pbxConfig.authKey alongside the derived KEY_ID:KEY.
 *
 * Permanent auth_key is what the customer (e.g. Tanya for diva) provides once.
 * From it we derive KEY_ID:KEY via POST /auth.json — those expire ~7-9 days.
 *
 * Usage:
 *   tsx scripts/setup-tenant-onpbx-authkey.ts <tenantName> <auth_key>
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { encrypt } from "../src/lib/crypto"

async function main() {
  const tenantName = process.argv[2]
  const authKey = process.argv[3]
  if (!tenantName || !authKey) {
    console.error("Usage: setup-tenant-onpbx-authkey.ts <tenantName> <auth_key>")
    process.exit(1)
  }
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter })
  const rows = await db.$queryRawUnsafe<{ pbxConfig: Record<string, string> }[]>(
    `SELECT "pbxConfig" FROM "Tenant" WHERE name = $1`, tenantName,
  )
  if (rows.length === 0) { console.error(`Tenant not found: ${tenantName}`); process.exit(2) }
  const cfg = rows[0].pbxConfig ?? {}
  cfg.authKey = encrypt(authKey)
  await db.$executeRawUnsafe(
    `UPDATE "Tenant" SET "pbxConfig" = $1::jsonb WHERE name = $2`,
    JSON.stringify(cfg), tenantName,
  )
  console.log(`✓ ${tenantName}: pbxConfig.authKey set (encrypted), keys: ${Object.keys(cfg).join(",")}`)
  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
