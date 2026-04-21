import type { InsightWithDetails } from "@/lib/queries/dashboard"
import { RetroSectionInsight } from "./retro-section-insight"

/** Главный вывод аудита — крупный outlined блок сверху страницы. */
export function RetroMasterInsight({
  insight,
}: {
  insight: InsightWithDetails
}) {
  return (
    <div className="overflow-hidden rounded-xl border-2 border-status-purple-border bg-gradient-to-br from-purple-500/5 via-pink-500/5 to-transparent p-6 shadow-lg">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[18px]">📋</span>
        <span className="text-[12px] font-semibold uppercase tracking-[0.05em] text-status-purple">
          Финальный вывод аудита
        </span>
      </div>
      <h2 className="mb-4 text-[24px] font-extrabold tracking-[-0.01em] text-text-primary">
        {insight.title.replace(/^🔥RETRO_AUDIT\s*📋\s*/, "")}
      </h2>
      <RetroSectionInsight insight={insight} />
    </div>
  )
}
