"use client"

import { useMemo, useState } from "react"
import type {
  DealDetailFunnel,
  DealDetailFunnelStage,
  DealDetailMessage,
  DealDetailStage,
} from "@/lib/queries/deal-detail"
import { fmtPercent } from "@/lib/format"

interface FunnelTimelineProps {
  funnel: DealDetailFunnel
  stageHistory: DealDetailStage[]
  messages: DealDetailMessage[]
  dealCreatedAt: Date
  dealClosedAt?: Date | null
}

const MIN_AUDIO_SECONDS = 60 // hide noise: short auto-pickup / "не дозвонился"

function fmtDateTime(d: Date): string {
  return (
    d.toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }) +
    ", " +
    d.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    })
  )
}

function fmtShortDateTime(d: Date): string {
  return (
    d.toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
    }) +
    " " +
    d.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    })
  )
}

function fmtDuration(days: number | null): string {
  if (days === null || days === undefined || days < 0.01) return "—"
  if (days < 1) return `${Math.round(days * 24 * 60)} мин`
  return `${days.toFixed(1)} дн`
}

function getConvColor(c: number): string {
  if (c >= 60) return "text-status-green"
  if (c >= 40) return "text-status-amber"
  return "text-status-red"
}

interface AnchoredMessage {
  message: DealDetailMessage
  /** Stage crmId where this message was anchored (or null if not in any window) */
  stageCrmId: string | null
}

/**
 * Anchor each message to a stage based on stageHistory time windows.
 * If we have stageHistory entries — use [enteredAt, leftAt) windows.
 * Otherwise (synthesized history) — anchor everything to current stage.
 */
function anchorMessages(
  messages: DealDetailMessage[],
  history: DealDetailStage[],
  funnelStages: DealDetailFunnelStage[]
): {
  byStage: Record<string, DealDetailMessage[]>
  unanchored: DealDetailMessage[]
} {
  const byStage: Record<string, DealDetailMessage[]> = {}

  if (history.length === 0) {
    return { byStage, unanchored: messages }
  }

  // Map historical stageId → funnelStage.crmId
  const stageIdToCrmId = new Map<string, string>()
  for (const fs of funnelStages) {
    if (fs.crmId) stageIdToCrmId.set(fs.id, fs.crmId)
  }

  // Build (stageCrmId, start, end) windows in chronological order
  const sortedHistory = [...history].sort(
    (a, b) =>
      new Date(a.enteredAt).getTime() - new Date(b.enteredAt).getTime()
  )
  const windows = sortedHistory.map((h, i) => {
    const next = sortedHistory[i + 1]
    return {
      crmId: stageIdToCrmId.get(h.stageId) ?? null,
      start: new Date(h.enteredAt).getTime(),
      end: h.leftAt
        ? new Date(h.leftAt).getTime()
        : next
          ? new Date(next.enteredAt).getTime()
          : Infinity,
    }
  })

  const unanchored: DealDetailMessage[] = []
  for (const m of messages) {
    const t = new Date(m.timestamp).getTime()
    const win = windows.find((w) => t >= w.start && t < w.end)
    if (win?.crmId) {
      ;(byStage[win.crmId] ??= []).push(m)
    } else {
      unanchored.push(m)
    }
  }
  return { byStage, unanchored }
}

function shouldKeepMessage(m: DealDetailMessage): boolean {
  if (m.sender === "SYSTEM") return false
  if (m.isAudio) {
    // Hide tiny audio (auto-greetings, "не дозвонился") unless we have content/transcript
    if (!m.content?.trim() && (m.duration ?? 0) < MIN_AUDIO_SECONDS) return false
    return true
  }
  return Boolean(m.content?.trim())
}

interface MessageBubbleProps {
  msg: DealDetailMessage
}

function MessageBubble({ msg }: MessageBubbleProps) {
  const isManager = msg.sender === "MANAGER"
  const minutes = Math.round((msg.duration ?? 0) / 60)
  return (
    <div
      className={`rounded-[6px] border-l-2 bg-surface-2 px-3 py-2 ${
        isManager ? "border-l-ai-1" : "border-l-status-green"
      }`}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px]">
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold text-white ${
            isManager
              ? "bg-gradient-to-br from-ai-1 to-ai-2"
              : "bg-status-green-dim text-status-green"
          }`}
        >
          {isManager ? "М" : "К"}
        </span>
        <span className="font-semibold text-text-primary">
          {isManager ? "Менеджер" : "Клиент"}
        </span>
        <span className="text-text-tertiary">
          {fmtShortDateTime(new Date(msg.timestamp))}
        </span>
        {msg.isAudio && (
          <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[9px] text-text-tertiary">
            Аудио {minutes ? `${minutes} мин` : ""}
          </span>
        )}
      </div>
      {msg.content?.trim() ? (
        <p className="text-[12px] leading-relaxed text-text-secondary whitespace-pre-wrap">
          {msg.content}
        </p>
      ) : msg.isAudio ? (
        <p className="text-[11px] italic text-text-muted">
          Транскрипт ещё не готов
        </p>
      ) : null}
    </div>
  )
}

export function FunnelTimeline({
  funnel,
  stageHistory,
  messages,
  dealCreatedAt,
  dealClosedAt,
}: FunnelTimelineProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const filteredMessages = useMemo(
    () => messages.filter(shouldKeepMessage),
    [messages]
  )
  const { byStage, unanchored } = useMemo(
    () => anchorMessages(filteredMessages, stageHistory, funnel.stages),
    [filteredMessages, stageHistory, funnel.stages]
  )

  function toggle(stageId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(stageId)) next.delete(stageId)
      else next.add(stageId)
      return next
    })
  }

  // Build per-stage history info (when entered/left/duration) keyed by crmId
  const historyByCrmId = new Map<
    string,
    { enteredAt: Date; leftAt: Date | null; duration: number | null }
  >()
  for (const h of stageHistory) {
    const fs = funnel.stages.find((s) => s.id === h.stageId)
    if (fs?.crmId) {
      historyByCrmId.set(fs.crmId, {
        enteredAt: h.enteredAt,
        leftAt: h.leftAt,
        duration: h.duration,
      })
    }
  }

  const visitedCount = funnel.stages.filter((s) => s.wasVisited).length
  const current = funnel.stages.find((s) => s.isCurrent)

  return (
    <div className="rounded-[10px] border border-border-default bg-surface-1 p-6 shadow-[var(--card-shadow)]">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-bold">
          Воронка: {funnel.name}
        </h3>
        <span className="text-[11px] text-text-tertiary">
          Сделка прошла {visitedCount} из {funnel.stages.length} этапов
          {current ? ` · сейчас: ${current.name}` : ""}
        </span>
      </div>

      {stageHistory.length === 0 && (
        <p className="mb-4 text-[11px] text-status-amber">
          ⚠ История переходов между этапами не сохранилась — события показаны
          ниже в хронологическом порядке.
        </p>
      )}

      <div className="relative mt-4">
        {/* Vertical line connecting dots */}
        {funnel.stages.length > 1 && (
          <div className="absolute left-[5px] top-2 bottom-2 w-px bg-border-default" />
        )}

        <div className="space-y-1">
          {funnel.stages.map((stage, idx) => {
            const isOpen = expanded.has(stage.id)
            const stageMsgs = stage.crmId ? byStage[stage.crmId] ?? [] : []
            const hist = stage.crmId ? historyByCrmId.get(stage.crmId) : null
            const dim = !stage.wasVisited && !stage.isCurrent

            const dotColor = stage.isCurrent
              ? "bg-ai-1 ring-2 ring-ai-1/30"
              : stage.wasVisited
                ? "bg-status-green"
                : "bg-surface-3"

            return (
              <div
                key={stage.id}
                id={`stage-${stage.id}`}
                className={`relative pl-7 ${dim ? "opacity-55" : ""}`}
              >
                <div
                  className={`absolute left-[2px] top-3 h-[10px] w-[10px] rounded-full ${dotColor}`}
                />
                <button
                  type="button"
                  onClick={() => toggle(stage.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-[6px] px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-text-tertiary">
                        ЭТАП {idx + 1}
                      </span>
                      <span className="text-[13px] font-semibold text-text-primary">
                        {stage.name}
                      </span>
                      {stage.isCurrent && (
                        <span className="rounded bg-ai-1/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-ai-1">
                          Сейчас
                        </span>
                      )}
                      {stage.wasVisited && !stage.isCurrent && (
                        <span className="rounded bg-status-green-dim px-1.5 py-0.5 text-[9px] font-bold uppercase text-status-green">
                          Пройден
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-3 text-[11px] text-text-tertiary">
                      <span className={getConvColor(stage.conversion)}>
                        {fmtPercent(stage.conversion)} конверсия
                      </span>
                      <span>·</span>
                      <span>{stage.totalDeals} сделок в этапе</span>
                      {hist && (
                        <>
                          <span>·</span>
                          <span>
                            {fmtDateTime(new Date(hist.enteredAt))}
                            {hist.leftAt
                              ? ` – ${fmtDateTime(new Date(hist.leftAt))}`
                              : " – сейчас"}
                          </span>
                          <span>·</span>
                          <span>{fmtDuration(hist.duration)}</span>
                        </>
                      )}
                      {stageMsgs.length > 0 && (
                        <>
                          <span>·</span>
                          <span className="text-text-secondary">
                            {stageMsgs.length} соб.
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] text-text-tertiary">
                    {isOpen ? "▴" : "▾"}
                  </span>
                </button>

                {isOpen && (
                  <div className="ml-2 mt-2 mb-3 space-y-2">
                    {stageMsgs.length > 0 ? (
                      stageMsgs.map((msg) => (
                        <MessageBubble key={msg.id} msg={msg} />
                      ))
                    ) : (
                      <div className="text-[11px] italic text-text-muted">
                        {stage.wasVisited || stage.isCurrent
                          ? "Нет сообщений на этом этапе"
                          : "Сделка не доходила до этого этапа"}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {unanchored.length > 0 && (
        <div className="mt-6 border-t border-border-default pt-4">
          <h4 className="mb-3 text-[13px] font-semibold text-text-primary">
            Хронология событий ({unanchored.length})
          </h4>
          <p className="mb-3 text-[11px] text-text-tertiary">
            События не привязаны к этапам — показаны в хронологическом порядке
          </p>
          <div className="space-y-2">
            {[...unanchored]
              .sort(
                (a, b) =>
                  new Date(a.timestamp).getTime() -
                  new Date(b.timestamp).getTime()
              )
              .map((msg) => (
                <MessageBubble key={msg.id} msg={msg} />
              ))}
          </div>
        </div>
      )}

      <div className="mt-5 border-t border-border-default pt-3 text-[10px] text-text-muted">
        Сделка создана {fmtDateTime(new Date(dealCreatedAt))}
        {dealClosedAt
          ? ` · закрыта ${fmtDateTime(new Date(dealClosedAt))}`
          : ""}
      </div>
    </div>
  )
}
