import type { RetroVolume } from "@/lib/queries/retro"

interface RetroVolumeBarProps {
  volume: RetroVolume
}

const ru = new Intl.NumberFormat("ru-RU")

/**
 * Single horizontal stacked bar: deals / messages / calls.
 * Visualizes RELATIVE volume across the three data classes — message
 * volume usually dwarfs call volume by orders of magnitude, which itself
 * is a story for the prospect.
 */
export function RetroVolumeBar({ volume }: RetroVolumeBarProps) {
  const segments = [
    {
      key: "deals",
      label: "Сделки",
      value: volume.dealsTotal,
      bg: "bg-[#3B82F6]",
      dot: "bg-[#3B82F6]",
    },
    {
      key: "messages",
      label: "Сообщения",
      value: volume.messagesTotal,
      bg: "bg-[#10B981]",
      dot: "bg-[#10B981]",
    },
    {
      key: "calls",
      label: "Звонки",
      value: volume.calls,
      bg: "bg-[#8B5CF6]",
      dot: "bg-[#8B5CF6]",
    },
  ]

  const total = segments.reduce((s, x) => s + x.value, 0) || 1

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <div className="text-[14px] font-semibold text-text-primary">
          Объём обработанных данных
        </div>
        <div className="text-[12px] text-text-tertiary">
          {ru.format(total)} строк суммарно
        </div>
      </div>

      <div className="flex h-9 w-full overflow-hidden rounded-[8px] border border-border-default bg-surface-2">
        {segments.map((s) => {
          const pct = (s.value / total) * 100
          if (pct < 0.01) return null
          return (
            <div
              key={s.key}
              className={`flex h-full items-center justify-center text-[11px] font-semibold text-white ${s.bg}`}
              style={{ width: `${pct}%` }}
              title={`${s.label}: ${ru.format(s.value)} (${pct.toFixed(1)}%)`}
            >
              {pct >= 8 ? `${pct.toFixed(1)}%` : ""}
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-5 text-[12px] text-text-secondary">
        {segments.map((s) => {
          const pct = (s.value / total) * 100
          return (
            <div key={s.key} className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />
              <span className="font-medium text-text-primary">{s.label}</span>
              <span className="text-text-tertiary">
                {ru.format(s.value)} ({pct.toFixed(1)}%)
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
