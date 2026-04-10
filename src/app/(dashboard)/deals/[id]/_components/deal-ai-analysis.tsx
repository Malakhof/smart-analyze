interface DealAiAnalysisProps {
  summary: string
}

export function DealAiAnalysis({ summary }: DealAiAnalysisProps) {
  return (
    <div className="rounded-[10px] border border-ai-border bg-surface-1 p-6 shadow-[var(--card-shadow)]">
      <div className="mb-3 flex items-center gap-2.5">
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[11px] font-bold text-white"
          style={{ background: "var(--ai-grad)" }}
        >
          AI
        </div>
        <span className="text-[15px] font-bold">AI-анализ сделки</span>
      </div>
      <p className="text-[13px] leading-relaxed text-text-secondary">
        {summary}
      </p>
    </div>
  )
}
