"use client"

import { BarChart } from "@tremor/react"
import type { QcScoreBucket } from "@/lib/queries/quality"

interface QcScoreDistributionProps {
  data: QcScoreBucket[]
}

export function QcScoreDistribution({ data }: QcScoreDistributionProps) {
  if (data.length === 0) {
    return (
      <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)]">
        <h4 className="mb-4 text-[14px] font-bold text-text-primary">
          Распределение оценок по звонкам
        </h4>
        <div className="py-8 text-center text-[13px] text-text-tertiary">
          Нет данных
        </div>
      </div>
    )
  }

  const chartData = data.map((d) => ({
    range: d.range,
    "Текущий период": d.current,
    "Предыдущий период": d.previous,
  }))

  return (
    <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]">
      <h4 className="mb-4 text-[14px] font-bold text-text-primary">
        Распределение оценок по звонкам
      </h4>
      <BarChart
        data={chartData}
        index="range"
        categories={["Текущий период", "Предыдущий период"]}
        colors={["violet", "fuchsia"]}
        valueFormatter={(v) => String(v)}
        yAxisWidth={40}
        showAnimation={true}
        showLegend={true}
        showGridLines={true}
        className="h-[280px]"
      />
    </div>
  )
}
