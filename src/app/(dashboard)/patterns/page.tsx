import { requireTenantId } from "@/lib/auth"
export const dynamic = "force-dynamic"

import { Suspense } from "react"
import { getPatterns } from "@/lib/queries/patterns"
import { db } from "@/lib/db"
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
  const [patterns, analysesCount, lastPattern] = await Promise.all([
    getPatterns(tenantId, filter),
    db.dealAnalysis.count({
      where: { deal: { tenantId, clientCrmId: { not: null } } },
    }),
    db.pattern.findFirst({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ])
  const lastUpdated = lastPattern?.createdAt
    ? new Date(lastPattern.createdAt).toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
      })
    : null

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-3">
        <div>
          <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-text-primary">
            Паттерны
          </h1>
          <p className="mt-1 text-[13px] text-text-tertiary">
            {patterns.length} {patternsWord(patterns.length)} найдено AI-анализом
            {lastUpdated ? ` · обновлено ${lastUpdated}` : ""}
          </p>
        </div>
        <div className="rounded-[10px] border border-border-default bg-surface-1 p-4 text-[12.5px] leading-[1.65] text-text-secondary">
          <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-text-primary">
            Как это работает
          </div>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Анализ по <strong>{analysesCount}</strong> сделкам с 01.01.2025
              (весь доступный период работы). Каждая сделка = переписки + расшифровки
              звонков + метаданные из CRM.
            </li>
            <li>
              ИИ-агент читает содержание каждой сделки, извлекает причины
              успеха/провала, сводит в повторяющиеся паттерны. Один паттерн
              = сценарий, подтверждённый на нескольких сделках с цитатами.
            </li>
            <li>
              <strong>Почему можно доверять:</strong> каждый паттерн ссылается
              на конкретные сделки и цитаты — можно провалиться в исходник и
              проверить. Это не абстрактные советы, а закономерности ваших
              реальных разговоров.
            </li>
          </ul>
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
