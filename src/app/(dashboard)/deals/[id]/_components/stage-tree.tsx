"use client"

import { useState } from "react"
import type {
  DealDetailStage,
  DealDetailMessage,
} from "@/lib/queries/deal-detail"

interface StageTreeProps {
  stages: DealDetailStage[]
  messages: DealDetailMessage[]
}

const STAGE_COLORS = [
  "#7C6AEF",
  "#5B8DEF",
  "#4ECDC4",
  "#34D399",
  "#FBBF24",
  "#F59E0B",
  "#EC4899",
  "#F87171",
  "#A78BFA",
  "#60A5FA",
]

function fmtDateTime(date: Date): string {
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }) +
    ", " +
    date.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    })
}

function fmtShortDateTime(date: Date): string {
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  }) +
    " " +
    date.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    })
}

function fmtDuration(days: number | null): string {
  if (days === null || days === undefined) return "0 сек"
  if (days < 0.01) return "0 сек"
  return `${days.toFixed(1)} дн`
}

export function StageTree({ stages, messages }: StageTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  if (!stages || stages.length === 0) {
    return (
      <div className="rounded-[10px] border border-border-default bg-surface-1 p-8 text-center">
        <p className="text-text-tertiary">Нет данных по этапам сделки</p>
        <p className="text-sm text-text-muted mt-1">Этапы появятся после синхронизации с CRM</p>
      </div>
    )
  }

  function toggle(stageId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(stageId)) {
        next.delete(stageId)
      } else {
        next.add(stageId)
      }
      return next
    })
  }

  function getStageMessages(stage: DealDetailStage): DealDetailMessage[] {
    const start = new Date(stage.enteredAt).getTime()
    const end = stage.leftAt
      ? new Date(stage.leftAt).getTime()
      : Infinity

    return messages.filter((m) => {
      const t = new Date(m.timestamp).getTime()
      return t >= start && t < end
    })
  }

  return (
    <div className="rounded-[10px] border border-border-default bg-surface-1 p-6 shadow-[var(--card-shadow)]">
      <h3 className="mb-5 text-[15px] font-bold">Дерево этапов</h3>

      <div className="relative">
        {/* Vertical line */}
        {stages.length > 1 && (
          <div
            className="absolute left-[4px] top-[10px] w-[2px]"
            style={{
              height: `calc(100% - 20px)`,
              background: `linear-gradient(to bottom, ${STAGE_COLORS[0]}, ${STAGE_COLORS[Math.min(stages.length - 1, STAGE_COLORS.length - 1)]})`,
            }}
          />
        )}

        <div className="space-y-0">
          {stages.map((stage, idx) => {
            const isOpen = expanded.has(stage.id)
            const color =
              STAGE_COLORS[idx % STAGE_COLORS.length]
            const stageMessages = getStageMessages(stage)

            return (
              <div
                key={stage.id}
                id={`stage-${stage.id}`}
                className="relative pl-7"
              >
                {/* Dot */}
                <div
                  className="absolute left-0 top-[6px] h-[10px] w-[10px] rounded-full"
                  style={{ backgroundColor: color }}
                />

                {/* Stage header - clickable */}
                <button
                  onClick={() => toggle(stage.id)}
                  className="w-full text-left pb-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[13px] font-bold text-text-primary">
                        ЭТАП {idx + 1}: {stage.stageName}
                      </div>
                      <div className="mt-0.5 text-[11px] text-text-tertiary">
                        {fmtDateTime(new Date(stage.enteredAt))}
                        {stage.leftAt &&
                          ` – ${fmtDateTime(new Date(stage.leftAt))}`}
                      </div>
                      <div className="mt-0.5 text-[11px] text-text-tertiary">
                        Длительность: {fmtDuration(stage.duration)}
                      </div>
                    </div>
                    <span className="mt-0.5 shrink-0 text-[11px] text-text-tertiary">
                      {isOpen ? "▴" : "▾"}
                    </span>
                  </div>
                </button>

                {/* Expanded messages */}
                {isOpen && stageMessages.length > 0 && (
                  <div className="mb-4 ml-1 space-y-2.5">
                    {stageMessages.map((msg) => {
                      const isManager = msg.sender === "MANAGER"
                      return (
                        <div
                          key={msg.id}
                          className={`rounded-[6px] border-l-2 bg-surface-2 px-4 py-2.5 ${
                            isManager
                              ? "border-l-ai-1"
                              : "border-l-status-green"
                          }`}
                        >
                          <div className="mb-1 flex items-center gap-2 text-[11px]">
                            {isManager ? (
                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-ai-1 to-ai-2 text-[8px] font-bold text-white">
                                М
                              </span>
                            ) : (
                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-status-green-dim text-[8px] font-bold text-status-green">
                                К
                              </span>
                            )}
                            <span className="font-semibold text-text-primary">
                              {isManager ? "Менеджер" : "Клиент"}
                            </span>
                            <span className="text-text-tertiary">
                              {fmtShortDateTime(new Date(msg.timestamp))}
                            </span>
                            {msg.isAudio && (
                              <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[9px] text-text-tertiary">
                                Аудио
                              </span>
                            )}
                          </div>
                          <p className="text-[12px] leading-relaxed text-text-secondary">
                            {msg.content}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                )}

                {isOpen && stageMessages.length === 0 && (
                  <div className="mb-4 ml-1 text-[12px] text-text-tertiary">
                    Нет сообщений на этом этапе
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
