/**
 * worker-claim.ts — atomic batch claim from CallRecord queue.
 *
 * Pattern: SELECT ... FOR UPDATE SKIP LOCKED (canonical Postgres job-queue).
 * Multiple workers may run safely in parallel — each one grabs disjoint
 * rows without conflicts.
 *
 * Two flavours:
 *   claimWhisperBatch   — rows with audioUrl, transcript IS NULL, status=pending
 *   recoverStaleInFlight — rows stuck in_flight > N minutes → reset to pending
 *                          (canon-whisper-resume: pod silent stop / worker crash)
 */
import type { PrismaClient } from "../../src/generated/prisma/client"

export interface ClaimedRow {
  id: string                  // CallRecord.id (cuid)
  pbxUuid: string
  audioUrl: string
  duration: number | null
  managerExt: string | null
}

export async function claimWhisperBatch(
  db: PrismaClient,
  tenantId: string,
  workerId: string,
  batchSize: number,
): Promise<ClaimedRow[]> {
  // Single transaction: select + update under same lock
  const rows = await db.$transaction(async (tx) => {
    const picked = await tx.$queryRawUnsafe<ClaimedRow[]>(
      `SELECT id, "pbxUuid", "audioUrl", duration, "managerExt"
       FROM "CallRecord"
       WHERE "tenantId" = $1
         AND "transcriptionStatus" = 'pending'
         AND "audioUrl" IS NOT NULL
         AND transcript IS NULL
       ORDER BY "startStamp"
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      tenantId, batchSize,
    )
    if (picked.length === 0) return picked
    const ids = picked.map((r) => r.id)
    await tx.$executeRawUnsafe(
      `UPDATE "CallRecord"
       SET "transcriptionStatus" = 'in_flight',
           "transcriptionPodId"  = $1,
           "transcriptionAt"     = NOW()
       WHERE id = ANY($2::text[])`,
      workerId, ids,
    )
    return picked
  })
  return rows
}

/**
 * Second-tier claim — rows that already have a transcript but didn't reach
 * the persist stage successfully (or were created before the persist stage
 * existed). Skips Whisper entirely; only DeepSeek persist needs to run.
 *
 * canon-call-record-states: status='transcribed' is the entry point for this.
 */
export interface PersistOnlyRow {
  id: string
  pbxUuid: string
  transcript: string
  duration: number | null
}

export async function claimPersistOnlyBatch(
  db: PrismaClient,
  tenantId: string,
  workerId: string,
  batchSize: number,
): Promise<PersistOnlyRow[]> {
  const rows = await db.$transaction(async (tx) => {
    const picked = await tx.$queryRawUnsafe<PersistOnlyRow[]>(
      // pbxUuid filter prevents starvation loop (issue #2 from 2026-05-03):
      // persist-pipeline-results.ts matches by pbxUuid, so empty pbxUuid rows
      // get skipped → ok=false → status stays 'transcribed' → re-claimed forever
      // → claim section never reached → GPU never starts. Filter at SQL level.
      `SELECT id, "pbxUuid", transcript, duration
       FROM "CallRecord"
       WHERE "tenantId" = $1
         AND "transcriptionStatus" = 'transcribed'
         AND transcript IS NOT NULL
         AND "pbxUuid" IS NOT NULL AND "pbxUuid" != ''
       ORDER BY "startStamp"
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      tenantId, batchSize,
    )
    if (picked.length === 0) return picked
    const ids = picked.map((r) => r.id)
    // Mark with workerId so stale-recovery can release if we crash.
    await tx.$executeRawUnsafe(
      `UPDATE "CallRecord"
       SET "transcriptionPodId" = $1,
           "transcriptionAt"    = NOW()
       WHERE id = ANY($2::text[])`,
      workerId, ids,
    )
    return picked
  })
  return rows
}

export async function markBatchOutcome(
  db: PrismaClient,
  rowIds: string[],
  outcome: "transcribed" | "failed" | "pipeline_gap",
): Promise<void> {
  if (rowIds.length === 0) return
  await db.$executeRawUnsafe(
    `UPDATE "CallRecord"
     SET "transcriptionStatus" = $1,
         "transcriptionAt"     = NOW(),
         "retryCount"          = CASE WHEN $1 = 'failed' THEN "retryCount" + 1 ELSE "retryCount" END
     WHERE id = ANY($2::text[])`,
    outcome, rowIds,
  )
}

/**
 * Reset rows that have been in_flight too long. Pod silent stop or worker
 * crash leaves rows orphaned — without recovery they stay in_flight forever
 * and never re-process. Canon: feedback-pipeline-canon-with-opus-enrich.md.
 */
export async function recoverStaleInFlight(
  db: PrismaClient,
  tenantId: string,
  staleAfterMs: number = 30 * 60 * 1000,
): Promise<number> {
  const cutoff = new Date(Date.now() - staleAfterMs)
  const reset = await db.$executeRawUnsafe(
    `UPDATE "CallRecord"
     SET "transcriptionStatus" = 'pending',
         "transcriptionPodId"  = NULL,
         "lastSyncError"       = COALESCE("lastSyncError", '') || ' | stale in_flight reset @ ' || NOW()
     WHERE "tenantId" = $1
       AND "transcriptionStatus" = 'in_flight'
       AND "transcriptionAt" < $2`,
    tenantId, cutoff,
  )
  return Number(reset)
}

export async function countPendingForTenant(
  db: PrismaClient,
  tenantId: string,
): Promise<number> {
  const r = await db.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*)::int AS n
     FROM "CallRecord"
     WHERE "tenantId" = $1
       AND "transcriptionStatus" = 'pending'
       AND "audioUrl" IS NOT NULL`,
    tenantId,
  )
  return r[0]?.n ?? 0
}
