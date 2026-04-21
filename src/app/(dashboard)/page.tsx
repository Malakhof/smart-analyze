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
  getDuplicateStats,
} from "@/lib/queries/dashboard"
import { getTenantMode } from "@/lib/queries/active-window"
import { FunnelChart } from "./_components/funnel-chart"
import { SuccessFailCards } from "./_components/success-fail-cards"
import { RevenuePotential } from "./_components/revenue-potential"
import { KeyMetrics } from "./_components/key-metrics"
import { ConversionChart } from "./_components/conversion-chart"
import { ManagerRatingTable } from "./_components/manager-rating-table"
import { AiInsights } from "./_components/ai-insights"
import { DuplicateBadge } from "./_components/duplicate-badge"

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ funnel?: string }>
}) {
  const tenantId = await requireTenantId()
  const sp = (await searchParams) ?? {}
  const selectedFunnelId = sp.funnel
  const mode = await getTenantMode(tenantId)

  const [stats, funnels, funnel, managers, insights, daily, dupes] =
    await Promise.all([
      getDashboardStats(tenantId, undefined, mode),
      getFunnelList(tenantId),
      getFunnelData(tenantId, selectedFunnelId, undefined, mode),
      getManagerRanking(tenantId, mode),
      getInsights(tenantId, mode),
      getDailyConversion(tenantId, undefined, mode),
      getDuplicateStats(tenantId),
    ])

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-text-primary">
            {mode === "live" ? "Оперативный режим" : "Дашборд"}
          </h1>
          {mode === "live" && (
            <p className="mt-1 text-[13px] text-text-tertiary">
              Последние 7 дней по реальной активности менеджеров (звонки и
              сообщения). Историческую картину смотри в{" "}
              <a
                href="/retro"
                className="underline decoration-border-default underline-offset-2 hover:text-text-secondary"
              >
                Ретро аудите
              </a>
              .
            </p>
          )}
        </div>
        <DuplicateBadge stats={dupes} />
      </header>

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
        В оперативном режиме показываются только сделки с активностью (звонок
        или сообщение) за последние 7 дней — это исключает «шум» исторических
        данных. Полную картину за 90 дней с накопленной аналитикой смотри на
        странице «Ретро аудит».
      </div>
    </div>
  )
}
