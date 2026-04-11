import type { QcBestWorstManager } from "@/lib/queries/quality"

function scoreColor(score: number): string {
  if (score >= 80) return "text-status-green"
  if (score >= 50) return "text-status-amber"
  return "text-status-red"
}

function changeIndicator(value: number) {
  if (value === 0) return null
  const isPositive = value > 0
  return (
    <span
      className={`text-[13px] font-semibold ${
        isPositive ? "text-status-green" : "text-status-red"
      }`}
    >
      {isPositive ? "+" : ""}
      {value}
    </span>
  )
}

interface QcSummaryProps {
  totalCalls: number
  totalCallsChange: number
  avgScore: number
  avgScoreChange: number
  bestManager: QcBestWorstManager | null
  worstManager: QcBestWorstManager | null
}

export function QcSummary({
  totalCalls,
  totalCallsChange,
  avgScore,
  avgScoreChange,
  bestManager,
  worstManager,
}: QcSummaryProps) {
  return (
    <div className="mb-5 grid grid-cols-4 gap-2.5">
      {/* Card 1: Total calls */}
      <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
          Совершено звонков
        </div>
        <div className="flex items-baseline gap-2">
          <div className="text-[26px] font-extrabold leading-none tracking-[-0.04em]">
            {totalCalls}
          </div>
          {changeIndicator(totalCallsChange)}
        </div>
      </div>

      {/* Card 2: Avg score */}
      <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
          Средняя оценка отдела
        </div>
        <div className="flex items-baseline gap-2">
          <div
            className={`text-[26px] font-extrabold leading-none tracking-[-0.04em] ${scoreColor(avgScore)}`}
          >
            {avgScore}
          </div>
          {changeIndicator(avgScoreChange)}
        </div>
      </div>

      {/* Card 3: Best manager */}
      <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
          Лучший менеджер
        </div>
        {bestManager ? (
          <>
            <div className="mb-1 text-[14px] font-bold leading-tight text-text-primary">
              {bestManager.name}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-text-secondary">
              <span>
                Оценка:{" "}
                <span className={`font-semibold ${scoreColor(bestManager.score)}`}>
                  {bestManager.score}
                </span>
                {bestManager.scoreChange !== 0 && (
                  <span
                    className={`ml-1 font-semibold ${
                      bestManager.scoreChange > 0
                        ? "text-status-green"
                        : "text-status-red"
                    }`}
                  >
                    {bestManager.scoreChange > 0 ? "+" : ""}
                    {bestManager.scoreChange}
                  </span>
                )}
              </span>
              <span>
                Звонков:{" "}
                <span className="font-semibold">{bestManager.calls}</span>
                {bestManager.callsChange !== 0 && (
                  <span
                    className={`ml-1 font-semibold ${
                      bestManager.callsChange > 0
                        ? "text-status-green"
                        : "text-status-red"
                    }`}
                  >
                    {bestManager.callsChange > 0 ? "+" : ""}
                    {bestManager.callsChange}
                  </span>
                )}
              </span>
            </div>
          </>
        ) : (
          <div className="text-[13px] text-text-tertiary">Нет данных</div>
        )}
      </div>

      {/* Card 4: Worst manager */}
      <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
          Худший менеджер
        </div>
        {worstManager ? (
          <>
            <div className="mb-1 text-[14px] font-bold leading-tight text-text-primary">
              {worstManager.name}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-text-secondary">
              <span>
                Оценка:{" "}
                <span className={`font-semibold ${scoreColor(worstManager.score)}`}>
                  {worstManager.score}
                </span>
                {worstManager.scoreChange !== 0 && (
                  <span
                    className={`ml-1 font-semibold ${
                      worstManager.scoreChange > 0
                        ? "text-status-green"
                        : "text-status-red"
                    }`}
                  >
                    {worstManager.scoreChange > 0 ? "+" : ""}
                    {worstManager.scoreChange}
                  </span>
                )}
              </span>
              <span>
                Звонков:{" "}
                <span className="font-semibold">{worstManager.calls}</span>
                {worstManager.callsChange !== 0 && (
                  <span
                    className={`ml-1 font-semibold ${
                      worstManager.callsChange > 0
                        ? "text-status-green"
                        : "text-status-red"
                    }`}
                  >
                    {worstManager.callsChange > 0 ? "+" : ""}
                    {worstManager.callsChange}
                  </span>
                )}
              </span>
            </div>
          </>
        ) : (
          <div className="text-[13px] text-text-tertiary">Нет данных</div>
        )}
      </div>
    </div>
  )
}
