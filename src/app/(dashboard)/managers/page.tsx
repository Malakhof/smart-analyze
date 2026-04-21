import { requireTenantId } from "@/lib/auth"
export const dynamic = "force-dynamic"

import { getManagersList } from "@/lib/queries/managers"
import { getTenantMode } from "@/lib/queries/active-window"
import { ManagerCards } from "./_components/manager-cards"

export default async function ManagersPage() {
  const tenantId = await requireTenantId()
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
