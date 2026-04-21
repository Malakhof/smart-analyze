import { PatternCard } from "@/app/(dashboard)/patterns/_components/pattern-card"
import type { PatternData } from "@/lib/queries/patterns"

interface RetroPatternsProps {
  patterns: PatternData[]
}

/**
 * 3x3 grid of the strongest patterns we found across all deals.
 * Re-uses the existing PatternCard so styling stays in sync with the
 * dedicated /patterns page.
 */
export function RetroPatterns({ patterns }: RetroPatternsProps) {
  if (patterns.length === 0) {
    return (
      <div className="rounded-[10px] border border-border-default bg-surface-1 p-6 text-[13px] text-text-tertiary">
        Паттерны ещё не сгенерированы.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {patterns.map((p) => (
        <PatternCard key={p.id} pattern={p} />
      ))}
    </div>
  )
}
