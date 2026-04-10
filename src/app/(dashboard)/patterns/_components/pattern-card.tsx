"use client"

import { useState } from "react"
import { ChipBadge } from "@/components/chip-badge"
import { QuoteBlock } from "@/components/quote-block"
import type { PatternData } from "@/lib/queries/patterns"

interface PatternCardProps {
  pattern: PatternData
}

function strengthLabel(value: number): string {
  if (value >= 70) return "Сильный"
  if (value >= 40) return "Умеренный"
  return "Шум"
}

function reliabilityLabel(value: number): string {
  if (value >= 85) return "У всех"
  if (value >= 60) return "Стабильный"
  return "Нестабильный"
}

function coverageLabel(value: number): string {
  if (value >= 60) return "Массовый"
  if (value >= 30) return "Средний"
  return "С нарушением"
}

export function PatternCard({ pattern }: PatternCardProps) {
  const [open, setOpen] = useState(false)

  const isSuccess = pattern.type === "SUCCESS"
  const color = isSuccess ? "text-status-green" : "text-status-red"
  const borderColor = isSuccess
    ? "border-t-status-green"
    : "border-t-status-red"
  const typeLabel = isSuccess ? "Паттерн успеха" : "Паттерн провала"
  const impactPrefix = pattern.impact > 0 ? "+" : ""

  return (
    <div
      className={`overflow-hidden rounded-[10px] border border-border-default border-t-2 ${borderColor} bg-surface-1 shadow-[var(--card-shadow)] transition-shadow hover:shadow-[var(--card-shadow-hover)]`}
    >
      {/* Header */}
      <div className="p-5">
        <div
          className={`mb-2 text-[11px] font-bold uppercase tracking-[0.08em] ${color}`}
        >
          {typeLabel}
        </div>
        <div className="mb-4 text-[13px] leading-relaxed text-text-secondary">
          {pattern.title}
        </div>

        {/* 4 metrics */}
        <div className="grid grid-cols-4 gap-3">
          <div>
            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
              Сила
            </div>
            <div className={`text-[18px] font-bold leading-none ${color}`}>
              {pattern.strength}
            </div>
            <div className="mt-0.5 text-[10px] text-text-tertiary">
              {strengthLabel(pattern.strength)}
            </div>
          </div>
          <div>
            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
              Влияние
            </div>
            <div className={`text-[18px] font-bold leading-none ${color}`}>
              {impactPrefix}
              {pattern.impact.toFixed(1)}
            </div>
            <div className="mt-0.5 text-[10px] text-text-tertiary">п.п.</div>
          </div>
          <div>
            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
              Надёжность
            </div>
            <div className="text-[18px] font-bold leading-none text-text-primary">
              {pattern.reliability}%
            </div>
            <div className="mt-0.5 text-[10px] text-text-tertiary">
              {reliabilityLabel(pattern.reliability)}
            </div>
          </div>
          <div>
            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
              Охват
            </div>
            <div className="text-[18px] font-bold leading-none text-text-primary">
              {pattern.coverage.toFixed(1)}%
            </div>
            <div className="mt-0.5 text-[10px] text-text-tertiary">
              {coverageLabel(pattern.coverage)}
            </div>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex gap-7 border-t border-border-default bg-surface-2 px-5 py-2.5">
        <div className="text-[11px] text-text-tertiary">
          Сделок{" "}
          <strong className="block text-[14px] font-bold text-text-primary">
            {pattern.dealCount}
          </strong>
        </div>
        <div className="text-[11px] text-text-tertiary">
          Менеджеров{" "}
          <strong className="block text-[14px] font-bold text-text-primary">
            {pattern.managerCount}
          </strong>
        </div>
      </div>

      {/* Expandable body */}
      <div className="border-t border-border-default">
        <button
          onClick={() => setOpen(!open)}
          className="flex w-full items-center gap-1.5 px-5 py-3 text-left transition-colors hover:bg-surface-2"
        >
          <span className="text-[12px] font-semibold">
            <span className="ai-grad">AI</span> Описание
          </span>
          <svg
            className={`ml-auto h-4 w-4 text-text-tertiary transition-transform ${open ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        {open && (
          <div className="px-5 pb-5">
            <p className="mb-4 text-[13px] leading-[1.7] text-text-secondary">
              {pattern.description}
            </p>

            {/* Deals */}
            {pattern.deals.length > 0 && (
              <div className="mb-3">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
                  Список сделок где встречается:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {pattern.deals.map((d) => (
                    <ChipBadge
                      key={d.id}
                      label={`#${d.crmId ?? d.id.slice(0, 6)}`}
                      href={`/deals/${d.id}`}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Managers */}
            {pattern.managers.length > 0 && (
              <div className="mb-3">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
                  Список менеджеров:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {pattern.managers.map((m) => (
                    <ChipBadge
                      key={m.id}
                      label={m.name}
                      href={`/managers/${m.id}`}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Quotes */}
            {pattern.quotes.length > 0 && (
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
                  Список цитат:
                </div>
                <div className="space-y-1.5">
                  {pattern.quotes.map((q, i) => (
                    <QuoteBlock
                      key={i}
                      text={q.text}
                      dealCrmId={q.dealCrmId}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
