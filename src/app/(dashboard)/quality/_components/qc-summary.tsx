function scoreColor(score: number): string {
  if (score >= 80) return "text-status-green"
  if (score >= 50) return "text-status-amber"
  return "text-status-red"
}

interface QcSummaryProps {
  totalCalls: number
  avgScore: number
  avgScriptCompliance: number
  criticalMisses: number
}

export function QcSummary({
  totalCalls,
  avgScore,
  avgScriptCompliance,
  criticalMisses,
}: QcSummaryProps) {
  const cards = [
    {
      label: "Всего звонков",
      value: String(totalCalls),
      color: "",
    },
    {
      label: "Средний балл",
      value: `${Math.round(avgScore)}%`,
      color: scoreColor(avgScore),
    },
    {
      label: "Выполнение скрипта",
      value: `${Math.round(avgScriptCompliance)}%`,
      color: scoreColor(avgScriptCompliance),
    },
    {
      label: "Критичные пропуски",
      value: String(criticalMisses),
      color: criticalMisses > 0 ? "text-status-red" : "",
    },
  ]

  return (
    <div className="mb-5 grid grid-cols-4 gap-2.5">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]"
        >
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
            {c.label}
          </div>
          <div
            className={`text-[26px] font-extrabold leading-none tracking-[-0.04em] ${c.color}`}
          >
            {c.value}
          </div>
        </div>
      ))}
    </div>
  )
}
