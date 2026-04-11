export const dynamic = "force-dynamic"

import Link from "next/link"
import { notFound } from "next/navigation"
import { getManagerDetail } from "@/lib/queries/manager-detail"
import { ManagerStats } from "./_components/manager-stats"
import { DealCard } from "./_components/deal-card"
import { DealsList } from "./_components/deals-list"
import { ManagerPatterns } from "./_components/manager-patterns"
import { AiInsights } from "../../_components/ai-insights"

const AVATAR_CLASSES = [
  "bg-gradient-to-br from-ai-1 to-ai-2",
  "bg-gradient-to-br from-[#EC4899] to-ai-1",
  "bg-gradient-to-br from-status-amber to-[#EF4444]",
]

function getInitials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function getStatusPill(status: string | null) {
  switch (status) {
    case "EXCELLENT":
      return {
        label: "Отлично",
        classes: "bg-status-green-dim text-status-green",
      }
    case "WATCH":
      return {
        label: "На карандаше",
        classes: "bg-status-amber-dim text-status-amber",
      }
    case "CRITICAL":
      return {
        label: "Критично",
        classes: "bg-status-red-dim text-status-red",
      }
    default:
      return {
        label: "—",
        classes: "bg-surface-3 text-text-tertiary",
      }
  }
}

export default async function ManagerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const manager = await getManagerDetail(id)

  if (!manager) notFound()

  const pill = getStatusPill(manager.status)
  const avatarIdx =
    manager.name.split("").reduce((s, c) => s + c.charCodeAt(0), 0) %
    AVATAR_CLASSES.length

  return (
    <>
      {/* Back link */}
      <Link
        href="/managers"
        className="mb-5 inline-flex items-center gap-1 text-[13px] text-text-secondary transition-colors hover:text-text-primary"
      >
        &larr; Менеджеры
      </Link>

      {/* Manager header */}
      <div className="mb-6 flex items-center gap-4">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold text-white ${AVATAR_CLASSES[avatarIdx]}`}
        >
          {getInitials(manager.name)}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[22px] font-bold tracking-[-0.04em]">
            {manager.name}
          </h2>
          <div className="text-[13px] text-text-tertiary">
            Менеджер по продажам
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-3.5 py-1 text-[12px] font-semibold ${pill.classes}`}
        >
          {pill.label}
        </span>
      </div>

      {/* Stat cards */}
      <ManagerStats
        totalDeals={manager.totalDeals}
        successDeals={manager.successDeals}
        lostDealsCount={manager.lostDeals_count}
        conversionRate={manager.conversionRate}
        avgDealValue={manager.avgDealValue}
        talkRatio={manager.talkRatio}
        avgResponseTime={manager.avgResponseTime}
        totalSalesAmount={manager.totalSalesAmount}
        avgDealTime={manager.avgDealTime}
      />

      {/* Success deals */}
      {manager.wonDeals.length > 0 && (
        <section className="mt-8">
          <div className="mb-4 flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-status-green" />
            <span className="text-[16px] font-bold">Успешные сделки</span>
            <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-ai-glow px-2.5 py-0.5 text-[11px] font-semibold">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-ai-1" />
              <span className="ai-grad">AI-анализ</span>
            </span>
          </div>
          <div className="space-y-3">
            {manager.wonDeals.map((deal) => (
              <DealCard key={deal.id} deal={deal} variant="success" />
            ))}
          </div>
        </section>
      )}

      {/* Failure deals */}
      {manager.lostDeals.length > 0 && (
        <section className="mt-8">
          <div className="mb-4 flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-status-red" />
            <span className="text-[16px] font-bold">Неуспешные сделки</span>
          </div>
          <div className="space-y-3">
            {manager.lostDeals.map((deal) => (
              <DealCard key={deal.id} deal={deal} variant="failure" />
            ))}
          </div>
        </section>
      )}

      {/* Deals list */}
      <DealsList deals={manager.allDeals} />

      {/* Patterns */}
      <ManagerPatterns patterns={manager.patterns} />

      {/* AI Insights accordion */}
      {manager.insights.length > 0 && (
        <section className="mt-8">
          <AiInsights insights={manager.insights} />
        </section>
      )}
    </>
  )
}
