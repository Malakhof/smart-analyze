interface QuoteBlockProps {
  text: string
  dealCrmId?: string
  source?: "transcript" | "message" | null
}

const SOURCE_LABEL: Record<NonNullable<QuoteBlockProps["source"]>, string> = {
  transcript: "из звонка",
  message: "из переписки",
}

export function QuoteBlock({ text, dealCrmId, source }: QuoteBlockProps) {
  return (
    <div className="mt-1.5 rounded-[6px] border-l-2 border-ai-2 bg-surface-2 px-3.5 py-2.5">
      <div className="font-mono text-[12px] leading-relaxed text-text-secondary">
        &laquo;{text}&raquo;
      </div>
      {(source || dealCrmId) && (
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-text-tertiary">
          {source && (
            <span className="rounded bg-surface-3 px-1.5 py-0.5">
              {SOURCE_LABEL[source]}
            </span>
          )}
          {dealCrmId && <span>сделка #{dealCrmId}</span>}
        </div>
      )}
    </div>
  )
}
