"use client"

import { DonutChart } from "@tremor/react"

interface ChartItem {
  name: string
  value: number
  color: string
}

interface QcDonutChartsProps {
  categoryBreakdown: ChartItem[]
  tagBreakdown: ChartItem[]
}

function DonutCard({
  title,
  data,
  showAllHref,
}: {
  title: string
  data: ChartItem[]
  showAllHref?: string
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
          <div className="flex justify-center">
            <DonutChart
              data={data}
              category="value"
              index="name"
              colors={data.map((d) => d.color)}
              showLabel={true}
              label={String(total)}
              valueFormatter={(v) => String(v)}
              className="h-[160px] w-[160px]"
              showAnimation={true}
              showTooltip={true}
            />
          </div>

          {/* Legend */}
          <div className="mt-4 space-y-2">
            {data.map((item) => (
              <div
                key={item.name}
                className="flex items-center justify-between text-[12px]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: item.color }}
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
      <DonutCard title="Категории" data={categoryBreakdown} showAllHref="#" />
      <DonutCard title="Теги" data={tagBreakdown} showAllHref="#" />
    </div>
  )
}
