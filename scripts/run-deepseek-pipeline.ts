/**
 * DeepSeek analysis pipeline orchestrator for SalesGuru clients.
 *
 * For each tenant (or one specific tenant):
 *   1. Pick top-N closed deals (sorted by amount desc) with messages OR transcripts
 *   2. Per-deal analysis (DealAnalysis upserted with summary, factors, key quotes, etc.)
 *   3. Cross-deal pattern mining (Pattern + Insight rows for dashboard)
 *
 * Usage on server:
 *   docker run --rm --network smart-analyze_default -v /root/smart-analyze:/app -w /app \
 *     node:22-slim sh -c 'set -a && . /app/.env && set +a && \
 *       ./node_modules/.bin/tsx scripts/run-deepseek-pipeline.ts <tenantName|all> [limit]'
 *
 * Examples:
 *   ... scripts/run-deepseek-pipeline.ts reklamalift74 50
 *   ... scripts/run-deepseek-pipeline.ts all 30
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { analyzeDeals } from "../src/lib/ai/analyze-deal"
import { extractPatterns } from "../src/lib/ai/extract-patterns"

const target = process.argv[2]
const limit = Number(process.argv[3] ?? 50)

if (!target) {
  console.error(
    "Usage: run-deepseek-pipeline.ts <tenantName|all> [limit-per-tenant]"
  )
  process.exit(1)
}

async function main() {
  const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter: adapterPg })

  const tenants =
    target === "all"
      ? await db.tenant.findMany({ orderBy: { name: "asc" } })
      : await db.tenant.findMany({ where: { name: target } })

  if (tenants.length === 0) {
    console.error(`No tenants found for: ${target}`)
    process.exit(2)
  }

  const startedAt = Date.now()
  const reports: {
    tenant: string
    analyzed: number
    skipped: number
    failed: number
    patterns: number
  }[] = []

  for (const tenant of tenants) {
    console.log(`\n=== Tenant: ${tenant.name} (limit=${limit}) ===`)

    const t0 = Date.now()
    const dealResult = await analyzeDeals(tenant.id, {
      closedOnly: true,
      limit,
      skipAnalyzed: true,
    })
    console.log(
      `[deals] ok=${dealResult.analyzed} skip=${dealResult.skipped} fail=${dealResult.failed} (${((Date.now() - t0) / 1000).toFixed(0)}s)`
    )

    let patterns = 0
    try {
      patterns = await extractPatterns(tenant.id)
      console.log(`[patterns] extracted ${patterns} patterns`)
    } catch (e) {
      console.error(`[patterns] failed:`, (e as Error).message)
    }

    reports.push({
      tenant: tenant.name,
      analyzed: dealResult.analyzed,
      skipped: dealResult.skipped,
      failed: dealResult.failed,
      patterns,
    })
  }

  console.log(`\n=== SUMMARY (elapsed ${((Date.now() - startedAt) / 1000 / 60).toFixed(1)} min) ===`)
  console.table(reports)

  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
