"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import type { QcRecentCallEnhanced } from "@/lib/queries/quality"
import { CallSlideOver } from "./call-slide-over"

function fmtDuration(seconds: number | null): string {
  if (!seconds) return "--:--"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

function fmtDateLine1(date: Date): string {
  const d = new Date(date)
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

function fmtDateLine2(date: Date): string {
  const d = new Date(date)
  return d.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function scoreIndicatorColor(score: number): string {
  if (score >= 70) return "bg-emerald-500"
  if (score >= 50) return "bg-amber-400"
  return "bg-red-500"
}

const CATEGORY_BADGE_COLORS: Record<string, string> = {
  "Первичный контакт": "bg-blue-500/15 text-blue-400 border-blue-500/20",
  "КП отправлено": "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  "Секретарь": "bg-amber-500/15 text-amber-400 border-amber-500/20",
  "Новая компания": "bg-violet-500/15 text-violet-400 border-violet-500/20",
}

function getCategoryBadgeClass(category: string): string {
  return (
    CATEGORY_BADGE_COLORS[category] ??
    "bg-gray-500/15 text-gray-400 border-gray-500/20"
  )
}

function isNegativeTag(tag: string): boolean {
  return tag.toLowerCase().startsWith("не ")
}

interface QcRecentCallsProps {
  calls: QcRecentCallEnhanced[]
}

export function QcRecentCalls({ calls }: QcRecentCallsProps) {
  const router = useRouter()
  const [slideOverCallId, setSlideOverCallId] = useState<string | null>(null)
  const [slideOverOpen, setSlideOverOpen] = useState(false)

  function openSlideOver(callId: string) {
    setSlideOverCallId(callId)
    setSlideOverOpen(true)
  }

  const headers = [
    "Звонок",
    "Дата/Время",
    "Длительность",
    "Категория",
    "Теги",
    "Рекомендации",
    "Оценка",
    "",
  ]

  return (
    <div>
      <div className="overflow-hidden rounded-[10px] border border-border-default bg-surface-1 shadow-[var(--card-shadow)]">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {headers.map((h) => (
                  <th
                    key={h}
                    className="border-b border-border-default px-[14px] py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => {
                const visibleTags = c.tags.slice(0, 2)
                const extraTags = c.tags.length - 2

                return (
                  <tr
                    key={c.id}
                    onClick={() => openSlideOver(c.id)}
                    className="cursor-pointer transition-colors duration-100 hover:bg-surface-2 [&:not(:last-child)>td]:border-b [&:not(:last-child)>td]:border-border-default"
                  >
                    {/* Звонок (ID) */}
                    <td className="whitespace-nowrap px-[14px] py-3 text-[13px] font-medium text-text-primary">
                      <span className="inline-flex items-center gap-1.5">
                        {c.type === "CHAT" ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-text-tertiary">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-text-tertiary">
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                          </svg>
                        )}
                        {c.crmId ?? c.id.slice(0, 8)}
                      </span>
                    </td>

                    {/* Дата/Время — two lines */}
                    <td className="whitespace-nowrap px-[14px] py-3">
                      <div className="text-[13px] text-text-primary">
                        {fmtDateLine1(c.createdAt)}
                      </div>
                      <div className="text-[12px] text-text-tertiary">
                        {fmtDateLine2(c.createdAt)}
                      </div>
                    </td>

                    {/* Длительность */}
                    <td className="whitespace-nowrap px-[14px] py-3 text-[13px] text-text-secondary tabular-nums">
                      {fmtDuration(c.duration)}
                    </td>

                    {/* Категория */}
                    <td className="px-[14px] py-3">
                      {c.category ? (
                        <span
                          className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${getCategoryBadgeClass(c.category)}`}
                        >
                          {c.category}
                        </span>
                      ) : (
                        <span className="text-[12px] text-text-tertiary">
                          —
                        </span>
                      )}
                    </td>

                    {/* Теги */}
                    <td className="max-w-[220px] px-[14px] py-3">
                      {c.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {visibleTags.map((tag) => (
                            <span
                              key={tag}
                              className={`inline-block max-w-[180px] truncate rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${
                                isNegativeTag(tag)
                                  ? "border-red-500/20 bg-red-500/15 text-red-400"
                                  : "border-emerald-500/20 bg-emerald-500/15 text-emerald-400"
                              }`}
                            >
                              {tag}
                            </span>
                          ))}
                          {extraTags > 0 && (
                            <span className="inline-block rounded-md border border-border-default bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-tertiary">
                              +{extraTags} ещё
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[12px] text-text-tertiary">
                          —
                        </span>
                      )}
                    </td>

                    {/* Рекомендации */}
                    <td className="max-w-[200px] px-[14px] py-3">
                      {c.recommendation ? (
                        <p className="line-clamp-2 text-[12px] leading-[1.4] text-text-secondary">
                          {c.recommendation}
                        </p>
                      ) : (
                        <span className="text-[12px] text-text-tertiary">
                          —
                        </span>
                      )}
                    </td>

                    {/* Оценка — colored dot */}
                    <td className="px-[14px] py-3">
                      {c.totalScore != null ? (
                        <span
                          className={`inline-block h-3 w-3 rounded-full ${scoreIndicatorColor(c.totalScore)}`}
                          title={`${Math.round(c.totalScore)}%`}
                        />
                      ) : (
                        <span className="text-[11px] text-text-tertiary">
                          Не оценен
                        </span>
                      )}
                    </td>

                    {/* Action icons */}
                    <td className="whitespace-nowrap px-[14px] py-3">
                      <div className="flex items-center gap-2">
                        {/* Play button */}
                        {c.audioUrl && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              // TODO: open audio player
                            }}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-surface-2 hover:text-text-primary"
                            title="Прослушать"
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                            >
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </button>
                        )}
                        {/* Detail button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            openSlideOver(c.id)
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-surface-2 hover:text-text-primary"
                          title="Подробнее"
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M9 18l6-6-6-6" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {calls.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-[14px] py-8 text-center text-[13px] text-text-tertiary"
                  >
                    Нет записей звонков
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Export button */}
      <div className="mt-3 flex justify-end">
        <button
          onClick={() => {
            const header = ["ID", "Дата", "Длительность", "Категория", "Теги", "Оценка"]
            const rows = calls.map((c) => [
              c.crmId ?? c.id.slice(0, 8),
              new Date(c.createdAt).toLocaleDateString("ru-RU"),
              c.duration != null ? String(c.duration) : "",
              c.category ?? "",
              c.tags.join("; "),
              c.totalScore != null ? String(Math.round(c.totalScore)) : "",
            ])
            const csv = [header, ...rows]
              .map((row) =>
                row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")
              )
              .join("\n")
            const bom = "\uFEFF"
            const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" })
            const url = URL.createObjectURL(blob)
            const date = new Date().toISOString().slice(0, 10)
            const a = document.createElement("a")
            a.href = url
            a.download = `calls-export-${date}.csv`
            a.click()
            URL.revokeObjectURL(url)
          }}
          className="rounded-lg border border-border-default bg-surface-1 px-4 py-2 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
        >
          Экспорт
        </button>
      </div>

      {/* Call detail slide-over */}
      <CallSlideOver
        callId={slideOverCallId}
        open={slideOverOpen}
        onOpenChange={setSlideOverOpen}
      />
    </div>
  )
}
