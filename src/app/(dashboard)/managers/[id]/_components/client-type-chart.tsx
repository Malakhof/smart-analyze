"use client"

import { DonutChart } from "@tremor/react"

interface ClientTypeChartProps {
  totalDeals: number
}

export function ClientTypeChart({ totalDeals }: ClientTypeChartProps) {
  const data = [
    { name: "Первичные", value: totalDeals || 0 },
    { name: "Повторные", value: 0 },
  ].filter((d) => d.value > 0)

  const total = data.reduce((s, d) => s + d.value, 0)

  return (
    <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]">
      <h4 className="mb-4 text-[14px] font-bold text-text-primary">
        Первичные vs Повторные
      </h4>

      {total === 0 ? (
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
              colors={["violet", "fuchsia"]}
              showLabel={true}
              label={String(total)}
              valueFormatter={(v) => String(v)}
              className="h-[160px] w-[160px]"
              showAnimation={true}
              showTooltip={true}
            />
          </div>

          <div className="mt-4 space-y-2">
            {data.map((item) => {
              const pct = total > 0 ? Math.round((item.value / total) * 100) : 0
              return (
                <div
                  key={item.name}
                  className="flex items-center justify-between text-[12px]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full ${
                        item.name === "Первичные"
                          ? "bg-violet-500"
                          : "bg-fuchsia-500"
                      }`}
                    />
                    <span className="truncate text-text-secondary">
                      {item.name}: {item.value} ({pct}%)
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
