"use client"

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
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

  // Truncate long step names for X-axis readability; tooltip shows full name
  const chartData = data.map((d) => ({
    step: d.step.length > 15 ? d.step.slice(0, 12) + "…" : d.step,
    fullStep: d.step,
    current: d.current,
    prior: d.previous,
  }))

  // Ghost line for prior period only when there's any non-zero signal
  const hasPrior = chartData.some((d) => d.prior > 0)

  return (
    <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]">
      <h4 className="mb-4 text-[14px] font-bold text-text-primary">
        Выполнение скрипта
      </h4>
      <div className="h-[280px] overflow-visible pl-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
          >
            <CartesianGrid
              stroke="var(--border-default)"
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="step"
              tick={{ fill: "var(--text-tertiary)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "var(--border-default)" }}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: "var(--text-tertiary)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "var(--border-default)" }}
              width={40}
              tickFormatter={(v: number) => `${Math.round(v)}%`}
            />
            <Tooltip
              contentStyle={{
                background: "var(--surface-1)",
                border: "1px solid var(--border-default)",
                borderRadius: 6,
                fontSize: 12,
              }}
              labelFormatter={(_label, payload) => {
                const item = payload?.[0]?.payload as
                  | { fullStep?: string }
                  | undefined
                return item?.fullStep ?? ""
              }}
              formatter={(value, name) => [
                `${Math.round(Number(value))}%`,
                name === "current" ? "Текущий период" : "Предыдущий период",
              ]}
            />
            <Line
              type="monotone"
              dataKey="current"
              stroke="var(--ai-1)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            {hasPrior && (
              <Line
                type="monotone"
                dataKey="prior"
                stroke="var(--text-tertiary)"
                strokeWidth={1}
                strokeDasharray="3 3"
                dot={false}
                isAnimationActive={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
