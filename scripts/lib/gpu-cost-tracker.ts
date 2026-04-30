/**
 * gpu-cost-tracker.ts — daily Intelion spend cap (canon-gpu-cost-cap).
 *
 * Why: watchdog without cost cap can rack up $50-100/night on bug-loop.
 * Why per-tenant: each tenant has its own cap (Tenant.dailyGpuCapUsd).
 *
 * `getTodaySpendUsd` sums GpuRun.actualCost (or estimate from runtime if still running)
 * since 00:00 МСК. `assertUnderCap` throws if a new pod would push past cap.
 */
import type { PrismaClient } from "../../src/generated/prisma/client"

const MSK_OFFSET_HOURS = 3 // Europe/Moscow (no DST since 2014)

function startOfMskDay(d = new Date()): Date {
  const utcMs = d.getTime()
  const mskMidnight = new Date(utcMs - (utcMs % 86_400_000) - MSK_OFFSET_HOURS * 3_600_000)
  // If we crossed midnight already in MSK, walk back one day
  if (mskMidnight.getTime() > utcMs) mskMidnight.setUTCDate(mskMidnight.getUTCDate() - 1)
  return mskMidnight
}

export async function getTodaySpendUsd(
  db: PrismaClient,
  tenantId: string
): Promise<number> {
  const since = startOfMskDay()
  const runs = await db.gpuRun.findMany({
    where: { tenantId, startedAt: { gte: since } },
    select: { startedAt: true, stoppedAt: true, ratePerHour: true, actualCost: true, outcome: true },
  })
  let total = 0
  const now = Date.now()
  for (const r of runs) {
    if (r.actualCost != null) {
      total += r.actualCost
      continue
    }
    const started = r.startedAt.getTime()
    const stopped = r.stoppedAt ? r.stoppedAt.getTime() : now
    const hours = Math.max(0, (stopped - started) / 3_600_000)
    total += hours * r.ratePerHour
  }
  return total
}

export async function assertUnderCap(
  db: PrismaClient,
  tenantId: string,
  capUsd: number
): Promise<{ ok: true; spentUsd: number } | { ok: false; spentUsd: number; capUsd: number }> {
  const spent = await getTodaySpendUsd(db, tenantId)
  if (spent >= capUsd) return { ok: false, spentUsd: spent, capUsd }
  return { ok: true, spentUsd: spent }
}
