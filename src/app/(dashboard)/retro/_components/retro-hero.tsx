import type { RetroVolume } from "@/lib/queries/retro"

interface RetroHeroProps {
  volume: RetroVolume
}

const ru = new Intl.NumberFormat("ru-RU")

interface Tile {
  label: string
  value: number
  caption: string
}

/**
 * Top-of-page "wow" wall: 6 huge numbers showing the scale of what we ingested
 * and analyzed for the tenant. Numbers are intentionally massive — this is the
 * first thing the prospect sees and we want them to feel the depth.
 */
export function RetroHero({ volume }: RetroHeroProps) {
  const tiles: Tile[] = [
    {
      label: "Сделок",
      value: volume.dealsTotal,
      caption: "Подняли всю базу за весь доступный период",
    },
    {
      label: "Звонков",
      value: volume.calls,
      caption: "Загрузили записи разговоров с клиентами",
    },
    {
      label: "Сообщений",
      value: volume.messagesTotal,
      caption: "Прочитали переписку менеджеров и клиентов",
    },
    {
      label: "Менеджеров",
      value: volume.managers,
      caption: "Построили профиль каждого продажника",
    },
    {
      label: "Расшифровок",
      value: volume.transcripts,
      caption: "Whisper large-v3, разделение по ролям",
    },
    {
      label: "Оценок звонков",
      value: volume.callScores,
      caption: "AI-проверка по чек-листу качества",
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-5 md:grid-cols-3">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="rounded-[12px] border border-border-default bg-surface-1 p-6 shadow-[var(--card-shadow)]"
        >
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
            {t.label}
          </div>
          <div className="text-5xl font-extrabold leading-none tracking-[-0.04em] text-text-primary md:text-6xl">
            {ru.format(t.value)}
          </div>
          <div className="mt-3 text-[12px] leading-[1.5] text-text-secondary">
            {t.caption}
          </div>
        </div>
      ))}
    </div>
  )
}
