import { fmtMoney, fmtPercent, fmtDays } from "@/lib/format"
import { TooltipMetric } from "@/components/tooltip-metric"

interface KeyMetricsProps {
  totalDeals: number
  conversionRate: number
  avgCheck: number
  avgTime: number
}

export function KeyMetrics({
  totalDeals,
  conversionRate,
  avgCheck,
  avgTime,
}: KeyMetricsProps) {
  const metrics = [
    {
      label: "Всего сделок",
      value: String(totalDeals),
      change: null,
      tooltip: "Общее количество сделок за выбранный период",
    },
    {
      label: "Конверсия",
      value: fmtPercent(conversionRate),
      change: { text: "-3.2%", isPositive: false },
      tooltip:
        "Процент успешных сделок от общего числа закрытых сделок (успех + провал)",
    },
    {
      label: "Средний чек",
      value: fmtMoney(avgCheck),
      change: { text: "+8.1%", isPositive: true },
      tooltip: "Средняя сумма успешно закрытых сделок за период",
    },
    {
      label: "Ср. время сделки",
      value: fmtDays(avgTime),
      change: { text: "-2.1 дн", isPositive: true },
      tooltip:
        "Среднее время от создания до закрытия сделки (успех или провал)",
    },
  ]

  return (
    <div className="mb-8">
      <div className="mb-3.5 text-[13px] font-semibold text-text-secondary">
        Ключевые метрики
      </div>
      <div className="grid grid-cols-4 gap-2.5">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]"
          >
            <div className="mb-2 flex items-center text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
              {m.label}
              <TooltipMetric text={m.tooltip} />
            </div>
            <div className="text-[26px] font-extrabold leading-none tracking-[-0.04em]">
              {m.value}
            </div>
            {m.change && (
              <div
                className={`mt-1.5 text-[12px] font-medium ${
                  m.change.isPositive
                    ? "text-status-green"
                    : "text-status-red"
                }`}
              >
                {m.change.text}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
