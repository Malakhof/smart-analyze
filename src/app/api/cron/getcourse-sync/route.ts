/**
 * Cron-triggered GetCourse delta sync.
 *
 * Iterates all active CrmConfig records with provider=GETCOURSE and runs
 * a small sync for each (last 1 day, capped at 100 deal pages + 100 contact pages).
 *
 * Authentication: requires either header `x-cron-secret: <CRON_SECRET>` or
 * Authorization: Bearer <CRON_SECRET>. Returns 401 if mismatch.
 *
 * Designed for invocation from server cron (curl) every 4 hours.
 */
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { syncGetCourseTenant } from "@/lib/sync/gc-sync-v2"

export const runtime = "nodejs"
export const maxDuration = 600 // up to 10 minutes per cron tick

interface PerTenantResult {
  tenantId: string
  tenantName: string
  crmConfigId: string
  ok: boolean
  dealsWritten?: number
  callsWritten?: number
  managersWritten?: number
  durationSec?: number
  error?: string
}

export async function POST(request: Request) {
  // ---- Auth ----
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured on server" },
      { status: 500 }
    )
  }

  const headerSecret =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")

  if (!headerSecret || headerSecret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // ---- Iterate active GetCourse configs ----
  const configs = await db.crmConfig.findMany({
    where: { provider: "GETCOURSE", isActive: true },
    include: { tenant: true },
  })

  if (configs.length === 0) {
    return NextResponse.json({
      ranAt: new Date().toISOString(),
      message: "No active GetCourse configs",
      results: [],
    })
  }

  const results: PerTenantResult[] = []
  const startedAll = Date.now()

  for (const cfg of configs) {
    const startedOne = Date.now()
    try {
      const report = await syncGetCourseTenant(cfg.tenantId, {
        daysBack: 1,            // delta — only last day for cron
        maxDealPages: 100,      // ~3000 deals max per tick
        maxContactPages: 100,
        rateLimitMs: 200,
      })
      results.push({
        tenantId: cfg.tenantId,
        tenantName: cfg.tenant.name,
        crmConfigId: cfg.id,
        ok: true,
        dealsWritten:
          report.written.deals.created + report.written.deals.updated,
        callsWritten:
          report.written.callRecords.created +
          report.written.callRecords.updated,
        managersWritten:
          report.written.managers.created + report.written.managers.updated,
        durationSec: Math.round((Date.now() - startedOne) / 1000),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      results.push({
        tenantId: cfg.tenantId,
        tenantName: cfg.tenant.name,
        crmConfigId: cfg.id,
        ok: false,
        error: message,
        durationSec: Math.round((Date.now() - startedOne) / 1000),
      })
      console.error(
        `[CRON_GC] sync failed for ${cfg.tenant.name} (${cfg.id}):`,
        message
      )
    }
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    totalDurationSec: Math.round((Date.now() - startedAll) / 1000),
    tenantCount: configs.length,
    results,
  })
}

// Optional: support GET for health-check & manual trigger via browser tab
export async function GET(request: Request) {
  return POST(request)
}
