"use client"

import { AreaChart } from "@tremor/react"
import { fmtMoney } from "@/lib/format"
import { TooltipMetric } from "@/components/tooltip-metric"
import type { DealStatSnapshot } from "@/lib/queries/dashboard"

interface DealStatSnapshotProps {
  snapshot: DealStatSnapshot
}

const SOURCE_LABEL: Record<string, string> = {
  "getcourse:dealstat": "GetCourse",
  "amocrm:pipeline-stat": "amoCRM",
}

function fmtNum(n: number | null): string {
  if (n === null || n === undefined) return "—"
  return new Intl.NumberFormat("ru-RU").format(n)
}

export function DealStatSnapshotWidget({ snapshot }: DealStatSnapshotProps) {
  const sourceLabel = SOURCE_LABEL[snapshot.source] ?? snapshot.source

  const tiles = [
    {
      label: "Заработано",
      value: fmtMoney(snapshot.earnedAmount ?? 0),
      tooltip:
        "Совокупная выручка по данным CRM (после комиссий/налогов, по pre-aggregated отчётам).",
    },
    {
      label: "Оплачено заказов",
      value: fmtNum(snapshot.ordersPaidCount),
      tooltip: "Количество оплаченных заказов",
    },
    {
      label: "Сумма оплат",
      value: fmtMoney(snapshot.ordersPaidAmount ?? 0),
      tooltip: "Общая сумма по оплаченным заказам",
    },
    {
      label: "Покупателей",
      value: fmtNum(snapshot.buyersCount),
      tooltip: "Уникальных клиентов оплативших что-либо",
    },
  ]

  // Build chart data from earned series (preferred) or fall back to first series
  const earnedSeries =
    snapshot.series.find((s) => /заработ|earn|выручк/i.test(s.name)) ??
    snapshot.series[0]
  const chartData = earnedSeries
    ? earnedSeries.points.map((p) => ({
        month: p.month,
        [earnedSeries.name]: p.value,
      }))
    : []

  return (
    <div className="mb-8">
      <div className="mb-3.5 flex items-end justify-between">
        <div>
          <div className="text-[13px] font-semibold text-text-secondary">
            Финансы по данным CRM
          </div>
          <div className="mt-0.5 text-[11px] text-text-tertiary">
            Источник: {sourceLabel} · обновлено{" "}
            {new Intl.DateTimeFormat("ru-RU", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            }).format(new Date(snapshot.capturedAt))}
          </div>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-4 gap-2.5">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]"
          >
            <div className="mb-2 flex items-center text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
              {t.label}
              <TooltipMetric text={t.tooltip} />
            </div>
            <div className="text-[24px] font-extrabold leading-none tracking-[-0.04em]">
              {t.value}
            </div>
          </div>
        ))}
      </div>

      {chartData.length > 0 && earnedSeries && (
        <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]">
          <h3 className="mb-4 text-[14px] font-bold text-text-primary">
            {earnedSeries.name} по месяцам
          </h3>
          <div className="overflow-visible pl-1">
            <AreaChart
              data={chartData}
              index="month"
              categories={[earnedSeries.name]}
              colors={["emerald"]}
              valueFormatter={(v: number) => fmtMoney(v)}
              yAxisWidth={84}
              showAnimation={true}
              showLegend={false}
              showGridLines={true}
              showGradient={true}
              curveType="monotone"
              className="h-[260px]"
              showTooltip={true}
              showYAxis={true}
            />
          </div>
        </div>
      )}
    </div>
  )
}
