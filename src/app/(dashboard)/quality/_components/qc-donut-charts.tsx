"use client"

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts"

interface ChartItem {
  name: string
  value: number
  color: string
}

interface QcDonutChartsProps {
  categoryBreakdown: ChartItem[]
  tagBreakdown: ChartItem[]
}

const CATEGORY_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#8b5cf6", "#06b6d4"]
const TAG_COLORS = ["#ef4444", "#f97316", "#dc2626", "#ec4899", "#d946ef"]

function DonutCard({
  title,
  data,
  showAllHref,
  colors,
}: {
  title: string
  data: ChartItem[]
  showAllHref?: string
  colors: string[]
}) {
  const total = data.reduce((s, d) => s + d.value, 0)

  return (
    <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]">
      <h4 className="mb-4 text-[14px] font-bold text-text-primary">{title}</h4>

      {data.length === 0 ? (
        <div className="py-8 text-center text-[13px] text-text-tertiary">
          Нет данных
        </div>
      ) : (
        <>
          <div className="relative flex justify-center">
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={72}
                  strokeWidth={0}
                >
                  {data.map((_, i) => (
                    <Cell key={i} fill={colors[i % colors.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--surface-1, #1a1a2e)",
                    border: "1px solid var(--border-default, #2a2a4a)",
                    borderRadius: "8px",
                    fontSize: "12px",
                    color: "var(--text-primary, #fff)",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Center label */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="text-[20px] font-bold text-text-primary">
                {total}
              </span>
            </div>
          </div>

          {/* Legend */}
          <div className="mt-4 space-y-2">
            {data.map((item, i) => (
              <div
                key={item.name}
                className="flex items-center justify-between text-[12px]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: colors[i % colors.length] }}
                  />
                  <span className="truncate text-text-secondary">
                    {item.name}
                  </span>
                </div>
                <span className="ml-2 flex-shrink-0 font-semibold text-text-primary tabular-nums">
                  {item.value}
                </span>
              </div>
            ))}
          </div>

          {showAllHref && (
            <div className="mt-3 border-t border-border-default pt-3 text-center">
              <button className="text-[12px] font-medium text-blue-500 transition-colors hover:text-blue-400">
                Показать все
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function QcDonutCharts({
  categoryBreakdown,
  tagBreakdown,
}: QcDonutChartsProps) {
  return (
    <div className="mb-5 grid grid-cols-2 gap-2.5">
      <DonutCard title="Категории" data={categoryBreakdown} showAllHref="#" colors={CATEGORY_COLORS} />
      <DonutCard title="Теги" data={tagBreakdown} showAllHref="#" colors={TAG_COLORS} />
    </div>
  )
}
