"use client"

import { useState } from "react"

interface QcTranscriptToggleProps {
  transcript: string | null
  transcriptRepaired: string | null
}

/** Approximate word-level diff: count tokens that don't match positionally. */
function countChangedWords(a: string, b: string): number {
  const wa = a.trim().split(/\s+/).filter(Boolean)
  const wb = b.trim().split(/\s+/).filter(Boolean)
  const max = Math.max(wa.length, wb.length)
  let diffs = 0
  for (let i = 0; i < max; i++) {
    if (wa[i] !== wb[i]) diffs++
  }
  return diffs
}

/**
 * Toggle "Оригинал / ИИ-улучшенный" for the transcript section.
 * Default mode: "repaired" if non-null, otherwise "original".
 * When only one variant exists the toggle is rendered disabled so the user
 * understands why no switch is happening.
 */
export function QcTranscriptToggle({
  transcript,
  transcriptRepaired,
}: QcTranscriptToggleProps) {
  const hasOriginal = !!transcript
  const hasRepaired = !!transcriptRepaired
  const bothExist = hasOriginal && hasRepaired

  const [mode, setMode] = useState<"original" | "repaired">(
    hasRepaired ? "repaired" : "original"
  )

  const visible =
    mode === "repaired"
      ? (transcriptRepaired ?? transcript ?? "")
      : (transcript ?? transcriptRepaired ?? "")

  if (!visible) return null

  const changedWords = bothExist
    ? countChangedWords(transcript!, transcriptRepaired!)
    : 0

  return (
    <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
          Транскрипция
        </h3>
        <div className="flex items-center gap-3">
          {bothExist && changedWords > 0 && (
            <span className="text-[11px] text-text-tertiary">
              {changedWords}{" "}
              {wordWord(changedWords)} исправлено
            </span>
          )}
          <div
            className={`inline-flex gap-0.5 rounded-[10px] bg-surface-2 p-[3px] ${
              bothExist ? "" : "opacity-50"
            }`}
            role="tablist"
            aria-label="Версия транскрипта"
          >
            {(
              [
                { label: "Оригинал", value: "original" as const, enabled: hasOriginal },
                {
                  label: "ИИ-улучшенный",
                  value: "repaired" as const,
                  enabled: hasRepaired,
                },
              ]
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="tab"
                aria-selected={mode === opt.value}
                disabled={!opt.enabled || !bothExist}
                onClick={() => opt.enabled && setMode(opt.value)}
                className={`cursor-pointer rounded-[6px] border-none px-2.5 py-[5px] text-[11.5px] font-medium transition-all duration-[0.18s] disabled:cursor-not-allowed ${
                  mode === opt.value
                    ? "bg-surface-4 text-text-primary shadow-[0_1px_2px_rgba(0,0,0,0.06)] dark:shadow-none"
                    : "bg-transparent text-text-tertiary hover:text-text-secondary"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-text-secondary">
        {visible}
      </div>
    </div>
  )
}

function wordWord(n: number): string {
  const lastTwo = n % 100
  const lastOne = n % 10
  if (lastTwo >= 11 && lastTwo <= 14) return "слов"
  if (lastOne === 1) return "слово"
  if (lastOne >= 2 && lastOne <= 4) return "слова"
  return "слов"
}
