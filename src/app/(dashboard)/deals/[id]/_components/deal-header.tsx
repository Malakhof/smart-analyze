import { fmtMoney, fmtDays } from "@/lib/format"

interface DealHeaderProps {
  managerName: string | null
  amount: number | null
  createdAt: Date
  duration: number | null
}

function fmtDate(date: Date): string {
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

export function DealHeader({
  managerName,
  amount,
  createdAt,
  duration,
}: DealHeaderProps) {
  const parts = [
    managerName ? `Менеджер: ${managerName}` : null,
    `Сумма: ${fmtMoney(amount ?? 0)}`,
    `Создана: ${fmtDate(createdAt)}`,
    `Длительность: ${fmtDays(duration ?? 0)}`,
  ].filter(Boolean)

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-2 text-[14px] text-text-secondary">
      {parts.map((part, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 && (
            <span className="text-text-muted">|</span>
          )}
          <span>{part}</span>
        </span>
      ))}
    </div>
  )
}
