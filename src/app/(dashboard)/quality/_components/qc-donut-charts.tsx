"use client"

interface ChartItem {
  name: string
  value: number
  color: string
}

interface QcDonutChartsProps {
  categoryBreakdown: ChartItem[]
  tagBreakdown: ChartItem[]
}

function RankedBarCard({
  title,
  data,
  showAllHref,
}: {
  title: string
  data: ChartItem[]
  showAllHref?: string
}) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const sorted = [...data].sort((a, b) => b.value - a.value)
  const max = sorted.length > 0 ? sorted[0].value : 0

  return (
    <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]">
      <div className="mb-4 flex items-baseline justify-between">
        <h4 className="text-[14px] font-bold text-text-primary">{title}</h4>
        <span className="text-[12px] tabular-nums text-text-tertiary">
          всего: <span className="font-semibold text-text-primary">{total}</span>
        </span>
      </div>

      {sorted.length === 0 ? (
        <div className="py-8 text-center text-[13px] text-text-tertiary">
          Нет данных
        </div>
      ) : (
        <>
          <ul className="space-y-1.5">
            {sorted.map((item) => {
              const pct = total > 0 ? Math.round((item.value / total) * 100) : 0
              const widthPct = max > 0 ? (item.value / max) * 100 : 0
              return (
                <li
                  key={item.name}
                  className="flex items-center gap-2 text-[13px]"
                >
                  <div className="w-40 truncate text-text-secondary">
                    {item.name}
                  </div>
                  <div className="relative h-3 flex-1 rounded bg-surface-3">
                    <div
                      className="absolute inset-y-0 left-0 rounded bg-ai-1"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <span className="w-10 text-right tabular-nums text-text-primary">
                    {item.value}
                  </span>
                  <span className="w-10 text-right tabular-nums text-text-tertiary">
                    {pct}%
                  </span>
                </li>
              )
            })}
          </ul>

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
      <RankedBarCard title="Категории" data={categoryBreakdown} showAllHref="#" />
      <RankedBarCard title="Теги" data={tagBreakdown} showAllHref="#" />
    </div>
  )
}
