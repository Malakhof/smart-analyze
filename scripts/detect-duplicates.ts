/**
 * Detect potential duplicates in CRM data WITHOUT modifying anything.
 * Outputs counts per tenant + writes summary JSON to whisper-runs/duplicates.json
 *
 * Usage on server:
 *   docker run --rm --network smart-analyze_default -v /root/smart-analyze:/app -w /app \
 *     node:22-slim sh -c 'set -a && . /app/.env && set +a && \
 *       ./node_modules/.bin/tsx scripts/detect-duplicates.ts'
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { writeFileSync } from "node:fs"

interface TenantDuplicateReport {
  tenant: string
  callDuplicates: { audioUrl: string; count: number }[]
  callDuplicateCount: number
  messageDuplicateGroups: number
  messageDuplicateRows: number
  dealDuplicateCandidates: number
}

async function main() {
  const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter: adapterPg })

  const tenants = await db.tenant.findMany({ orderBy: { name: "asc" } })
  const reports: TenantDuplicateReport[] = []

  for (const t of tenants) {
    console.log(`\n=== ${t.name} ===`)

    // 1. Call duplicates: same audioUrl
    const callDups = await db.$queryRawUnsafe<
      { audioUrl: string; count: bigint }[]
    >(
      `SELECT "audioUrl", count(*) as count FROM "CallRecord"
       WHERE "tenantId" = $1 AND "audioUrl" IS NOT NULL
       GROUP BY "audioUrl" HAVING count(*) > 1
       ORDER BY count DESC LIMIT 50`,
      t.id
    )
    const callDupCount = callDups.reduce(
      (sum, c) => sum + Number(c.count) - 1,
      0
    )
    console.log(`  📞 Call dups: ${callDups.length} groups, ${callDupCount} extra rows`)

    // 2. Message duplicates: same content + sender + dealId within 10 sec
    const msgDups = await db.$queryRawUnsafe<
      { content: string; cnt: bigint }[]
    >(
      `SELECT content, count(*) as cnt FROM "Message"
       WHERE "tenantId" = $1
         AND content IS NOT NULL
         AND length(content) > 10
         AND "dealId" IS NOT NULL
       GROUP BY content, sender, "dealId"
       HAVING count(*) > 1
       LIMIT 100`,
      t.id
    )
    const msgDupRows = msgDups.reduce((s, m) => s + Number(m.cnt) - 1, 0)
    console.log(`  💬 Message dups: ${msgDups.length} groups, ${msgDupRows} extra rows`)

    // 3. Deal duplicates: heuristic — same managerId + close createdAt window
    //    (no clientPhone in Deal so we use Contact via Deal — skip for now if no contact link)
    const dealDups = await db.$queryRawUnsafe<{ cnt: bigint }[]>(
      `WITH paired AS (
         SELECT d1.id as id1, d2.id as id2
         FROM "Deal" d1
         JOIN "Deal" d2 ON d1."tenantId" = d2."tenantId"
           AND d1."managerId" = d2."managerId"
           AND d1.id < d2.id
           AND abs(extract(epoch from (d1."createdAt" - d2."createdAt"))) < 86400 * 7
           AND lower(trim(d1.title)) = lower(trim(d2.title))
         WHERE d1."tenantId" = $1 AND d1."managerId" IS NOT NULL
       )
       SELECT count(*) as cnt FROM paired`,
      t.id
    )
    const dealDupCount = Number(dealDups[0]?.cnt ?? 0n)
    console.log(`  💼 Deal dup pairs (same title+manager+7d): ${dealDupCount}`)

    reports.push({
      tenant: t.name,
      callDuplicates: callDups.slice(0, 5).map((c) => ({
        audioUrl: c.audioUrl,
        count: Number(c.count),
      })),
      callDuplicateCount: callDupCount,
      messageDuplicateGroups: msgDups.length,
      messageDuplicateRows: msgDupRows,
      dealDuplicateCandidates: dealDupCount,
    })
  }

  console.log(`\n=== SUMMARY ===`)
  console.table(
    reports.map((r) => ({
      tenant: r.tenant,
      callDups: r.callDuplicateCount,
      msgDups: r.messageDuplicateRows,
      dealDups: r.dealDuplicateCandidates,
    }))
  )

  const out = "/app/whisper-runs/duplicates.json"
  writeFileSync(out, JSON.stringify(reports, null, 2))
  console.log(`Saved: ${out}`)

  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
