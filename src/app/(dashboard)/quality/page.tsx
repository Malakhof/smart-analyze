import { requireTenantId } from "@/lib/auth"
export const dynamic = "force-dynamic"

import { AiBadge } from "@/components/ai-badge"
import {
  getQualityDashboard,
  getQcFilterOptions,
  getQcChartData,
  getQcGraphData,
  getRecentCallsEnhanced,
} from "@/lib/queries/quality"
import { QcSummary } from "./_components/qc-summary"
import { QcDonutCharts } from "./_components/qc-donut-charts"
import { QcComplianceChart } from "./_components/qc-compliance-chart"
import { QcScoreDistribution } from "./_components/qc-score-distribution"
import { QcManagerTable } from "./_components/qc-manager-table"
import { QcRecentCalls } from "./_components/qc-recent-calls"
import { QcFilters } from "./_components/qc-filters"

export default async function QualityPage() {
  const tenantId = await requireTenantId()

}

function callsWord(n: number): string {
  const lastTwo = n % 100
  const lastOne = n % 10
  if (lastTwo >= 11 && lastTwo <= 14) return "звонков"
  if (lastOne === 1) return "звонок"
  if (lastOne >= 2 && lastOne <= 4) return "звонка"
  return "звонков"
}
