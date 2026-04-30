import { requireTenantId } from "@/lib/auth"
export const dynamic = "force-dynamic"

import { AiBadge } from "@/components/ai-badge"
import {
  getQualityDashboard,
  getQcFilterOptions,
  getQcChartData,
  getQcGraphData,
  getRecentCallsEnhanced,
  getQcCallTypeCounts,
  parseQcFiltersFromSearchParams,
} from "@/lib/queries/quality"
import { getCrmProvider, getTenantMode } from "@/lib/queries/active-window"
import {
  getQualityFilterOptionsGc,
  getQualityCallsListGc,
  type QualityFilters,
} from "@/lib/queries/quality-gc"
import type { GcPeriod } from "@/lib/queries/dashboard-gc"
import { QcSummary } from "./_components/qc-summary"
import { QcDonutCharts } from "./_components/qc-donut-charts"
import { QcComplianceChart } from "./_components/qc-compliance-chart"
import { QcScoreDistribution } from "./_components/qc-score-distribution"
import { QcManagerTable } from "./_components/qc-manager-table"
import { QcRecentCalls } from "./_components/qc-recent-calls"
import { QcFilters } from "./_components/qc-filters"
import { QcVoicemailFilter } from "./_components/qc-voicemail-filter"
import { PeriodFilterGc } from "../_components/gc/period-filter-gc"
import { QualityFiltersGc } from "../_components/gc/quality-filters"
import { QualityListGc } from "../_components/gc/quality-list"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function QualityPage(props: {
  searchParams: SearchParams
}) {
  const sp = await props.searchParams
  const tenantId = await requireTenantId()
  const provider = await getCrmProvider(tenantId)

  if (provider === "GETCOURSE") {
    const period: GcPeriod =
      sp.period === "today"
        ? "today"
        : sp.period === "week"
          ? "week"
          : "month"

    const gcFilters: QualityFilters = {
      period,
      callType: typeof sp.callType === "string" ? sp.callType : undefined,
      callOutcome:
        typeof sp.callOutcome === "string" ? sp.callOutcome : undefined,
      managerId: typeof sp.managerId === "string" ? sp.managerId : undefined,
      hadRealConversation:
        sp.realOnly === "true"
          ? true
          : sp.realOnly === "false"
            ? false
            : undefined,
      sortBy:
        sp.sortBy === "score" || sp.sortBy === "duration"
          ? sp.sortBy
          : "date",
      sortDir: "desc",
      page:
        typeof sp.page === "string" ? Math.max(1, parseInt(sp.page, 10) || 1) : 1,
    }

    // Legacy QC queries (charts/donuts/compliance/score distribution) — diva
    // already uses these via mode="live". Reuse for the rich rendering и
    // дополним новыми GC-фильтрами + flat-таблицей внизу как drill-down.
    const legacyFilters = parseQcFiltersFromSearchParams(sp)
    const [
      options,
      data,
      dashboard,
      legacyOptions,
      charts,
      graphs,
      recent,
      callTypeCounts,
    ] = await Promise.all([
      getQualityFilterOptionsGc(tenantId),
      getQualityCallsListGc(tenantId, gcFilters),
      getQualityDashboard(tenantId, "live", legacyFilters),
      getQcFilterOptions(tenantId),
      getQcChartData(tenantId, "live", legacyFilters),
      getQcGraphData(tenantId, "live", legacyFilters),
      getRecentCallsEnhanced(tenantId, 20, "live", legacyFilters),
      getQcCallTypeCounts(tenantId, "live", legacyFilters),
    ])

    const spString = new URLSearchParams(
      Object.entries(sp).flatMap(([k, v]) =>
        typeof v === "string" ? [[k, v]] : []
      ) as [string, string][]
    ).toString()

    return (
      <div className="space-y-6 p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-text-primary">
              Контроль качества
            </h1>
            <p className="mt-1 text-[13px] text-text-tertiary">
              {dashboard.totalCalls} {callsWord(dashboard.totalCalls)}{" "}
              проанализировано · кураторы исключены
            </p>
          </div>
          <div className="flex items-center gap-2">
            <PeriodFilterGc />
            <AiBadge text="AI оценка" />
          </div>
        </header>

        <QcFilters
          categories={legacyOptions.categories}
          tags={legacyOptions.tags}
          managers={legacyOptions.managers}
          scriptItems={legacyOptions.scriptItems}
        />

        <QcVoicemailFilter
          filteredCount={callTypeCounts.filtered}
          totalCount={callTypeCounts.total}
        />

        {dashboard.totalCalls > 0 && (
          <>
            <QcSummary
              totalCalls={charts.totalCalls}
              totalCallsChange={charts.totalCallsChange}
              avgScore={charts.avgScore}
              avgScoreChange={charts.avgScoreChange}
              bestManager={charts.bestManager}
              worstManager={charts.worstManager}
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

        {/* Расширенный фильтр + flat-список (GC drill-down с 7 типами diva) */}
        <section className="space-y-4 border-t border-border-default pt-6">
          <div>
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-text-primary">
              Расширенный поиск звонков
            </h2>
            <p className="mt-1 text-[12px] text-text-tertiary">
              7 типов diva: callType / callOutcome / МОП / hadRealConversation
              + sort. Drill-down → карточка звонка по эталону sample-3/4.
            </p>
          </div>
          <QualityFiltersGc options={options} />
          <QualityListGc data={data} searchParamsString={spString} />
        </section>
      </div>
    )
  }

  // Legacy amoCRM path
  const mode = await getTenantMode(tenantId)
  const qcFilters = parseQcFiltersFromSearchParams(sp)
  const [dashboard, filters, charts, graphs, recent, callTypeCounts] =
    await Promise.all([
      getQualityDashboard(tenantId, mode, qcFilters),
      getQcFilterOptions(tenantId),
      getQcChartData(tenantId, mode, qcFilters),
      getQcGraphData(tenantId, mode, qcFilters),
      getRecentCallsEnhanced(tenantId, 20, mode, qcFilters),
      getQcCallTypeCounts(tenantId, mode, qcFilters),
    ])

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-text-primary">
              Контроль качества
            </h1>
            <p className="mt-1 text-[13px] text-text-tertiary">
              {dashboard.totalCalls} {callsWord(dashboard.totalCalls)} проанализировано
            </p>
          </div>
          <AiBadge text="AI оценка" />
        </div>
        <div className="rounded-[10px] border border-border-default bg-surface-1 p-4 text-[12.5px] leading-[1.65] text-text-secondary">
          <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-text-primary">
            Какие звонки попадают в анализ
          </div>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              В анализ берутся только звонки с <strong>длительностью от 90 секунд</strong> —
              служебные/недозвоны/автоответчики отфильтровываются.
            </li>
            <li>
              Каждый звонок расшифровывается ИИ-агентом со стерео-разделением
              ролей «менеджер / клиент».
            </li>
            <li>
              ИИ-агент оценивает каждый звонок по 8 критериям продаж (100-балльная шкала),
              выставляет категорию, теги, рекомендацию. Все оценки кликабельны —
              можно провалиться в конкретный звонок и проверить.
            </li>
          </ul>
        </div>
      </header>

      <QcFilters
        categories={filters.categories}
        tags={filters.tags}
        managers={filters.managers}
        scriptItems={filters.scriptItems}
      />

      <QcVoicemailFilter
        filteredCount={callTypeCounts.filtered}
        totalCount={callTypeCounts.total}
      />

      {dashboard.totalCalls === 0 ? (
        <div className="rounded-md border border-border-default p-8 text-center text-text-tertiary">
          <div className="text-[14px]">
            За выбранный период звонков не найдено
          </div>
          <div className="mt-1 text-[12px]">
            Смените период фильтра слева или сбросьте его, чтобы увидеть
            все проанализированные звонки.
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
