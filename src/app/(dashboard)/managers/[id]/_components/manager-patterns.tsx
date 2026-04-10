import type { ManagerPattern } from "@/lib/queries/manager-detail"

interface ManagerPatternsProps {
  patterns: ManagerPattern[]
}

export function ManagerPatterns({ patterns }: ManagerPatternsProps) {
  if (patterns.length === 0) return null

  return (
    <section className="mt-8">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-[16px] ai-grad font-bold">&#9733;</span>
        <span className="text-[16px] font-bold">Выявленные паттерны</span>
        <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-ai-glow px-2.5 py-0.5 text-[11px] font-semibold">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-ai-1" />
          <span className="ai-grad">AI</span>
        </span>
      </div>

      <div className="space-y-3">
        {patterns.map((p) => {
          const isSuccess = p.type === "SUCCESS"
          const borderColor = isSuccess
            ? "border-l-status-green"
            : "border-l-status-red"

          return (
            <div
              key={p.id}
              className={`rounded-[10px] border border-border-default border-l-2 ${borderColor} bg-surface-1 p-5 shadow-[var(--card-shadow)]`}
            >
              <div className="mb-1 text-[14px] font-semibold">{p.title}</div>
              <div className="text-[13px] leading-relaxed text-text-secondary">
                {p.description}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
