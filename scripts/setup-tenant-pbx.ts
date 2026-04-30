/**
 * setup-tenant-pbx.ts — one-time loader that writes encrypted PBX credentials
 * into Tenant.pbxConfig.
 *
 * Usage:
 *   tsx scripts/setup-tenant-pbx.ts diva-school ONPBX \
 *     --domain pbx1720.onpbx.ru \
 *     --keyId 1f30cb39... \
 *     --key 2eb46f02...
 *
 * Idempotent: re-running rotates credentials. Encryption uses ENCRYPTION_KEY env.
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { encrypt } from "../src/lib/crypto"

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (hit) return hit.slice(name.length + 3)
  const idx = process.argv.indexOf(`--${name}`)
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1]
  return undefined
}

async function main() {
  const tenantName = process.argv[2]
  const provider = process.argv[3]
  if (!tenantName || !provider) {
    console.error("Usage: setup-tenant-pbx.ts <tenantName> <provider> [--domain ...] [--keyId ...] [--key ...]")
    process.exit(1)
  }

  const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter: adapterPg })

  const tenant = await db.tenant.findFirst({ where: { name: tenantName } })
  if (!tenant) { console.error(`Tenant not found: ${tenantName}`); process.exit(2) }

  let pbxConfig: Record<string, string>
  if (provider === "ONPBX") {
    const domain = arg("domain")
    const keyId = arg("keyId")
    const key = arg("key")
    if (!domain || !keyId || !key) {
      console.error("ONPBX requires --domain --keyId --key")
      process.exit(3)
    }
    pbxConfig = {
      provider: "ONPBX",
      domain,
      keyId: encrypt(keyId),
      key: encrypt(key),
    }
  } else {
    console.error(`provider ${provider} not implemented`)
    process.exit(4)
  }

  await db.$executeRawUnsafe(
    `UPDATE "Tenant" SET "pbxProvider" = $1, "pbxConfig" = $2::jsonb WHERE id = $3`,
    provider,
    JSON.stringify(pbxConfig),
    tenant.id
  )

  console.log(`✓ ${tenantName}: pbxProvider=${provider} pbxConfig set (encrypted)`)
  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
