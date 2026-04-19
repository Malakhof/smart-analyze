"use client"

import { useState } from "react"
import type { DealDetailFunnel } from "@/lib/queries/deal-detail"
import { fmtPercent } from "@/lib/format"

interface DealFunnelMiniProps {
  funnel: DealDetailFunnel
}

function getConversionColor(c: number): string {
  if (c >= 60) return "text-status-green"
  if (c >= 40) return "text-status-amber"
  return "text-status-red"
}

function getBarColor(c: number): string {
  if (c >= 60) return "var(--status-green)"
  if (c >= 40) return "var(--status-amber)"
  return "var(--status-red)"
}

export function DealFunnelMini({ funnel }: DealFunnelMiniProps) {
  const [open, setOpen] = useState(false)
  const visited = funnel.stages.filter((s) => s.wasVisited)
  const current = funnel.stages.find((s) => s.isCurrent)
  const visitedCount = visited.length

  return (
    <div className="rounded-[10px] border border-border-default bg-surface-1 shadow-[var(--card-shadow)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left"
      >
        <div className="min-w-0">
          <div className="text-[15px] font-bold text-text-primary">
            Воронка: {funnel.name}
          </div>
          <div className="mt-0.5 truncate text-[12px] text-text-tertiary">
            Сделка прошла {visitedCount} из {funnel.stages.length} этапов
            {current ? ` · сейчас: ${current.name}` : ""}
          </div>
        </div>
        <span className="shrink-0 text-[12px] text-text-tertiary">
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open && (
        <div
          className="grid gap-2 border-t border-border-default p-5"
          style={{
            gridTemplateColumns: `repeat(${Math.max(funnel.stages.length, 1)}, minmax(0, 1fr))`,
          }}
        >
          {funnel.stages.map((stage) => {
            const dim = !stage.wasVisited && !stage.isCurrent
            return (
              <div
                key={stage.id}
                className={`relative overflow-hidden rounded-[8px] border bg-surface-2 px-3 py-3 text-center transition-opacity ${
                  stage.isCurrent
                    ? "border-ai-1 ring-1 ring-ai-1"
                    : "border-border-default"
                } ${dim ? "opacity-50" : ""}`}
                title={
                  stage.isCurrent
                    ? "Сделка сейчас здесь"
                    : stage.wasVisited
                      ? "Сделка прошла этот этап"
                      : "Сделка не доходила до этого этапа"
                }
              >
                <div className="mb-1 line-clamp-2 text-[10px] font-medium text-text-tertiary">
                  {stage.name}
                </div>
                <div
                  className={`text-[18px] font-bold tracking-[-0.03em] ${getConversionColor(stage.conversion)}`}
                >
                  {fmtPercent(stage.conversion)}
                </div>
                <div className="mt-0.5 text-[10px] text-text-muted">
                  {stage.totalDeals} сделок
                </div>
                {stage.isCurrent && (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-ai-1" />
                )}
                <div className="absolute bottom-0 left-0 right-0 h-0.5">
                  <div
                    style={{
                      width: `${Math.min(stage.conversion, 100)}%`,
                      height: "100%",
                      background: getBarColor(stage.conversion),
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
