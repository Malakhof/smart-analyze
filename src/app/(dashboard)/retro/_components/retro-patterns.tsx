import type { PatternData } from "@/lib/queries/patterns"

interface RetroPatternsProps {
  patterns: PatternData[]
}

/**
 * Compact pattern grid for retro page — title + short description + strength
 * meter only. NO quotes accordion (those overwhelm the page; check /patterns
 * for full quote drill-down).
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
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {patterns.map((p) => (
        <div
          key={p.id}
          className="rounded-[10px] border border-border-default bg-surface-1 p-4"
        >
          <div className="mb-1 flex items-start justify-between gap-2">
            <span
              className={`text-[10px] font-bold uppercase tracking-[0.05em] ${
                p.type === "SUCCESS"
                  ? "text-status-green"
                  : "text-status-red"
              }`}
            >
              {p.type === "SUCCESS" ? "✓ Успех" : "! Провал"}
            </span>
          </div>
          <div className="mb-2 text-[14px] font-semibold leading-snug text-text-primary">
            {p.title}
          </div>
          {p.description && (
            <p className="text-[12px] leading-[1.5] text-text-secondary">
              {p.description.length > 200
                ? p.description.slice(0, 200) + "…"
                : p.description}
            </p>
          )}
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className={`h-full ${
                p.type === "SUCCESS"
                  ? "bg-status-green"
                  : "bg-status-red"
              }`}
              style={{ width: `${Math.min(100, p.strength)}%` }}
            />
          </div>
          <div className="mt-1 text-right text-[10px] text-text-muted">
            сила {Math.round(p.strength)}%
          </div>
        </div>
      ))}
    </div>
  )
}
