export const dynamic = "force-dynamic"

import Link from "next/link"
import { notFound } from "next/navigation"
import {
  getManagerQualityFull,
  parseQcFiltersFromSearchParams,
} from "@/lib/queries/quality"
import { QcFilters } from "../../_components/qc-filters"
import { QcDonutCharts } from "../../_components/qc-donut-charts"
import { QcComplianceChart } from "../../_components/qc-compliance-chart"
import { QcScoreDistribution } from "../../_components/qc-score-distribution"
import { QcRecentCalls } from "../../_components/qc-recent-calls"

function changeIndicator(value: number) {
  if (value === 0) return null
  const isPositive = value > 0
  return (
    <span
      className={`text-[13px] font-semibold ${
        isPositive ? "text-status-green" : "text-status-red"
      }`}
    >
      {isPositive ? "+" : ""}
      {value}
    </span>
  )
}

function scoreColor(score: number): string {
  if (score >= 80) return "text-status-green"
  if (score >= 50) return "text-status-amber"
  return "text-status-red"
}

export default async function QcManagerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const qcFilters = parseQcFiltersFromSearchParams(sp)
  const data = await getManagerQualityFull(id, qcFilters)

  if (!data) notFound()

  return (
    <>
      {/* Back link with manager name */}
      <Link
        href="/quality"
        className="mb-5 inline-flex items-center gap-1 text-[13px] text-text-secondary transition-colors hover:text-text-primary"
      >
        &larr; {data.name}
      </Link>

      {/* 3 summary cards */}
      <div className="mb-5 grid grid-cols-3 gap-2.5">
        {/* Card 1: Total calls */}
        <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
            Совершено звонков
          </div>
          <div className="flex items-baseline gap-2">
            <div className="text-[26px] font-extrabold leading-none tracking-[-0.04em]">
              {data.totalCalls}
            </div>
            {changeIndicator(data.totalCallsChange)}
          </div>
        </div>

        {/* Card 2: Avg score */}
        <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
            Средняя оценка менеджера
          </div>
          <div className="flex items-baseline gap-2">
            <div
              className={`text-[26px] font-extrabold leading-none tracking-[-0.04em] ${scoreColor(data.avgScore)}`}
            >
              {data.avgScore}
            </div>
            {changeIndicator(data.avgScoreChange)}
          </div>
        </div>

        {/* Card 3: Conversion placeholder */}
        <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
            Конверсия в деньги
          </div>
          <div className="flex items-baseline gap-2">
            <div className="text-[26px] font-extrabold leading-none tracking-[-0.04em] text-text-tertiary">
              0.0%
            </div>
          </div>
        </div>
      </div>

      {/* 2-column: filters sidebar + content */}
      <div className="flex gap-5">
        {/* Left sidebar — filters (without managers dropdown) */}
        <QcFilters
          categories={data.filterOptions.categories}
          tags={data.filterOptions.tags}
          managers={[]}
          scriptItems={data.filterOptions.scriptItems}
          hideManagers
        />

        {/* Right — main content */}
        <div className="min-w-0 flex-1">
          {/* Donut charts */}
          <QcDonutCharts
            categoryBreakdown={data.categoryBreakdown}
            tagBreakdown={data.tagBreakdown}
          />

          {/* Charts: Compliance + Score Distribution */}
          <div className="mb-5 grid grid-cols-2 gap-2.5">
            <QcComplianceChart data={data.complianceByStep} />
            <QcScoreDistribution data={data.scoreDistribution} />
          </div>

          {/* Recent calls */}
          <section className="mt-8">
            <h3 className="mb-4 text-[16px] font-bold">Все звонки</h3>
            <QcRecentCalls calls={data.recentCalls} />
          </section>
        </div>
      </div>
    </>
  )
}
