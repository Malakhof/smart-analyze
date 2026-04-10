interface QuoteBlockProps {
  text: string
  dealCrmId?: string
}

export function QuoteBlock({ text, dealCrmId }: QuoteBlockProps) {
  return (
    <div className="mt-1.5 rounded-[6px] border-l-2 border-ai-2 bg-surface-2 px-3.5 py-2.5 font-mono text-[12px] leading-relaxed text-text-secondary">
      &laquo;{text}&raquo;{dealCrmId && ` (${dealCrmId})`}
    </div>
  )
}
