/**
 * E2E smoke-test: run full sync pipeline for a tenant.
 * Fetches CrmConfig for the tenant, calls the sync engine, prints progress and final stats.
 *
 * Run:
 *   docker run --rm --network smart-analyze_default \
 *     -v /root/smart-analyze:/app -w /app node:22-slim \
 *     sh -c "set -a && . /app/.env && set +a && \
 *            ./node_modules/.bin/tsx scripts/smoke-sync.ts <tenantName> \
 *              [--pipelines=id1,id2] [--days=90]"
 *
 * Examples:
 *   tsx scripts/smoke-sync.ts reklamalift74
 *   tsx scripts/smoke-sync.ts reklamalift74 --pipelines=1916449,1923097 --days=90
 */
// tsx Node resolver can't do directory imports from "../src/generated/prisma"; use explicit /client.
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
// Exported as syncFromCrm(tenantId, crmConfigId, onProgress?, options?) -> Promise<SyncResult>.
// sync-engine.ts uses "@/lib/db" and other @/ aliases — tsx v4 resolves tsconfig paths natively.
import { syncFromCrm } from "../src/lib/sync/sync-engine"

const args = process.argv.slice(2)
const tenantName = args.find((a) => !a.startsWith("--"))
if (!tenantName) {
  console.error("Usage: tsx scripts/smoke-sync.ts <tenantName> [--pipelines=id1,id2] [--days=N]")
  process.exit(1)
}

const pipelinesArg = args.find((a) => a.startsWith("--pipelines="))
const daysArg = args.find((a) => a.startsWith("--days="))
const pipelines = pipelinesArg?.split("=")[1].split(",").filter(Boolean)
const sinceDays = daysArg ? Number(daysArg.split("=")[1]) : undefined

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

  console.log(`Syncing ${tenantName} (tenantId=${tenant.id}, crmConfigId=${cfg.id})`)
  if (pipelines) console.log(`  filter pipelines: ${pipelines.join(",")}`)
  if (sinceDays) console.log(`  filter since: ${sinceDays} days`)

  const started = Date.now()
  const result = await syncFromCrm(
    tenant.id,
    cfg.id,
    (p) => console.log(JSON.stringify(p)),
    { pipelines, sinceDays },
  )
  const elapsedSec = ((Date.now() - started) / 1000).toFixed(1)
  console.log("Result:", result)
  console.log(`Elapsed: ${elapsedSec}s`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
