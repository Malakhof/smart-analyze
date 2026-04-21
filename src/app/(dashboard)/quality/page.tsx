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
  const [dashboard, filters, charts, graphs, recent] = await Promise.all([
    getQualityDashboard(tenantId, "live"),
    getQcFilterOptions(tenantId),
    getQcChartData(tenantId, "live"),
    getQcGraphData(tenantId, "live"),
    getRecentCallsEnhanced(tenantId, 20, "live"),
  ])

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-text-primary">
            Контроль качества
          </h1>
          <p className="mt-1 text-[13px] text-text-tertiary">
            Только звонки с расшифровкой за последние 7 дней —{" "}
            {dashboard.totalCalls} {callsWord(dashboard.totalCalls)}{" "}
            проанализировано
          </p>
        </div>
        <AiBadge text="AI оценка" />
      </header>

      {dashboard.totalCalls === 0 ? (
        <div className="rounded-md border border-border-default p-8 text-center text-text-tertiary">
          <div className="text-[14px]">Звонки ещё не проанализированы</div>
          <div className="mt-1 text-[12px]">
            После транскрипции и AI-оценки звонков здесь появятся: соответствие
            скрипту, рейтинг менеджеров, проблемы и сильные стороны.
          </div>
        </div>
      ) : (
        <>
          <QcSummary
            totalCalls={charts.totalCalls}
            totalCallsChange={charts.totalCallsChange}
            avgScore={charts.avgScore}
            avgScoreChange={charts.avgScoreChange}
            bestManager={charts.bestManager}
            worstManager={charts.worstManager}
          />

          <QcFilters
            categories={filters.categories}
            tags={filters.tags}
            managers={filters.managers}
            scriptItems={filters.scriptItems}
          />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <QcDonutCharts
              categoryBreakdown={charts.categoryBreakdown}
              tagBreakdown={charts.tagBreakdown}
            />
            <QcScoreDistribution data={graphs.scoreDistribution} />
          </div>

          <QcComplianceChart data={graphs.complianceByStep} />

          <QcManagerTable managers={dashboard.managers} />

          <QcRecentCalls calls={recent} />
        </>
      )}
    </div>
  )
}

function callsWord(n: number): string {
  const lastTwo = n % 100
  const lastOne = n % 10
  if (lastTwo >= 11 && lastTwo <= 14) return "звонков"
  if (lastOne === 1) return "звонок"
  if (lastOne >= 2 && lastOne <= 4) return "звонка"
  return "звонков"
}
