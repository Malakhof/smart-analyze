"use client"

import { useState } from "react"
import type { DuplicateStats } from "@/lib/queries/dashboard"

interface DuplicateBadgeProps {
  stats: DuplicateStats
}

export function DuplicateBadge({ stats }: DuplicateBadgeProps) {
  const [open, setOpen] = useState(false)
  const total =
    stats.dealDuplicateCandidates +
    stats.callDuplicates +
    stats.messageDuplicateRows
  if (total === 0) return null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-1.5 rounded-md border border-status-amber/40 bg-status-amber-dim/20 px-2.5 py-1 text-[12px] font-medium text-status-amber transition-colors hover:bg-status-amber-dim/30"
        title="Подробнее о потенциальных дублях"
      >
        ⚠ Найдено дублей
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-[340px] rounded-md border border-border-default bg-surface-1 p-4 shadow-[var(--card-shadow-hover)]">
          <div className="mb-2 text-[13px] font-bold text-text-primary">
            Потенциальные дубли в данных
          </div>
          <ul className="mb-3 space-y-1 text-[12px] text-text-secondary">
            {stats.dealDuplicateCandidates > 0 && (
              <li>
                <span className="font-semibold">{stats.dealDuplicateCandidates}</span>{" "}
                пар сделок с одинаковым названием · менеджером · в окне 7 дней
              </li>
            )}
            {stats.callDuplicates > 0 && (
              <li>
                <span className="font-semibold">{stats.callDuplicates}</span>{" "}
                звонков с дублированной записью (тот же audio URL)
              </li>
            )}
            {stats.messageDuplicateRows > 0 && (
              <li>
                <span className="font-semibold">{stats.messageDuplicateRows}</span>{" "}
                дублирующихся сообщений в одной сделке
              </li>
            )}
          </ul>
          <div className="text-[11px] leading-relaxed text-text-tertiary">
            Эти данные пока учитываются в метриках. В рамках подписки реализуем
            автообъединение дублей с возможностью ручной проверки. Удалять
            оригинальные записи никогда не будем — только помечать.
          </div>
        </div>
      )}
    </div>
  )
}
