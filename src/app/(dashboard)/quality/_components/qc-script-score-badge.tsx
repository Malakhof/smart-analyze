"use client"

import { useEffect, useRef, useState } from "react"
import type { ScriptDetailsPayload } from "@/lib/queries/quality"

interface QcScriptScoreBadgeProps {
  score: number | null
  /** 22 by default — the script has 11 stages * 2 points each. */
  maxScore?: number
  details?: ScriptDetailsPayload | null
}

/**
 * Badge "X/22" with traffic-light color and an optional popover showing the
 * 11-stage breakdown. Click toggles the popover; outside-click closes it.
 *
 * Color thresholds (per spec):
 *   0..7  — red    (failing)
 *   8..15 — yellow (partial)
 *   16+   — green  (passing)
 *
 * When `score` is null, renders a muted "—/22" placeholder so the column
 * width stays consistent.
 */
export function QcScriptScoreBadge({
  score,
  maxScore = 22,
  details,
}: QcScriptScoreBadgeProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  // Null state — show muted placeholder; not interactive.
  if (score == null) {
    return (
      <span className="inline-flex items-center rounded-md border border-border-default bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold text-text-tertiary tabular-nums">
        —/{maxScore}
      </span>
    )
  }

  const colorClass =
    score <= 7
      ? "border-red-500/30 bg-red-500/15 text-red-400"
      : score <= 15
        ? "border-amber-500/30 bg-amber-500/15 text-amber-400"
        : "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"

  const stages = details?.stages ?? []
  const hasDetails = stages.length > 0

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (hasDetails) setOpen((v) => !v)
        }}
        title={hasDetails ? "Показать разбор по этапам" : undefined}
        className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums transition-opacity ${colorClass} ${
          hasDetails ? "cursor-pointer hover:opacity-80" : "cursor-default"
        }`}
      >
        {score}/{maxScore}
      </button>

      {open && hasDetails && (
        <div
          // Stop click inside popover from triggering the row's onClick.
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full z-50 mt-1 w-[300px] overflow-hidden rounded-[10px] border border-border-default bg-surface-1 shadow-lg"
        >
          <div className="border-b border-border-default bg-surface-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
            Разбор по этапам · {score}/{maxScore}
          </div>
          <ul className="max-h-[320px] overflow-y-auto">
            {stages.map((stage, idx) => {
              const stageMax = stage.maxScore || 2
              const ratio = stageMax > 0 ? stage.score / stageMax : 0
              const dotClass =
                ratio >= 1
                  ? "bg-emerald-500"
                  : ratio > 0
                    ? "bg-amber-400"
                    : "bg-red-500"
              return (
                <li
                  key={`${stage.name}-${idx}`}
                  className="border-b border-border-default px-3 py-2 last:border-b-0"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex items-center gap-2 text-[12px] text-text-primary">
                      <span
                        className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotClass}`}
                      />
                      {stage.name}
                    </span>
                    <span className="shrink-0 text-[11px] font-semibold text-text-secondary tabular-nums">
                      {stage.score}/{stageMax}
                    </span>
                  </div>
                  {stage.evidence && (
                    <p className="mt-1 pl-4 text-[11px] leading-snug text-text-tertiary">
                      «{stage.evidence}»
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
