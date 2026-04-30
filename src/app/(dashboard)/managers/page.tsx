import { requireTenantId } from "@/lib/auth"
export const dynamic = "force-dynamic"

import { getManagersList } from "@/lib/queries/managers"
import { getCrmProvider, getTenantMode } from "@/lib/queries/active-window"
import { getManagersListGc } from "@/lib/queries/managers-gc"
import type { GcPeriod } from "@/lib/queries/dashboard-gc"
import { ManagerCards } from "./_components/manager-cards"
import { ManagersListGc } from "../_components/gc/managers-list"
import { PeriodFilterGc } from "../_components/gc/period-filter-gc"

export default async function ManagersPage({
  searchParams,
}: {
  searchParams?: Promise<{ period?: string }>
}) {
  const tenantId = await requireTenantId()
  const provider = await getCrmProvider(tenantId)

  if (provider === "GETCOURSE") {
    const sp = (await searchParams) ?? {}
    const period: GcPeriod =
      sp.period === "today"
        ? "today"
        : sp.period === "week"
          ? "week"
          : "month"
    const rows = await getManagersListGc(tenantId, period)
    return (
      <div className="space-y-6 p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-text-primary">
              Менеджеры
            </h1>
            <p className="mt-1 text-[13px] text-text-tertiary">
              {rows.length} {managersWord(rows.length)} с звонками за период.
              Кураторы исключены.
            </p>
          </div>
          <PeriodFilterGc />
        </header>
        <ManagersListGc rows={rows} />
      </div>
    )
  }

  const mode = await getTenantMode(tenantId)
  const { managers, summary } = await getManagersList(tenantId, mode)

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-text-primary">
            Менеджеры
          </h1>
          <p className="mt-1 text-[13px] text-text-tertiary">
            {summary.total}{" "}
            {mode === "live"
              ? `${activeManagersWord(summary.total)} за 7 дней`
              : managersWord(summary.total)}{" "}
            · отлично: {summary.excellent} · наблюдение: {summary.watch} ·
            критично: {summary.critical}
          </p>
        </div>
      </header>

      {managers.length === 0 ? (
        <div className="rounded-md border border-border-default p-8 text-center text-text-tertiary">
          <div className="text-[14px]">Нет менеджеров пока</div>
          <div className="mt-1 text-[12px]">
            Запусти sync с CRM в разделе «Настройки» — менеджеры появятся
          </div>
        </div>
      ) : (
        <ManagerCards managers={managers} />
      )}
    </div>
  )
}

function activeManagersWord(n: number): string {
  const lastTwo = n % 100
  const lastOne = n % 10
  if (lastTwo >= 11 && lastTwo <= 14) return "активных менеджеров"
  if (lastOne === 1) return "активный менеджер"
  if (lastOne >= 2 && lastOne <= 4) return "активных менеджера"
  return "активных менеджеров"
}

function managersWord(n: number): string {
  const lastTwo = n % 100
  const lastOne = n % 10
  if (lastTwo >= 11 && lastTwo <= 14) return "менеджеров"
  if (lastOne === 1) return "менеджер"
  if (lastOne >= 2 && lastOne <= 4) return "менеджера"
  return "менеджеров"
}
