"use client"

interface AiBadgeProps {
  text: string
}

export function AiBadge({ text }: AiBadgeProps) {
  return (
    <div className="inline-flex items-center gap-[5px] rounded-full border border-ai-border bg-ai-glow px-2.5 py-[3px] pl-[7px] text-[11px] font-medium text-ai-1">
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{
          background: "var(--ai-grad)",
          animation: "pulse-ai 2s ease infinite",
        }}
      />
      {text}
    </div>
  )
}
