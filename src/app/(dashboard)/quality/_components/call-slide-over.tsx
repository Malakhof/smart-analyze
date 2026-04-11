"use client"

import { useEffect, useState, useCallback } from "react"
import type { QcCallDetail } from "@/lib/queries/quality"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet"

/* ---------- helpers ---------- */

function fmtDate(date: string | Date): string {
  const d = new Date(date)
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

function fmtTime(date: string | Date): string {
  const d = new Date(date)
  return d.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function fmtDuration(seconds: number | null): string {
  if (!seconds) return "--:--"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

function isNegativeTag(tag: string): boolean {
  return tag.toLowerCase().startsWith("не ")
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

/* ---------- transcript parser ---------- */

interface TranscriptMessage {
  speaker: "operator" | "client"
  text: string
}

function parseTranscript(raw: string): TranscriptMessage[] {
  const messages: TranscriptMessage[] = []
  const lines = raw.split("\n").filter((l) => l.trim())

  for (const line of lines) {
    // Try patterns: "Оператор: ...", "Клиент: ...", "Менеджер: ..."
    const operatorMatch = line.match(
      /^(?:Оператор|Менеджер|Operator|Manager)\s*[:：]\s*(.*)/i
    )
    const clientMatch = line.match(
      /^(?:Клиент|Client|Customer)\s*[:：]\s*(.*)/i
    )

    if (operatorMatch) {
      messages.push({ speaker: "operator", text: operatorMatch[1].trim() })
    } else if (clientMatch) {
      messages.push({ speaker: "client", text: clientMatch[1].trim() })
    } else {
      // If no prefix, alternate or append to last
      if (messages.length > 0) {
        const lastSpeaker = messages[messages.length - 1].speaker
        messages.push({
          speaker: lastSpeaker === "operator" ? "client" : "operator",
          text: line.trim(),
        })
      } else {
        messages.push({ speaker: "operator", text: line.trim() })
      }
    }
  }

  return messages
}

/* ---------- collapsible section ---------- */

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border-t border-border-default">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-5 py-3 text-left text-[13px] font-semibold text-text-primary transition-colors hover:bg-surface-2"
      >
        <span>{title}</span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-text-tertiary transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && <div className="px-5 pb-4">{children}</div>}
    </div>
  )
}

/* ---------- main component ---------- */

interface CallSlideOverProps {
  callId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CallSlideOver({
  callId,
  open,
  onOpenChange,
}: CallSlideOverProps) {
  const [call, setCall] = useState<QcCallDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchCall = useCallback(async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/quality/call/${id}`)
      if (!res.ok) {
        throw new Error("Failed to load call")
      }
      const data = await res.json()
      setCall(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open && callId) {
      fetchCall(callId)
    }
    if (!open) {
      // Reset state when closing
      setCall(null)
      setError(null)
    }
  }, [open, callId, fetchCall])

  const doneCount = call?.scoreItems.filter((i) => i.isDone).length ?? 0

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-[480px] overflow-y-auto !max-w-[480px] p-0"
      >
        {/* Loading */}
        {loading && (
          <div className="flex h-full items-center justify-center">
            <div className="text-[13px] text-text-tertiary">Загрузка...</div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-5">
            <div className="text-[13px] text-red-400">{error}</div>
            <button
              onClick={() => callId && fetchCall(callId)}
              className="rounded-lg border border-border-default bg-surface-2 px-3 py-1.5 text-[12px] text-text-secondary hover:text-text-primary"
            >
              Повторить
            </button>
          </div>
        )}

        {/* Content */}
        {call && !loading && (
          <>
            {/* Header */}
            <SheetHeader className="border-b border-border-default p-5">
              <div className="flex items-center justify-between">
                <SheetTitle className="text-[15px] font-bold text-text-primary">
                  <button
                    onClick={() => onOpenChange(false)}
                    className="mr-2 text-text-tertiary hover:text-text-primary"
                  >
                    &larr;
                  </button>
                  {call.type === "CHAT" ? "Переписка" : "Звонок"} {call.crmId ?? call.id.slice(0, 8)}
                </SheetTitle>
                {call.crmId && (
                  <SheetDescription className="text-[12px] text-ai-1 hover:underline">
                    ссылка на CRM
                  </SheetDescription>
                )}
              </div>

              {/* Date / Time / Duration */}
              <div className="mt-2 flex items-center gap-3 text-[12px] text-text-secondary">
                <span>Дата: {fmtDate(call.createdAt)}</span>
                <span className="text-text-tertiary">|</span>
                <span>Время: {fmtTime(call.createdAt)}</span>
                <span className="text-text-tertiary">|</span>
                <span>Длительность: {fmtDuration(call.duration)}</span>
              </div>

              {/* Tags */}
              {call.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {call.tags.map((tag) => (
                    <span
                      key={tag}
                      className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                        isNegativeTag(tag)
                          ? "border-red-500/20 bg-red-500/15 text-red-400"
                          : "border-emerald-500/20 bg-emerald-500/15 text-emerald-400"
                      }`}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Category */}
              {call.category && (
                <div className="mt-2">
                  <span
                    className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${getCategoryBadgeClass(call.category)}`}
                  >
                    {call.category}
                  </span>
                </div>
              )}
            </SheetHeader>

            {/* Body */}
            <div className="flex-1">
              {/* Audio player */}
              <div className="border-b border-border-default px-5 py-4">
                <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
                  {call.type === "CHAT" ? "Переписка" : "Запись звонка"}
                </h4>
                {call.type === "CHAT" ? (
                  <div className="flex h-10 items-center justify-center rounded-lg bg-surface-2 text-[12px] text-text-tertiary">
                    Текстовая переписка
                  </div>
                ) : call.audioUrl ? (
                  <audio
                    controls
                    src={call.audioUrl}
                    className="w-full rounded-lg"
                    preload="none"
                  />
                ) : (
                  <div className="flex h-10 items-center justify-center rounded-lg bg-surface-2 text-[12px] text-text-tertiary">
                    Аудио недоступно
                  </div>
                )}
              </div>

              {/* Comment input (placeholder, non-functional) */}
              <div className="border-b border-border-default px-5 py-3">
                <input
                  type="text"
                  placeholder="Добавить комментарий..."
                  disabled
                  className="w-full rounded-lg border border-border-default bg-surface-2 px-3 py-2 text-[13px] text-text-tertiary placeholder:text-text-tertiary"
                />
              </div>

              {/* Summary */}
              {call.summary && (
                <div className="border-b border-border-default px-5 py-4">
                  <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
                    Резюме звонка
                  </h4>
                  <p className="text-[13px] leading-relaxed text-text-secondary">
                    {call.summary}
                  </p>
                </div>
              )}

              {/* Recommendation */}
              {call.recommendation && (
                <div className="border-b border-border-default px-5 py-4">
                  <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
                    Рекомендации по улучшению работы
                  </h4>
                  <p className="text-[13px] leading-relaxed text-text-secondary">
                    {call.recommendation}
                  </p>
                </div>
              )}

              {/* Transcript (collapsible) */}
              {call.transcript && (
                <CollapsibleSection title="Расшифровка разговора">
                  <div className="space-y-2">
                    {parseTranscript(call.transcript).map((msg, idx) => (
                      <div
                        key={idx}
                        className={`flex ${msg.speaker === "client" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-lg px-3 py-2 text-[12px] leading-relaxed ${
                            msg.speaker === "operator"
                              ? "bg-surface-2 text-text-primary"
                              : "bg-ai-glow text-ai-1"
                          }`}
                        >
                          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                            {msg.speaker === "operator"
                              ? "Оператор"
                              : "Клиент"}
                          </div>
                          {msg.text}
                        </div>
                      </div>
                    ))}
                  </div>
                </CollapsibleSection>
              )}

              {/* Script checklist (collapsible) */}
              {call.scoreItems.length > 0 && (
                <CollapsibleSection title="Выполнение скрипта">
                  {/* AI comments from score items */}
                  {call.scoreItems.some((si) => si.aiComment) && (
                    <p className="mb-3 text-[12px] leading-relaxed text-text-secondary">
                      {call.scoreItems
                        .filter((si) => si.aiComment)
                        .map((si) => si.aiComment)
                        .join(" ")}
                    </p>
                  )}

                  {/* Script steps table */}
                  <div className="overflow-hidden rounded-lg border border-border-default">
                    <table className="w-full border-collapse text-[12px]">
                      <thead>
                        <tr className="border-b border-border-default bg-surface-2">
                          <th className="px-3 py-2 text-left font-semibold text-text-tertiary">
                            Шаг скрипта
                          </th>
                          <th className="w-[80px] px-3 py-2 text-center font-semibold text-text-tertiary">
                            Выполнено
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {call.scoreItems.map((item) => (
                          <tr
                            key={item.id}
                            className="border-b border-border-default last:border-b-0"
                          >
                            <td className="px-3 py-2 text-text-primary">
                              {item.scriptItem.text}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span
                                className={`inline-block min-w-[24px] rounded px-1.5 py-0.5 text-[11px] font-bold ${
                                  item.isDone
                                    ? "bg-emerald-500/15 text-emerald-400"
                                    : "bg-red-500/15 text-red-400"
                                }`}
                              >
                                {item.isDone ? "1" : "0"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Total score */}
                  <div className="mt-3 text-right text-[13px] font-bold text-text-primary">
                    Общий балл: {doneCount}
                  </div>
                </CollapsibleSection>
              )}
            </div>

            {/* Footer */}
            <SheetFooter className="border-t border-border-default">
              <button
                onClick={() => onOpenChange(false)}
                className="w-full rounded-lg border border-border-default bg-surface-2 px-4 py-2.5 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-1 hover:text-text-primary"
              >
                Закрыть
              </button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
