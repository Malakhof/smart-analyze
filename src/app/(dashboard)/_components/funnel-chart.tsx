import { fmtPercent, fmtDays } from "@/lib/format"
import { FunnelSwitcher } from "./funnel-switcher"

interface FunnelStageData {
  id: string
  name: string
  order: number
  dealCount: number
  conversion: number
  avgTime: number
}

interface FunnelOption {
  id: string
  name: string
  dealCount: number
}

interface FunnelChartProps {
  stages: FunnelStageData[]
  funnels?: FunnelOption[]
  selectedFunnelId?: string
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

export function FunnelChart({
  stages,
  funnels,
  selectedFunnelId,
}: FunnelChartProps) {
  const maxDeals = Math.max(...stages.map((s) => s.dealCount), 1)
  const showSelector = (funnels?.length ?? 0) > 1

  return (
    <div className="mb-9">
      <div className="mb-3.5 flex items-center justify-between gap-2">
        <div className="text-[13px] font-semibold text-text-secondary">
          Воронка продаж
        </div>
        {showSelector && (
          <FunnelSwitcher
            funnels={funnels!}
            selectedId={selectedFunnelId}
          />
        )}
      </div>
      <div
        className="grid gap-2 overflow-x-auto pb-1"
        style={{
          gridTemplateColumns: `repeat(${Math.max(stages.length, 1)}, minmax(120px, 1fr))`,
        }}
      >
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
              <div
                className="mb-2 text-[11px] font-medium text-text-tertiary line-clamp-2 min-h-[28px]"
                title={stage.name}
              >
                {stage.name}
              </div>
              <div
                className={`text-[20px] font-bold tracking-[-0.03em] leading-tight ${getConversionColor(stage.conversion)}`}
              >
                {fmtPercent(stage.conversion)}
              </div>
              <div className="mt-1 text-[10px] text-text-muted">
                {stage.dealCount} {stage.dealCount === 1 ? "сделка" : stage.dealCount < 5 ? "сделки" : "сделок"}
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
