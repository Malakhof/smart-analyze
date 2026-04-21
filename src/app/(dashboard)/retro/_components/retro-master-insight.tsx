"use client"

import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion"
import type { InsightWithDetails } from "@/lib/queries/dashboard"
import { RetroSectionInsight } from "./retro-section-insight"

/** Главный вывод аудита — крупный покрытый блок с аккордеоном. */
export function RetroMasterInsight({
  insight,
}: {
  insight: InsightWithDetails
}) {
  const cleanTitle = insight.title.replace(/^🔥RETRO_AUDIT\s*📋\s*/, "")
  return (
    <div className="overflow-hidden rounded-xl border-2 border-status-purple-border bg-gradient-to-br from-purple-500/5 via-pink-500/5 to-transparent shadow-lg">
      <Accordion>
        <AccordionItem value="master" className="border-0">
          <AccordionTrigger className="w-full px-6 py-5 text-left hover:no-underline hover:bg-surface-2/30">
            <div className="flex flex-1 items-center gap-3">
              <span className="text-[24px]">📋</span>
              <div>
                <div className="text-[12px] font-semibold uppercase tracking-[0.05em] text-status-purple">
                  Финальный вывод аудита
                </div>
                <div className="mt-0.5 text-[20px] font-extrabold tracking-[-0.01em] text-text-primary">
                  {cleanTitle}
                </div>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-6">
            <RetroSectionInsight insight={insight} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}
