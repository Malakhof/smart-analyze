export const dynamic = "force-dynamic"

import { getManagersList, getTenantId } from "@/lib/queries/managers"
import { ManagerCards } from "./_components/manager-cards"

export default async function ManagersPage() {
  const tenantId = await getTenantId()

  if (!tenantId) {
    return (
      <div className="py-20 text-center text-text-tertiary">
        Нет данных. Запустите seed для заполнения базы данных.
      </div>
    )
  }

  const { managers } = await getManagersList(tenantId)

  return (
    <>
      {/* Header */}
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-[24px] font-bold tracking-[-0.04em]">
          Менеджеры
        </h2>
        <span className="rounded-full border border-border-default bg-surface-1 px-3 py-1 text-[12px] font-medium text-text-secondary">
          Всё время
        </span>
      </div>
      <p className="mb-5 text-[13px] text-text-tertiary">
        Обзор эффективности {managers.length}{" "}
        {managersWord(managers.length)} отдела продаж
      </p>

      <ManagerCards managers={managers} />
    </>
  )
}

function managersWord(n: number): string {
  const lastTwo = n % 100
  const lastOne = n % 10
  if (lastTwo >= 11 && lastTwo <= 14) return "менеджеров"
  if (lastOne === 1) return "менеджера"
  if (lastOne >= 2 && lastOne <= 4) return "менеджеров"
  return "менеджеров"
}
