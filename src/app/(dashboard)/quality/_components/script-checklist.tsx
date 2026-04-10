function scoreColor(score: number): string {
  if (score >= 80) return "text-status-green"
  if (score >= 50) return "text-status-amber"
  return "text-status-red"
}

function scoreBg(score: number): string {
  if (score >= 80) return "bg-status-green-dim"
  if (score >= 50) return "bg-status-amber-dim"
  return "bg-status-red-dim"
}

interface ScoreItem {
  id: string
  isDone: boolean
  aiComment: string | null
  scriptItem: {
    text: string
    isCritical: boolean
    order: number
  }
}

interface ScriptChecklistProps {
  items: ScoreItem[]
  totalScore: number | null
}

export function ScriptChecklist({ items, totalScore }: ScriptChecklistProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)]">
        <div className="text-[13px] text-text-tertiary">
          Оценка по скрипту недоступна
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-[10px] border border-border-default bg-surface-1 shadow-[var(--card-shadow)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-default px-5 py-4">
        <h3 className="text-[15px] font-bold tracking-[-0.02em]">
          Оценка по скрипту
        </h3>
        {totalScore != null && (
          <span
            className={`rounded-full px-3 py-1 text-[13px] font-bold ${scoreBg(totalScore)} ${scoreColor(totalScore)}`}
          >
            {Math.round(totalScore)}%
          </span>
        )}
      </div>

      {/* Items */}
      <div className="divide-y divide-border-default">
        {items.map((item) => (
          <div key={item.id} className="px-5 py-3.5">
            <div className="flex items-start gap-3">
              {/* Icon */}
              <span className="mt-0.5 shrink-0 text-[16px]">
                {item.isDone ? (
                  <span className="text-status-green">&#10003;</span>
                ) : (
                  <span className="text-status-red">&#10007;</span>
                )}
              </span>

              <div className="min-w-0 flex-1">
                {/* Item text + critical badge */}
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[13px] font-medium ${item.isDone ? "text-text-primary" : "text-status-red"}`}
                  >
                    {item.scriptItem.text}
                  </span>
                  {item.scriptItem.isCritical && !item.isDone && (
                    <span className="shrink-0 rounded bg-status-red-dim px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-status-red">
                      Критично
                    </span>
                  )}
                </div>

                {/* AI comment */}
                {item.aiComment && (
                  <div className="mt-1.5 flex items-start gap-1.5">
                    <span className="mt-[1px] shrink-0 text-[10px] text-ai-1">
                      AI:
                    </span>
                    <p className="text-[12px] leading-relaxed text-text-secondary">
                      {item.aiComment}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
