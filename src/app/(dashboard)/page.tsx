import { requireTenantId } from "@/lib/auth"
export const dynamic = "force-dynamic"

import { Suspense } from "react"
import {
  getDashboardStats,
  getFunnelData,
  getFunnelList,
  getManagerRanking,
  getInsights,
  getDailyConversion,
  getDealStatSnapshot,
  getDuplicateStats,
} from "@/lib/queries/dashboard"
import { PeriodFilter } from "./_components/period-filter"
import { FunnelChart } from "./_components/funnel-chart"
import { SuccessFailCards } from "./_components/success-fail-cards"
import { RevenuePotential } from "./_components/revenue-potential"
import { KeyMetrics } from "./_components/key-metrics"
import { ConversionChart } from "./_components/conversion-chart"
import { ManagerRatingTable } from "./_components/manager-rating-table"
import { AiInsights } from "./_components/ai-insights"
import { DealStatSnapshotWidget } from "./_components/dealstat-snapshot"
import { DuplicateBadge } from "./_components/duplicate-badge"

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ funnel?: string; period?: string }>
}) {
  const tenantId = await requireTenantId()
  const sp = (await searchParams) ?? {}
  const selectedFunnelId = sp.funnel
  const period = (sp.period ?? "all") as
    | "day"
    | "week"
    | "month"
    | "quarter"
    | "all"

  const [stats, funnels, funnel, managers, insights, daily, dealStat, dupes] =
    await Promise.all([
      getDashboardStats(tenantId, period),
      getFunnelList(tenantId),
      getFunnelData(tenantId, selectedFunnelId, period),
      getManagerRanking(tenantId),
      getInsights(tenantId),
      getDailyConversion(tenantId, period),
      getDealStatSnapshot(tenantId),
      getDuplicateStats(tenantId),
    ])

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodFilter totalDeals={stats.totalDeals} />
        <DuplicateBadge stats={dupes} />
      </div>

      <Suspense>
        <KeyMetrics
          totalDeals={stats.totalDeals}
          conversionRate={stats.conversionRate}
          avgCheck={stats.avgCheck}
          avgTime={stats.avgTime}
        />
      </Suspense>

      {dealStat && (
        <Suspense>
          <DealStatSnapshotWidget snapshot={dealStat} />
        </Suspense>
      )}

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
        <FunnelChart
          stages={funnel}
          funnels={funnels}
          selectedFunnelId={selectedFunnelId}
        />
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

      <div className="mt-6 border-t border-border-default pt-3 text-[11px] text-text-muted">
        Аналитика ведётся с 01.01.2025. Сделки старше этой даты есть в базе, но
        не показываются и не анализируются ИИ — экономим ресурсы на актуальной
        работе.
        {dealStat?.source === "getcourse:dealstat" && (
          <span className="mt-1 block text-status-amber/70">
            ⚠ Для GetCourse: фильтр периода пока работает приблизительно (даты
            создания сделок берём из времени синхронизации, не из CRM —
            доработаем). Используйте «Все время» для полной картины.
          </span>
        )}
      </div>
    </div>
  )
}
