"use client"

import type { DealDetailStage } from "@/lib/queries/deal-detail"

interface StageNavigationProps {
  stages: DealDetailStage[]
}

export function StageNavigation({ stages }: StageNavigationProps) {
  function scrollToStage(stageId: string) {
    const el = document.getElementById(`stage-${stageId}`)
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }

  return (
    <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)]">
      <h3 className="mb-4 text-[14px] font-bold">Быстрая навигация</h3>
      <div className="space-y-1">
        {stages.map((stage, idx) => (
          <button
            key={stage.id}
            onClick={() => scrollToStage(stage.id)}
            className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[12px] text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
          >
            <span className="shrink-0 text-text-tertiary">{idx + 1}.</span>
            <span>{stage.stageName}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
