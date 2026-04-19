"use client"

import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion"
import { ChipBadge } from "@/components/chip-badge"
import { QuoteBlock } from "@/components/quote-block"
import { AiBadge } from "@/components/ai-badge"
import type { InsightWithDetails } from "@/lib/queries/dashboard"

interface AiInsightsProps {
  insights: InsightWithDetails[]
}

export function AiInsights({ insights }: AiInsightsProps) {
  const successInsights = insights.filter(
    (i) => i.type === "SUCCESS_INSIGHT"
  )
  const failureInsights = insights.filter(
    (i) => i.type === "FAILURE_INSIGHT"
  )

  return (
    <div className="mb-9">
      <div className="mb-3.5 flex items-center gap-2 text-[13px] font-semibold text-text-secondary">
        AI-инсайты по отделу
        <AiBadge text="Сгенерировано AI" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {/* Success block */}
        <InsightBlock
          type="success"
          title="Что работает лучше всего"
          icon="✓"
          insights={successInsights}
        />

        {/* Failure block */}
        <InsightBlock
          type="danger"
          title="Что приводит к провалу"
          icon="!"
          insights={failureInsights}
        />
      </div>
    </div>
  )
}

function InsightBlock({
  type,
  title,
  icon,
  insights,
}: {
  type: "success" | "danger"
  title: string
  icon: string
  insights: InsightWithDetails[]
}) {
  const isSuccess = type === "success"
  const borderClass = isSuccess
    ? "border-l-[3px] border-l-status-green"
    : "border-l-[3px] border-l-status-red"
  const iconBg = isSuccess
    ? "bg-status-green-dim text-status-green border border-status-green-border"
    : "bg-status-red-dim text-status-red border border-status-red-border"
  const headerColor = isSuccess ? "text-status-green" : "text-status-red"

  return (
    <div
      className={`overflow-hidden rounded-[10px] border border-[var(--insight-border)] bg-[var(--insight-card)] shadow-[var(--card-shadow)] ${borderClass}`}
    >
      <div
        className={`flex items-center gap-2.5 px-5 py-4 text-[15px] font-semibold ${headerColor}`}
      >
        <div
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] ${iconBg}`}
        >
          {icon}
        </div>
        {title}
      </div>

      <Accordion>
        {insights.map((insight, idx) => (
          <AccordionItem
            key={insight.id}
            className="border-t border-border-default"
            value={idx}
          >
            <AccordionTrigger className="w-full px-5 py-3.5 text-left text-[13px] font-semibold uppercase tracking-[0.02em] leading-[1.4] text-text-primary hover:no-underline hover:bg-surface-2">
              {insight.title}
            </AccordionTrigger>
            <AccordionContent className="px-5 pb-4 text-[13px] leading-[1.7] text-text-secondary">
              <p className="mb-3">{insight.content}</p>

              {insight.detailedDescription && (
                <div className="mb-3">
                  <div className="mb-1 text-[12px] font-semibold text-status-red">
                    Подробное описание:
                  </div>
                  <p>{insight.detailedDescription}</p>
                </div>
              )}

              {insight.deals.length > 0 && (
                <div className="mb-3">
                  <div className="mb-1.5 text-[12px] font-semibold text-text-tertiary">
                    Список сделок где встречается:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {insight.deals.map((d) => (
                      <ChipBadge
                        key={d.id}
                        label={`#${d.crmId ?? d.id.slice(0, 6)}`}
                        href={`/deals/${d.id}`}
                      />
                    ))}
                  </div>
                </div>
              )}

              {insight.managers.length > 0 && (
                <div className="mb-3">
                  <div className="mb-1.5 text-[12px] font-semibold text-text-tertiary">
                    Список менеджеров:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {insight.managers.map((m) => (
                      <ChipBadge
                        key={m.id}
                        label={m.name}
                        href={`/managers/${m.id}`}
                      />
                    ))}
                  </div>
                </div>
              )}

              {insight.quotes.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[12px] font-semibold text-text-tertiary">
                    Список цитат:
                  </div>
                  {insight.quotes.map((q, qi) => (
                    <QuoteBlock
                      key={qi}
                      text={q.text}
                      dealCrmId={q.dealCrmId}
                      source={q.source ?? null}
                    />
                  ))}
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  )
}
