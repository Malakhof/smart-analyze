import { fmtPercent, fmtDays } from "@/lib/format"

interface FunnelStageData {
  id: string
  name: string
  order: number
  dealCount: number
  conversion: number
  avgTime: number
}

interface FunnelChartProps {
  stages: FunnelStageData[]
}

function getConversionColor(conversion: number) {
  if (conversion >= 60) return "text-status-green"
  if (conversion >= 40) return "text-status-amber"
  return "text-status-red"
}

function getBarColor(conversion: number) {
  if (conversion >= 60) return "var(--status-green)"
  if (conversion >= 40) return "var(--status-amber)"
  return "var(--status-red)"
}

export function FunnelChart({ stages }: FunnelChartProps) {
  const maxDeals = Math.max(...stages.map((s) => s.dealCount), 1)

  return (
    <div className="mb-9">
      <div className="mb-3.5 flex items-center gap-2 text-[13px] font-semibold text-text-secondary">
        Воронка продаж
      </div>
      <div className="grid grid-cols-6 gap-2">
        {stages.map((stage) => {
          const barWidth =
            maxDeals > 0 ? (stage.dealCount / maxDeals) * 100 : 0

          return (
            <div
              key={stage.id}
              className="relative overflow-hidden rounded-[10px] border border-border-default bg-surface-1 px-3.5 py-4 text-center shadow-[var(--card-shadow)] transition-all duration-200 hover:-translate-y-px hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]"
            >
              {stage.conversion < 50 && (
                <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-status-red" />
              )}
              <div className="mb-2 text-[11px] font-medium text-text-tertiary">
                {stage.name}
              </div>
              <div
                className={`text-[22px] font-bold tracking-[-0.03em] ${getConversionColor(stage.conversion)}`}
              >
                {fmtPercent(stage.conversion)}
              </div>
              <div className="mt-1 text-[10px] text-text-muted">
                {fmtDays(stage.avgTime)}
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-0.5">
                <div
                  style={{
                    width: `${barWidth}%`,
                    height: "100%",
                    background: getBarColor(stage.conversion),
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
