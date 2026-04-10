import { TooltipMetric } from "@/components/tooltip-metric"
import { fmtMoney, fmtPercent } from "@/lib/format"

interface ManagerStatsProps {
  totalDeals: number | null
  successDeals: number | null
  conversionRate: number | null
  avgDealValue: number | null
  talkRatio: number | null
}

export function ManagerStats({
  totalDeals,
  successDeals,
  conversionRate,
  avgDealValue,
  talkRatio,
}: ManagerStatsProps) {
  const conv = conversionRate ?? 0
  const convColor = conv >= 50 ? "text-status-green" : "text-status-red"

  const cards = [
    {
      label: "Сделок",
      value: String(totalDeals ?? 0),
      color: "",
      tooltip: "Общее количество закрытых сделок менеджера",
    },
    {
      label: "Успешных",
      value: String(successDeals ?? 0),
      color: "text-status-green",
      tooltip: "Количество сделок со статусом WON",
    },
    {
      label: "Конверсия",
      value: fmtPercent(conv),
      color: convColor,
      tooltip: "Доля успешных сделок от общего числа закрытых",
    },
    {
      label: "Ср. чек",
      value: fmtMoney(avgDealValue ?? 0),
      color: "",
      tooltip: "Средняя сумма успешной сделки",
    },
    {
      label: "Talk Ratio",
      value: fmtPercent(talkRatio ?? 0),
      color: "",
      tooltip:
        "Соотношение сообщений менеджера к общему числу сообщений в сделке",
    },
  ]

  return (
    <div className="mb-6 grid grid-cols-5 gap-2.5">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-[10px] border border-border-default bg-surface-1 p-5 text-center shadow-[var(--card-shadow)] transition-all duration-200 hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]"
        >
          <div className="mb-2 flex items-center justify-center text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
            {c.label}
            <TooltipMetric text={c.tooltip} />
          </div>
          <div
            className={`text-[22px] font-extrabold leading-none tracking-[-0.04em] ${c.color}`}
          >
            {c.value}
          </div>
        </div>
      ))}
    </div>
  )
}
