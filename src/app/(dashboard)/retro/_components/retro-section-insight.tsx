import type { InsightWithDetails } from "@/lib/queries/dashboard"

interface RetroSectionInsightProps {
  insight: InsightWithDetails | null
  fallback?: string
}

/**
 * Renders a single per-section AI summary block: the AI-generated markdown
 * paragraph that distills "what we found" for one section (deals/calls/etc.).
 */
export function RetroSectionInsight({
  insight,
  fallback = "Анализ ещё не сгенерирован",
}: RetroSectionInsightProps) {
  if (!insight) {
    return (
      <div className="rounded-md border border-border-default bg-surface-2 p-5 text-[13px] text-text-tertiary">
        {fallback}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border-default bg-surface-1 p-6 shadow-[var(--card-shadow)]">
      <div className="mb-3 text-[13px] font-semibold uppercase tracking-[0.04em] text-text-secondary">
        AI-вывод
      </div>
      <MarkdownText text={insight.detailedDescription ?? insight.content} />
    </div>
  )
}

function MarkdownText({ text }: { text: string }) {
  const lines = text.split(/\r?\n/)
  return (
    <div className="space-y-1.5 text-[14px] leading-[1.7] text-text-primary">
      {lines.map((line, i) => {
        if (line.startsWith("### "))
          return (
            <div
              key={i}
              className="mt-3 text-[15px] font-semibold text-text-primary"
            >
              {line.slice(4)}
            </div>
          )
        if (line.startsWith("## "))
          return (
            <div
              key={i}
              className="mt-3 text-[16px] font-bold text-text-primary"
            >
              {line.slice(3)}
            </div>
          )
        if (line.startsWith("- "))
          return (
            <div key={i} className="ml-4">
              • {renderInline(line.slice(2))}
            </div>
          )
        if (/^\d+\.\s/.test(line))
          return (
            <div key={i} className="ml-4">
              {renderInline(line)}
            </div>
          )
        if (line.trim() === "") return <div key={i} className="h-2" />
        return <div key={i}>{renderInline(line)}</div>
      })}
    </div>
  )
}

function renderInline(line: string) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-text-primary">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    )
  )
}
