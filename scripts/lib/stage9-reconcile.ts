/**
 * stage9-reconcile.ts — 3-way diff PBX vs DB vs CRM (canon #38).
 *
 * For windowed [from..to]:
 *   pbxCount  = how many calls onPBX reports
 *   dbCount   = how many CallRecord rows we have for that window
 *   crmCount  = how many call entries GC contacts grid lists for that window
 *               (nullable when GC unreachable — degrades to 2-way)
 *
 * Writes one ReconciliationCheck row, returns it. Caller decides whether to
 * alert (Stage 10) based on discrepancyPct.
 */
import type { PrismaClient } from "../../src/generated/prisma/client"
import { GetCourseAdapter } from "../../src/lib/crm/getcourse/adapter"
import type { LoadedTenant } from "./load-tenant-pbx"

export interface ReconcileInput {
  db: PrismaClient
  tenant: LoadedTenant
  pbxCount: number
  pbxUuids: string[]
  baseUrl?: string
  cookie?: string
  windowStart: Date
  windowEnd: Date
}

export async function runStage9Reconcile(input: ReconcileInput) {
  const { db, tenant, pbxCount, pbxUuids, baseUrl, cookie, windowStart, windowEnd } = input

  // Local DB count
  const dbRows = await db.callRecord.findMany({
    where: { tenantId: tenant.id, startStamp: { gte: windowStart, lte: windowEnd } },
    select: { pbxUuid: true },
  })
  const dbCount = dbRows.length
  const dbUuids = new Set(dbRows.map((r) => r.pbxUuid).filter(Boolean) as string[])

  const missingInDb = pbxUuids.filter((u) => !dbUuids.has(u))

  // CRM count (best-effort — degrade if cookie missing)
  let crmCount: number | null = null
  if (baseUrl && cookie) {
    try {
      const adapter = new GetCourseAdapter(baseUrl, cookie)
      const total = await adapter.getTotalContactsInRange(windowStart, windowEnd)
      crmCount = total ?? null
    } catch (e) {
      console.warn(`[9] CRM count unavailable: ${(e as Error).message}`)
    }
  }

  // Duplicate check (same pbxUuid count > 1 in window)
  const dupGroups = await db.$queryRawUnsafe<{ pbxUuid: string; n: bigint }[]>(
    `SELECT "pbxUuid", COUNT(*)::bigint AS n FROM "CallRecord"
     WHERE "tenantId" = $1 AND "startStamp" BETWEEN $2 AND $3 AND "pbxUuid" IS NOT NULL
     GROUP BY "pbxUuid" HAVING COUNT(*) > 1`,
    tenant.id, windowStart, windowEnd
  )
  const duplicates = dupGroups.map((g) => ({ pbxUuid: g.pbxUuid, count: Number(g.n) }))

  const discrepancyPct = pbxCount === 0 ? 0 : Math.abs(pbxCount - dbCount) / pbxCount

  const row = await db.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO "ReconciliationCheck"
       ("id","tenantId","windowStart","windowEnd","pbxCount","dbCount","crmCount",
        "missingInDb","missingInCrm","duplicates","discrepancyPct")
     VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10)
     RETURNING id`,
    tenant.id, windowStart, windowEnd,
    pbxCount, dbCount, crmCount,
    JSON.stringify(missingInDb), JSON.stringify([]), JSON.stringify(duplicates),
    discrepancyPct
  )

  console.log(`[9] reconcile pbx=${pbxCount} db=${dbCount} crm=${crmCount ?? "n/a"} ` +
              `discrepancy=${(discrepancyPct * 100).toFixed(2)}% missingInDb=${missingInDb.length} dups=${duplicates.length}`)

  return {
    id: row[0].id,
    pbxCount, dbCount, crmCount,
    discrepancyPct,
    missingInDb, duplicates,
  }
}
