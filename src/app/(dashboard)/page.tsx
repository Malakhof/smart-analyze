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
import { getCrmProvider, getTenantMode } from "@/lib/queries/active-window"
import {
  getDailyActivityPerManager,
  getWorstCallsToday,
  getTopMissingPhrases,
  getDepartmentTopWeakSpots,
  getDepartmentTopCriticalErrors,
  getUnfulfilledCommitments,
  getCallHeatmap,
  getDealStagesAfterCalls,
  getLastSyncTimestamp,
  getPipelineGapPct,
  getWonDealsCountForPeriod,
  getDepartmentAvgScriptScore,
  gcPeriodToCutoff,
  type GcPeriod,
} from "@/lib/queries/dashboard-gc"
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
import { DashboardRop } from "./_components/gc/dashboard-rop"
import { PeriodFilterGc } from "./_components/gc/period-filter-gc"

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ funnel?: string; period?: string }>
}) {
  const tenantId = await requireTenantId()
  const sp = (await searchParams) ?? {}
  const provider = await getCrmProvider(tenantId)

  if (provider === "GETCOURSE") {
    return <GcDashboardPage tenantId={tenantId} period={sp.period} />
  }

  return <LegacyDashboardPage tenantId={tenantId} sp={sp} />
}

async function GcDashboardPage({
  tenantId,
  period,
}: {
  tenantId: string
  period?: string
}) {
  // Default = month: backfill 24-29 апреля + новый поток. "today" даёт
  // пустоту до того как cron накопит свежие данные.
  const gcPeriod: GcPeriod =
    period === "today" ? "today" : period === "week" ? "week" : "month"

  const periodFrom = gcPeriodToCutoff(gcPeriod)
  const periodTo = new Date()

  const [
    daily,
    worstCalls,
    missingPhrases,
    topWeakSpots,
    topCriticalErrors,
    unfulfilledCommitments,
    heatmap,
    funnelStages,
    lastSync,
    pipelineGap,
    wonCount,
    avgScriptScore,
  ] = await Promise.all([
    getDailyActivityPerManager(tenantId, gcPeriod),
    getWorstCallsToday(tenantId, gcPeriod, 10),
    getTopMissingPhrases(tenantId, gcPeriod, 3),
    getDepartmentTopWeakSpots(tenantId, gcPeriod, 5),
    getDepartmentTopCriticalErrors(tenantId, gcPeriod, 5),
    getUnfulfilledCommitments(tenantId, 10),
    getCallHeatmap(tenantId),
    getDealStagesAfterCalls(tenantId, gcPeriod),
    getLastSyncTimestamp(tenantId),
    getPipelineGapPct(tenantId, gcPeriod),
    getWonDealsCountForPeriod(tenantId, periodFrom, periodTo),
    getDepartmentAvgScriptScore(tenantId, gcPeriod),
  ])

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-text-primary">
            Дашборд РОПа
          </h1>
          <p className="mt-1 text-[13px] text-text-tertiary">
            Канон #37 — контроль качества разговоров. Деньги/выручку смотри в
            CRM.
          </p>
        </div>
        <PeriodFilterGc />
      </header>
      <DashboardRop
        daily={daily}
        worstCalls={worstCalls}
        missingPhrases={missingPhrases}
        topWeakSpots={topWeakSpots}
        topCriticalErrors={topCriticalErrors}
        unfulfilledCommitments={unfulfilledCommitments}
        heatmap={heatmap}
        funnelStages={funnelStages}
        lastSync={lastSync}
        pipelineGap={pipelineGap}
        wonCount={wonCount}
        avgScriptScore={avgScriptScore}
      />
    </div>
  )
}

async function LegacyDashboardPage({
  tenantId,
  sp,
}: {
  tenantId: string
  sp: { funnel?: string; period?: string }
}) {
  const selectedFunnelId = sp.funnel
  const mode = await getTenantMode(tenantId)
  const period = (sp.period ?? "all") as
    | "day"
    | "week"
    | "month"
    | "quarter"
    | "all"

  // LIVE mode (diva): фильтр по 7д активности, без period filter
  // ALL mode (vastu/reklama): legacy с PeriodFilter + DealStatSnapshot
  const [stats, funnels, funnel, managers, insights, daily, dealStat, dupes] =
    await Promise.all([
      getDashboardStats(tenantId, mode === "live" ? undefined : period, mode),
      getFunnelList(tenantId),
      getFunnelData(
        tenantId,
        selectedFunnelId,
        mode === "live" ? undefined : period,
        mode
      ),
      getManagerRanking(tenantId, mode),
      getInsights(tenantId, mode),
      getDailyConversion(
        tenantId,
        mode === "live" ? undefined : period,
        mode
      ),
      mode === "all" ? getDealStatSnapshot(tenantId) : Promise.resolve(null),
      getDuplicateStats(tenantId),
    ])

  return (
    <div className="space-y-6 p-6">
      {mode === "live" ? (
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-text-primary">
              Оперативный режим
            </h1>
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
          </div>
          <DuplicateBadge stats={dupes} />
        </header>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PeriodFilter totalDeals={stats.totalDeals} />
          <DuplicateBadge stats={dupes} />
        </div>
      )}

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

      {mode !== "live" && (
        <Suspense>
          <FunnelChart
            stages={funnel}
            funnels={funnels}
            selectedFunnelId={selectedFunnelId}
          />
        </Suspense>
      )}

      {mode !== "live" && (
        <Suspense>
          <ConversionChart data={daily} />
        </Suspense>
      )}

      <Suspense>
        <ManagerRatingTable managers={managers} />
      </Suspense>

      <Suspense>
        <AiInsights
          insights={insights.filter((i) => !i.title.startsWith("🔥RETRO_AUDIT"))}
        />
      </Suspense>

      {mode === "live" && (
        <div className="mt-6 border-t border-border-default pt-3 text-[11px] text-text-muted">
          В оперативном режиме показываются только сделки с активностью
          (звонок или сообщение) за последние 7 дней — это исключает «шум»
          исторических данных. Полную картину за 90 дней с накопленной
          аналитикой смотри на странице «Ретро аудит».
        </div>
      )}
    </div>
  )
}
