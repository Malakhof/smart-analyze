import type { LostStageData } from "@/lib/queries/manager-detail"

interface DealLossAnalysisProps {
  lostStages: LostStageData[]
}

export function DealLossAnalysis({ lostStages }: DealLossAnalysisProps) {
  const hasData = lostStages.length > 0
  const maxCount = hasData ? Math.max(...lostStages.map((s) => s.count)) : 0

  return (
    <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]">
      <h4 className="mb-4 text-[14px] font-bold text-text-primary">
        Где теряются сделки
      </h4>

      {!hasData ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <span className="mb-2 text-[28px]">&#x2705;</span>
          <span className="text-[13px] text-text-tertiary">
            Проблемных этапов нет / Нет данных о потерях на этапах
          </span>
        </div>
      ) : (
        <div className="space-y-3">
          {lostStages.map((stage) => {
            const pct = maxCount > 0 ? (stage.count / maxCount) * 100 : 0
            return (
              <div key={stage.stageName}>
                <div className="mb-1 flex items-center justify-between text-[12px]">
                  <span className="text-text-secondary">{stage.stageName}</span>
                  <span className="font-semibold text-text-primary tabular-nums">
                    {stage.count}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-surface-3">
                  <div
                    className="h-2 rounded-full bg-status-red transition-all duration-300"
                    style={{ width: `${pct}%` }}
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
