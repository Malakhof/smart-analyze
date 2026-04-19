import { requireTenantId } from "@/lib/auth"
export const dynamic = "force-dynamic"

import { Suspense } from "react"
import { getPatterns } from "@/lib/queries/patterns"
import { PatternFilter } from "./_components/pattern-filter"
import { PatternCard } from "./_components/pattern-card"

export default async function PatternsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  const tenantId = await requireTenantId()
  const params = await searchParams
  const filter = params.filter === "success" || params.filter === "failure"
    ? params.filter
    : undefined
  const patterns = await getPatterns(tenantId, filter)

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-text-primary">
            Паттерны
          </h1>
          <p className="mt-1 text-[13px] text-text-tertiary">
            {patterns.length} {patternsWord(patterns.length)} найдено AI-анализом
          </p>
        </div>
      </header>

      <Suspense>
        <PatternFilter />
      </Suspense>

      {patterns.length === 0 ? (
        <div className="rounded-md border border-border-default p-8 text-center text-text-tertiary">
          <div className="text-[14px]">Паттерны ещё не сформированы</div>
          <div className="mt-1 text-[12px]">
            Запусти AI-анализ переписок и звонков в разделе «Настройки» — паттерны
            успехов и неудач появятся здесь.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {patterns.map((p) => (
            <PatternCard key={p.id} pattern={p} />
          ))}
        </div>
      )}
    </div>
  )
}

function patternsWord(n: number): string {
  const lastTwo = n % 100
  const lastOne = n % 10
  if (lastTwo >= 11 && lastTwo <= 14) return "паттернов"
  if (lastOne === 1) return "паттерн"
  if (lastOne >= 2 && lastOne <= 4) return "паттерна"
  return "паттернов"
}
