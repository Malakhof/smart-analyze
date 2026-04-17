/**
 * E2E smoke-test: run full sync pipeline for a tenant.
 * Fetches CrmConfig for the tenant, calls the sync engine, prints progress and final stats.
 *
 * Run:
 *   docker run --rm --network smart-analyze_default \
 *     -v /root/smart-analyze:/app -w /app node:22-slim \
 *     sh -c "set -a && . /app/.env && set +a && ./node_modules/.bin/tsx scripts/smoke-sync.ts <tenantName>"
 */
// tsx Node resolver can't do directory imports from "../src/generated/prisma"; use explicit /client.
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
// Exported as syncFromCrm(tenantId, crmConfigId, onProgress?) -> Promise<SyncResult>.
// sync-engine.ts uses "@/lib/db" and other @/ aliases — tsx v4 resolves tsconfig paths natively.
import { syncFromCrm } from "../src/lib/sync/sync-engine"

const tenantName = process.argv[2]
if (!tenantName) {
  console.error("Usage: tsx scripts/smoke-sync.ts <tenantName>")
  process.exit(1)
}

if (!process.env.DATABASE_URL) {
  console.error("Missing env: DATABASE_URL")
  process.exit(1)
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  const tenant = await prisma.tenant.findFirstOrThrow({ where: { name: tenantName } })
  const cfg = await prisma.crmConfig.findFirstOrThrow({
    where: { tenantId: tenant.id, provider: "AMOCRM" },
  })

  console.log(`Syncing ${tenantName} (tenantId=${tenant.id}, crmConfigId=${cfg.id})...`)
  const started = Date.now()
  const result = await syncFromCrm(tenant.id, cfg.id, (p) => console.log(JSON.stringify(p)))
  const elapsedSec = ((Date.now() - started) / 1000).toFixed(1)
  console.log("Result:", result)
  console.log(`Elapsed: ${elapsedSec}s`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
