import { requireTenantId } from "@/lib/auth"
export const dynamic = "force-dynamic"

import { Suspense } from "react"
import {
  getDashboardStats,
  getFunnelData,
  getManagerRanking,
  getInsights,
  getDailyConversion,
} from "@/lib/queries/dashboard"
import { PeriodFilter } from "./_components/period-filter"
import { FunnelChart } from "./_components/funnel-chart"
import { SuccessFailCards } from "./_components/success-fail-cards"
import { RevenuePotential } from "./_components/revenue-potential"
import { KeyMetrics } from "./_components/key-metrics"
import { ConversionChart } from "./_components/conversion-chart"
import { ManagerRatingTable } from "./_components/manager-rating-table"
import { AiInsights } from "./_components/ai-insights"

export default async function DashboardPage() {
  const tenantId = await requireTenantId()

  const [stats, funnel, managers, insights, daily] = await Promise.all([
    getDashboardStats(tenantId),
    getFunnelData(tenantId),
    getManagerRanking(tenantId),
    getInsights(tenantId),
    getDailyConversion(tenantId),
  ])

  return (
    <div className="space-y-6 p-6">
      <PeriodFilter totalDeals={stats.totalDeals} />

      <Suspense>
        <KeyMetrics
          totalDeals={stats.totalDeals}
          conversionRate={stats.conversionRate}
          avgCheck={stats.avgCheck}
          avgTime={stats.avgTime}
        />
      </Suspense>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Suspense>
          <SuccessFailCards
            wonCount={stats.wonCount}
            lostCount={stats.lostCount}
            wonAmount={stats.wonAmount}
            lostAmount={stats.lostAmount}
          />
        </Suspense>

        <Suspense>
          <RevenuePotential
            totalPotential={stats.totalPotential}
            wonAmount={stats.wonAmount}
            lostAmount={stats.lostAmount}
            lossPercent={stats.lossPercent}
          />
        </Suspense>
      </div>

      <Suspense>
        <FunnelChart stages={funnel} />
      </Suspense>

      <Suspense>
        <ConversionChart data={daily} />
      </Suspense>

      <Suspense>
        <ManagerRatingTable managers={managers} />
      </Suspense>

      <Suspense>
        <AiInsights insights={insights} />
      </Suspense>
    </div>
  )
}
