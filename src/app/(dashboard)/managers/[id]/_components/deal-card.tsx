import { ChipBadge } from "@/components/chip-badge"
import { QuoteBlock } from "@/components/quote-block"
import { fmtMoney, fmtDays } from "@/lib/format"
import type { DealWithAnalysis } from "@/lib/queries/manager-detail"

interface DealCardProps {
  deal: DealWithAnalysis
  variant: "success" | "failure"
}

export function DealCard({ deal, variant }: DealCardProps) {
  const isSuccess = variant === "success"
  const amountColor = isSuccess ? "text-status-green" : "text-status-red"
  const borderColor = isSuccess
    ? "border-l-status-green"
    : "border-l-status-red"
  const insightLabel = isSuccess ? "Что сработало:" : "Что пошло не так:"
  const insightText = isSuccess
    ? deal.analysis?.successFactors
    : deal.analysis?.failureFactors

  const quotes = (deal.analysis?.keyQuotes ?? []).filter((q) =>
    isSuccess ? q.isPositive : !q.isPositive
  )

  return (
    <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:shadow-[var(--card-shadow-hover)]">
      {/* Top row: title + amount */}
      <div className="mb-2 flex items-start justify-between gap-4">
        <div className="text-[14px] font-semibold leading-snug">
          {deal.title}
        </div>
        <div className={`shrink-0 text-[16px] font-bold ${amountColor}`}>
          {fmtMoney(deal.amount ?? 0)}
        </div>
      </div>

      {/* Meta row */}
      <div className="mb-3 flex flex-wrap gap-3 text-[12px] text-text-tertiary">
        <span>{fmtDays(deal.duration ?? 0)}</span>
        <span>
          {deal.stageCount} {stageWord(deal.stageCount)}
        </span>
        <span>
          {deal.messageCount} {messageWord(deal.messageCount)}
        </span>
      </div>

      {/* AI insight block */}
      {insightText && (
        <div className="relative mb-3 rounded-[6px] border-l-2 border-l-ai-1 bg-surface-2 px-4 py-3">
          <span className="absolute right-2.5 top-2 rounded-[4px] bg-ai-glow px-1.5 py-0.5 text-[10px] font-bold ai-grad">
            AI
          </span>
          <div className="pr-8 text-[12px] leading-relaxed text-text-secondary">
            <strong>{insightLabel}</strong> {insightText}
          </div>
        </div>
      )}

      {/* Quotes */}
      {quotes.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {quotes.map((q, i) => (
            <QuoteBlock key={i} text={q.text} dealCrmId={q.dealCrmId} />
          ))}
        </div>
      )}

      {/* Link to deal */}
      {deal.crmId && (
        <div className="mt-2">
          <ChipBadge label={`#${deal.crmId}`} href={`/deals/${deal.id}`} />
        </div>
      )}
    </div>
  )
}

function stageWord(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return "этап"
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100))
    return "этапа"
  return "этапов"
}

function messageWord(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return "сообщение"
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100))
    return "сообщения"
  return "сообщений"
}
