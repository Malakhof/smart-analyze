"use client"

import { AreaChart } from "@tremor/react"
import type { QcComplianceStep } from "@/lib/queries/quality"

interface QcComplianceChartProps {
  data: QcComplianceStep[]
}

export function QcComplianceChart({ data }: QcComplianceChartProps) {
  if (data.length === 0) {
    return (
      <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)]">
        <h4 className="mb-4 text-[14px] font-bold text-text-primary">
          Выполнение скрипта
        </h4>
        <div className="py-8 text-center text-[13px] text-text-tertiary">
          Нет данных
        </div>
      </div>
    )
  }

  // Tremor AreaChart expects data as array of objects with category key + value keys
  // Truncate long step names for X-axis readability; tooltip shows the full name via customTooltip
  const chartData = data.map((d) => ({
    step: d.step.length > 15 ? d.step.slice(0, 12) + "…" : d.step,
    "Текущий период": d.current,
    "Предыдущий период": d.previous,
  }))

  return (
    <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]">
      <h4 className="mb-4 text-[14px] font-bold text-text-primary">
        Выполнение скрипта
      </h4>
      <AreaChart
        data={chartData}
        index="step"
        categories={["Текущий период", "Предыдущий период"]}
        colors={["violet", "fuchsia"]}
        valueFormatter={(v: number) => Math.round(v) + "%"}
        yAxisWidth={48}
        showAnimation={true}
        showLegend={true}
        showGridLines={true}
        showGradient={true}
        curveType="monotone"
        className="h-[280px]"
        minValue={0}
        maxValue={100}
      />
    </div>
  )
}
