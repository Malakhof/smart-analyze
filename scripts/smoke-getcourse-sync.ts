/**
 * E2E smoke-test: run GetCourse sync for a tenant.
 *
 * Run on server (uses our DB):
 *   docker run --rm --network smart-analyze_default \
 *     -v /root/smart-analyze:/app -w /app node:22-slim \
 *     sh -c "set -a && . /app/.env && set +a && \
 *            ./node_modules/.bin/tsx scripts/smoke-getcourse-sync.ts <tenantName> [--days=7] [--dry-run] [--max-pages=2]"
 *
 * Examples:
 *   tsx scripts/smoke-getcourse-sync.ts diva-school --days=7 --dry-run
 *   tsx scripts/smoke-getcourse-sync.ts diva-school --days=7 --max-pages=10
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { syncGetCourseTenant } from "../src/lib/sync/gc-sync-v2"

const args = process.argv.slice(2)
const tenantName = args.find((a) => !a.startsWith("--"))
if (!tenantName) {
  console.error("Usage: tsx scripts/smoke-getcourse-sync.ts <tenantName> [--days=7] [--dry-run] [--max-pages=N] [--per-page=N]")
  process.exit(1)
}

const daysArg = args.find((a) => a.startsWith("--days="))
const maxPagesArg = args.find((a) => a.startsWith("--max-pages="))
const perPageArg = args.find((a) => a.startsWith("--per-page="))
const dryRun = args.includes("--dry-run")

const daysBack = daysArg ? Number(daysArg.split("=")[1]) : 7
const maxPages = maxPagesArg ? Number(maxPagesArg.split("=")[1]) : 5
const perPage = perPageArg ? Number(perPageArg.split("=")[1]) : 100

if (!process.env.DATABASE_URL) {
  console.error("Missing env: DATABASE_URL")
  process.exit(1)
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  const tenant = await prisma.tenant.findFirstOrThrow({
    where: { name: tenantName },
  })

  console.log(`\n=== GetCourse sync for ${tenantName} ===`)
  console.log(`  tenantId:  ${tenant.id}`)
  console.log(`  daysBack:  ${daysBack}`)
  console.log(`  maxPages:  ${maxPages}`)
  console.log(`  perPage:   ${perPage}`)
  console.log(`  dryRun:    ${dryRun}`)
  console.log()

  const started = Date.now()
  const report = await syncGetCourseTenant(tenant.id, {
    daysBack,
    dryRun,
    maxPages,
    perPage,
  })
  const elapsedSec = ((Date.now() - started) / 1000).toFixed(1)

  console.log("\n=== Report ===")
  console.log(JSON.stringify(report, null, 2))
  console.log(`\nElapsed: ${elapsedSec}s`)
}

main()
  .catch((e) => {
    console.error("\nFAILED:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
