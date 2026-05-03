"use client"

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { QcScoreBucket } from "@/lib/queries/quality"

interface QcScoreDistributionProps {
  data: QcScoreBucket[]
}

interface MiniBarChartProps {
  data: { range: string; value: number }[]
  yMax: number
  fillVar: string
}

/**
 * Tufte's "small multiples": render the same chart twice side-by-side so the
 * eye can compare distributions without the legend dance. Shared y-axis scale
 * (yMax) keeps comparison honest.
 */
function MiniBarChart({ data, yMax, fillVar }: MiniBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
        <CartesianGrid
          stroke="var(--border-default)"
          strokeDasharray="3 3"
          vertical={false}
        />
        <XAxis
          dataKey="range"
          tick={{ fill: "var(--text-tertiary)", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "var(--border-default)" }}
        />
        <YAxis
          domain={[0, yMax]}
          tick={{ fill: "var(--text-tertiary)", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "var(--border-default)" }}
          width={32}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            background: "var(--surface-1)",
            border: "1px solid var(--border-default)",
            borderRadius: 6,
            fontSize: 12,
          }}
          cursor={{ fill: "var(--surface-2)" }}
          formatter={(value) => [String(value), "звонков"]}
        />
        <Bar dataKey="value" fill={fillVar} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
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

  const currentData = data.map((d) => ({ range: d.range, value: d.current }))
  const priorData = data.map((d) => ({ range: d.range, value: d.previous }))

  // Shared y-axis scale across panels — fair comparison requires it.
  const yMax = Math.max(
    1,
    ...data.map((d) => Math.max(d.current, d.previous))
  )

  return (
    <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]">
      <h4 className="mb-4 text-[14px] font-bold text-text-primary">
        Распределение оценок по звонкам
      </h4>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <h5 className="mb-1 text-[11px] text-text-tertiary">
            Текущий период
          </h5>
          <MiniBarChart
            data={currentData}
            yMax={yMax}
            fillVar="var(--ai-1)"
          />
        </div>
        <div>
          <h5 className="mb-1 text-[11px] text-text-tertiary">
            Предыдущий период
          </h5>
          <MiniBarChart
            data={priorData}
            yMax={yMax}
            fillVar="var(--text-tertiary)"
          />
        </div>
      </div>
    </div>
  )
}
