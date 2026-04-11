import { TooltipMetric } from "@/components/tooltip-metric"
import { fmtMoney, fmtPercent, fmtDays } from "@/lib/format"

interface ManagerStatsProps {
  totalDeals: number | null
  successDeals: number | null
  lostDealsCount: number | null
  conversionRate: number | null
  avgDealValue: number | null
  talkRatio: number | null
  avgResponseTime: number | null
  totalSalesAmount: number | null
  avgDealTime: number | null
}

function fmtHours(value: number): string {
  return `${(value / 3600).toFixed(1)} ч`
}

function fmtMinutes(value: number): string {
  return `${(value / 60).toFixed(1)} мин`
}

export function ManagerStats({
  totalDeals,
  successDeals,
  lostDealsCount,
  conversionRate,
  avgDealValue,
  talkRatio,
  avgResponseTime,
  totalSalesAmount,
  avgDealTime,
}: ManagerStatsProps) {
  const conv = conversionRate ?? 0
  const convColor = conv >= 50 ? "text-status-green" : "text-status-red"

  const cards = [
    // Row 1
    {
      label: "Конверсия",
      value: fmtPercent(conv),
      color: convColor,
      tooltip: "Доля успешных сделок от общего числа закрытых",
    },
    {
      label: "Успешных сделок",
      value: String(successDeals ?? 0),
      color: "text-status-green",
      tooltip: "Количество сделок со статусом WON",
    },
    {
      label: "Проваленных",
      value: String(lostDealsCount ?? 0),
      color: "text-status-red",
      tooltip: "Количество сделок со статусом LOST",
    },
    // Row 2
    {
      label: "Talk Ratio",
      value: fmtPercent(talkRatio ?? 0),
      color: "",
      tooltip:
        "Соотношение сообщений менеджера к общему числу сообщений в сделке",
    },
    {
      label: "Время ответа",
      value: fmtHours(avgResponseTime ?? 0),
      color: "",
      tooltip: "Среднее время ответа менеджера клиенту",
    },
    {
      label: "Время до сделки",
      value: fmtDays(avgDealTime ?? 0),
      color: "",
      tooltip: "Среднее время от создания до успешного закрытия сделки",
    },
    // Row 3
    {
      label: "Средний чек",
      value: fmtMoney(avgDealValue ?? 0),
      color: "",
      tooltip: "Средняя сумма успешной сделки",
    },
    {
      label: "Сумма продаж",
      value: fmtMoney(totalSalesAmount ?? 0),
      color: "",
      tooltip: "Общая сумма всех успешных сделок",
    },
    {
      label: "Реакция на лид",
      value: fmtMinutes(avgResponseTime ?? 0),
      color: "",
      tooltip: "Среднее время первой реакции менеджера на новый лид",
    },
  ]

  return (
    <div className="mb-6 grid grid-cols-3 gap-2.5">
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
