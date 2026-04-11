export const dynamic = "force-dynamic"

import { AiBadge } from "@/components/ai-badge"
import { getQualityDashboard, getQcFilterOptions, getTenantId } from "@/lib/queries/quality"
import { QcSummary } from "./_components/qc-summary"
import { QcManagerTable } from "./_components/qc-manager-table"
import { QcRecentCalls } from "./_components/qc-recent-calls"
import { QcFilters } from "./_components/qc-filters"

export default async function QualityPage() {
  const tenantId = await getTenantId()

  if (!tenantId) {
    return (
      <div className="py-20 text-center text-text-tertiary">
        Нет данных. Запустите seed для заполнения базы данных.
      </div>
    )
  }

  const [data, filterOptions] = await Promise.all([
    getQualityDashboard(tenantId),
    getQcFilterOptions(tenantId),
  ])

  return (
    <>
      {/* Title + AI badge */}
      <div className="mb-5 flex items-center gap-3">
        <h2 className="text-[24px] font-bold tracking-[-0.04em]">
          Контроль качества
        </h2>
        <AiBadge
          text={`${data.totalCalls} ${callsWord(data.totalCalls)} проанализировано`}
        />
      </div>

      {/* 2-column: filters sidebar + content */}
      <div className="flex gap-5">
        {/* Left sidebar — filters */}
        <QcFilters
          categories={filterOptions.categories}
          tags={filterOptions.tags}
          managers={filterOptions.managers}
          scriptItems={filterOptions.scriptItems}
        />

        {/* Right — main content */}
        <div className="min-w-0 flex-1">
          {/* Summary cards */}
          <QcSummary
            totalCalls={data.totalCalls}
            avgScore={data.avgScore}
            avgScriptCompliance={data.avgScriptCompliance}
            criticalMisses={data.criticalMisses}
          />

          {/* Manager scores */}
          <section className="mt-8">
            <h3 className="mb-4 text-[16px] font-bold">Оценки менеджеров</h3>
            <QcManagerTable managers={data.managers} />
          </section>

          {/* Recent calls */}
          <section className="mt-8">
            <h3 className="mb-4 text-[16px] font-bold">Последние звонки</h3>
            <QcRecentCalls calls={data.recentCalls} />
          </section>
        </div>
      </div>
    </>
  )
}

function callsWord(n: number): string {
  const lastTwo = n % 100
  const lastOne = n % 10
  if (lastTwo >= 11 && lastTwo <= 14) return "звонков"
  if (lastOne === 1) return "звонок"
  if (lastOne >= 2 && lastOne <= 4) return "звонка"
  return "звонков"
}
