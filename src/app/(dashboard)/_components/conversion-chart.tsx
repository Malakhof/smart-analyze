"use client"

import { AreaChart } from "@tremor/react"
import type { DailyConversion } from "@/lib/queries/dashboard"

interface ConversionChartProps {
  data: DailyConversion[]
}

export function ConversionChart({ data }: ConversionChartProps) {
  if (data.length === 0) {
    return (
      <div className="mb-8 rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)]">
        <h3 className="mb-4 text-[14px] font-bold text-text-primary">
          Конверсия по дням
        </h3>
        <div className="py-8 text-center text-[13px] text-text-tertiary">
          Нет данных
        </div>
      </div>
    )
  }

  const chartData = data.map((d) => ({
    date: d.date,
    "Конверсия %": d.conversion,
  }))

  return (
    <div className="mb-8 rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]">
      <h3 className="mb-4 text-[14px] font-bold text-text-primary">
        Конверсия по дням
      </h3>
      <div className="overflow-visible pl-1">
        <AreaChart
          data={chartData}
          index="date"
          categories={["Конверсия %"]}
          colors={["violet"]}
          valueFormatter={(v: number) => `${Math.round(v)}%`}
          yAxisWidth={56}
          showAnimation={true}
          showLegend={false}
          showGridLines={true}
          showGradient={true}
          curveType="monotone"
          className="h-[280px]"
          minValue={0}
          maxValue={100}
          showTooltip={true}
          showYAxis={true}
        />
      </div>
    </div>
  )
}
