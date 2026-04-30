/**
 * stage11-last-sync.ts — bump LastSync watermark.
 * Only called after Stage 9 succeeds; otherwise next cycle re-pulls the same window.
 */
import type { PrismaClient } from "../../src/generated/prisma/client"

export async function updateLastSync(
  db: PrismaClient,
  tenantId: string,
  provider: string,
  lastTimestamp: Date,
  lastUuid: string | null = null,
  lastError: string | null = null
) {
  await db.$executeRawUnsafe(
    `INSERT INTO "LastSync" ("id","tenantId","provider","lastTimestamp","lastUuid","lastError","updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, NOW())
     ON CONFLICT ("tenantId","provider")
     DO UPDATE SET "lastTimestamp" = $3, "lastUuid" = $4, "lastError" = $5, "updatedAt" = NOW()`,
    tenantId, provider, lastTimestamp, lastUuid, lastError
  )
}

export async function getLastSync(
  db: PrismaClient,
  tenantId: string,
  provider: string
): Promise<{ lastTimestamp: Date; lastUuid: string | null } | null> {
  const rows = await db.$queryRawUnsafe<{ lastTimestamp: Date; lastUuid: string | null }[]>(
    `SELECT "lastTimestamp", "lastUuid" FROM "LastSync" WHERE "tenantId" = $1 AND "provider" = $2`,
    tenantId, provider
  )
  return rows[0] ?? null
}
