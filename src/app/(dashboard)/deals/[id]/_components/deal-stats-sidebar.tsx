import type {
  DealDetailMessage,
  DealDetailStage,
} from "@/lib/queries/deal-detail"

interface DealStatsSidebarProps {
  messages: DealDetailMessage[]
  avgResponseTime: number | null
  stages: DealDetailStage[]
}

export function DealStatsSidebar({
  messages,
  avgResponseTime,
  stages,
}: DealStatsSidebarProps) {
  const textMessages = messages.filter((m) => !m.isAudio)
  const audioMessages = messages.filter((m) => m.isAudio)

  // Find longest stage
  let longestStage: { name: string; duration: number } | null = null
  for (const s of stages) {
    const dur = s.duration ?? 0
    if (!longestStage || dur > longestStage.duration) {
      longestStage = { name: s.stageName, duration: dur }
    }
  }

  const rows = [
    {
      label: "Всего коммуникаций",
      value: String(messages.length),
    },
    {
      label: "Сообщений",
      value: String(textMessages.length),
      extra: `Звонков: ${audioMessages.length}`,
    },
    {
      label: "Ср. время ответа",
      value: `${(avgResponseTime ?? 0).toFixed(1)} минут`,
    },
    {
      label: "Самый долгий этап",
      value: longestStage
        ? `${longestStage.name} (${longestStage.duration.toFixed(1)} дн)`
        : "—",
    },
  ]

  return (
    <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)]">
      <h3 className="mb-4 text-[14px] font-bold">Статистика сделки</h3>
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
              {row.label}
            </div>
            <div className="text-[14px] font-semibold text-text-primary">
              {row.value}
            </div>
            {row.extra && (
              <div className="text-[12px] text-text-tertiary">{row.extra}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
