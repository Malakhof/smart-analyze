export const dynamic = "force-dynamic"

import { getManagersList, getTenantId } from "@/lib/queries/managers"
import { ManagersTable } from "./_components/managers-table"

export default async function ManagersPage() {
  const tenantId = await getTenantId()

  if (!tenantId) {
    return (
      <div className="py-20 text-center text-text-tertiary">
        Нет данных. Запустите seed для заполнения базы данных.
      </div>
    )
  }

  const { managers, summary } = await getManagersList(tenantId)

  const cards = [
    { label: "Всего", value: summary.total, color: "" },
    { label: "Отлично", value: summary.excellent, color: "text-status-green" },
    {
      label: "На карандаше",
      value: summary.watch,
      color: "text-status-amber",
    },
    { label: "Критично", value: summary.critical, color: "text-status-red" },
  ]

  return (
    <>
      <h2 className="mb-5 text-[24px] font-bold tracking-[-0.04em]">
        Менеджеры
      </h2>

      <div className="mb-5 grid grid-cols-4 gap-2.5">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]"
          >
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
              {c.label}
            </div>
            <div
              className={`text-[26px] font-extrabold leading-none tracking-[-0.04em] ${c.color}`}
            >
              {c.value}
            </div>
          </div>
        ))}
      </div>

      <ManagersTable managers={managers} />
    </>
  )
}
