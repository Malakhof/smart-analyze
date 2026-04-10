export const dynamic = "force-dynamic"

import { Suspense } from "react"
import { getPatterns, getTenantId } from "@/lib/queries/patterns"
import { PatternFilter } from "./_components/pattern-filter"
import { PatternCard } from "./_components/pattern-card"

export default async function PatternsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  const tenantId = await getTenantId()

  if (!tenantId) {
    return (
      <div className="py-20 text-center text-text-tertiary">
        Нет данных. Запустите seed для заполнения базы данных.
      </div>
    )
  }

  const { filter } = await searchParams
  const validFilter =
    filter === "success" || filter === "failure" ? filter : undefined

  const patterns = await getPatterns(tenantId, validFilter)

  const successPatterns = patterns.filter((p) => p.type === "SUCCESS")
  const failurePatterns = patterns.filter((p) => p.type === "FAILURE")

  return (
    <>
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-[24px] font-bold tracking-[-0.04em]">
          Библиотека паттернов
        </h2>
        <div className="inline-flex items-center gap-1.5 rounded-full bg-ai-glow px-3 py-1 text-[12px] font-semibold">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-ai-1" />
          <span className="ai-grad">{patterns.length} паттерн{patterns.length === 1 ? "" : patterns.length < 5 ? "а" : "ов"}</span>
        </div>
      </div>

      {/* Filter pills */}
      <Suspense>
        <PatternFilter />
      </Suspense>

      {/* Pattern grid */}
      {validFilter ? (
        /* Filtered: single column */
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {patterns.map((p) => (
            <PatternCard key={p.id} pattern={p} />
          ))}
        </div>
      ) : (
        /* All: success left, failure right */
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-4">
            {successPatterns.map((p) => (
              <PatternCard key={p.id} pattern={p} />
            ))}
          </div>
          <div className="space-y-4">
            {failurePatterns.map((p) => (
              <PatternCard key={p.id} pattern={p} />
            ))}
          </div>
        </div>
      )}

      {patterns.length === 0 && (
        <div className="py-20 text-center text-text-tertiary">
          Паттерны не найдены
        </div>
      )}
    </>
  )
}
