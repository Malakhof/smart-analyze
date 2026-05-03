/**
 * quality-gc.ts — parallel quality queries for diva (GETCOURSE) tenants.
 *
 * The legacy `quality.ts` reads CallScore relations populated by the Sipuni
 * pipeline. Diva's Master Enrich pipeline writes flat fields directly on
 * CallRecord (scriptScorePct / scriptDetails / phraseCompliance /
 * criticalErrors / nextStepRecommendation), and never creates CallScore rows.
 *
 * These functions return the SAME interface shapes as the legacy queries so
 * `/quality` page can switch by `getCrmProvider(tenantId)` (Task 23) without
 * any consumer changes.
 *
 * Signature note: we mirror the legacy `(tenantId, mode, filters)` triple so
 * the call sites in page.tsx can swap implementations one-for-one. Date window
 * resolution lives inside via `qcCallWhereGc`, identical to legacy `qcCallWhere`.
 */
import { db } from "@/lib/db"
import { liveWindowStart } from "@/lib/queries/active-window"
import type {
  QcChartData,
  QcDashboardData,
  QcFilters,
  QcQueryMode,
  QcRecentCall,
} from "./quality"

// Re-export so consumers can import types from a single module if desired.
export type { QcChartData, QcDashboardData, QcFilters, QcQueryMode, QcRecentCall }

export async function getQualityDashboardGc(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tenantId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  mode: QcQueryMode = "all",
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  filters: QcFilters = {}
): Promise<QcDashboardData> {
  throw new Error("not implemented (Task 20)")
}

export async function getQcChartDataGc(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tenantId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  mode: QcQueryMode = "all",
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  filters: QcFilters = {}
): Promise<QcChartData> {
  throw new Error("not implemented (Task 21)")
}

export async function getQcRecentCallsGc(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tenantId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  mode: QcQueryMode = "all",
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  filters: QcFilters = {}
): Promise<QcRecentCall[]> {
  throw new Error("not implemented (Task 22)")
}
