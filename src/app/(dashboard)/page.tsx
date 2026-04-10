export const dynamic = "force-dynamic"

import { Suspense } from "react"
import {
  getDashboardStats,
  getFunnelData,
  getManagerRanking,
  getInsights,
  getTenantId,
} from "@/lib/queries/dashboard"
import { PeriodFilter } from "./_components/period-filter"
import { FunnelChart } from "./_components/funnel-chart"
import { SuccessFailCards } from "./_components/success-fail-cards"
import { RevenuePotential } from "./_components/revenue-potential"
import { KeyMetrics } from "./_components/key-metrics"
import { ManagerRatingTable } from "./_components/manager-rating-table"
import { AiInsights } from "./_components/ai-insights"

export default async function DashboardPage() {
  const tenantId = await getTenantId()

  if (!tenantId) {
    return (
      <div className="py-20 text-center text-text-tertiary">
        Нет данных. Запустите seed для заполнения базы данных.
      </div>
    )
  }

  const [stats, funnel, managers, insights] = await Promise.all([
    getDashboardStats(tenantId),
    getFunnelData(tenantId),
    getManagerRanking(tenantId),
    getInsights(tenantId),
  ])

  return (
    <>
      <Suspense fallback={null}>
        <PeriodFilter totalDeals={stats.totalDeals} />
      </Suspense>

      <h2 className="mb-5 text-[24px] font-bold tracking-[-0.04em]">
        Дашборд отдела продаж
      </h2>

      <FunnelChart stages={funnel} />

      <SuccessFailCards
        wonCount={stats.wonCount}
        lostCount={stats.lostCount}
        wonAmount={stats.wonAmount}
        lostAmount={stats.lostAmount}
      />

      <RevenuePotential
        totalPotential={stats.totalPotential}
        wonAmount={stats.wonAmount}
        lostAmount={stats.lostAmount}
        lossPercent={stats.lossPercent}
      />

      <KeyMetrics
        totalDeals={stats.totalDeals}
        conversionRate={stats.conversionRate}
        avgCheck={stats.avgCheck}
        avgTime={stats.avgTime}
      />

      <ManagerRatingTable managers={managers} />

      <AiInsights insights={insights} />
    </>
  )
}
