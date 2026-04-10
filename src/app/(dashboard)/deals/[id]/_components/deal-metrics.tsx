import { TooltipMetric } from "@/components/tooltip-metric"
import { fmtPercent } from "@/lib/format"
import type { DealDetailMessage } from "@/lib/queries/deal-detail"

interface DealMetricsProps {
  talkRatio: number | null
  avgResponseTime: number | null
  messages: DealDetailMessage[]
}

export function DealMetrics({
  talkRatio,
  avgResponseTime,
  messages,
}: DealMetricsProps) {
  const managerMessages = messages.filter((m) => m.sender === "MANAGER")
  const clientMessages = messages.filter((m) => m.sender === "CLIENT")
  const textMessages = messages.filter((m) => !m.isAudio)
  const audioMessages = messages.filter((m) => m.isAudio)

  const managerTexts = textMessages.filter((m) => m.sender === "MANAGER").length
  const clientTexts = textMessages.filter((m) => m.sender === "CLIENT").length
  const managerAudio = audioMessages.filter(
    (m) => m.sender === "MANAGER"
  ).length
  const clientAudio = audioMessages.filter((m) => m.sender === "CLIENT").length

  const cards = [
    {
      label: "Talk Ratio",
      value: fmtPercent(talkRatio ?? 0),
      tooltip:
        "Доля сообщений менеджера от общего числа сообщений в сделке",
    },
    {
      label: "Время ответа",
      value: `${(avgResponseTime ?? 0).toFixed(1)} минут`,
      tooltip: "Среднее время ответа менеджера на сообщение клиента",
    },
    {
      label: "Сообщений",
      value: `${textMessages.length} (М:${managerTexts} К:${clientTexts})`,
      tooltip:
        "Общее количество текстовых сообщений (Менеджер : Клиент)",
    },
    {
      label: "Звонков",
      value: `${audioMessages.length} (М:${managerAudio} К:${clientAudio})`,
      tooltip:
        "Общее количество аудиосообщений/звонков (Менеджер : Клиент)",
    },
  ]

  return (
    <div className="grid grid-cols-4 gap-2.5">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-[10px] border border-border-default bg-surface-1 p-5 text-center shadow-[var(--card-shadow)] transition-all duration-200 hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]"
        >
          <div className="mb-2 flex items-center justify-center text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
            {c.label}
            <TooltipMetric text={c.tooltip} />
          </div>
          <div className="text-[18px] font-extrabold leading-none tracking-[-0.04em]">
            {c.value}
          </div>
        </div>
      ))}
    </div>
  )
}
