import Link from "next/link"
import { fmtMoney, fmtDays } from "@/lib/format"

interface DealHeaderProps {
  managerName: string | null
  managerId?: string | null
  amount: number | null
  createdAt: Date
  duration: number | null
  stageCount?: number
  messageCount?: number
}

function fmtDate(date: Date): string {
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

function pluralStages(n: number): string {
  const lastTwo = n % 100
  const last = n % 10
  if (lastTwo >= 11 && lastTwo <= 14) return `${n} этапов`
  if (last === 1) return `${n} этап`
  if (last >= 2 && last <= 4) return `${n} этапа`
  return `${n} этапов`
}

function pluralMessages(n: number): string {
  const lastTwo = n % 100
  const last = n % 10
  if (lastTwo >= 11 && lastTwo <= 14) return `${n} сообщений`
  if (last === 1) return `${n} сообщение`
  if (last >= 2 && last <= 4) return `${n} сообщения`
  return `${n} сообщений`
}

export function DealHeader({
  managerName,
  managerId,
  amount,
  createdAt,
  duration,
  stageCount = 0,
  messageCount = 0,
}: DealHeaderProps) {
  // Sanity-check duration: if it's wildly larger than (now - createdAt) days,
  // the field was inflated by the sync (Bitrix/amoCRM bug). Fallback to recomputed.
  const realDays =
    (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24)
  const displayDuration =
    duration && duration > realDays + 30 ? realDays : duration
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-text-tertiary">
        {managerName && (
          managerId ? (
            <Link
              href={`/managers/${managerId}`}
              className="rounded-md bg-surface-2 px-2 py-1 text-text-secondary no-underline transition-colors hover:bg-surface-3 hover:text-text-primary"
            >
              {managerName}
            </Link>
          ) : (
            <span className="rounded-md bg-surface-2 px-2 py-1 text-text-secondary">
              {managerName}
            </span>
          )
        )}
        <span className="text-text-muted">·</span>
        <span>Создана {fmtDate(createdAt)}</span>
        {displayDuration != null && displayDuration > 0 && (
          <>
            <span className="text-text-muted">·</span>
            <span>{fmtDays(displayDuration)}</span>
          </>
        )}
        {stageCount > 0 && (
          <>
            <span className="text-text-muted">·</span>
            <span>{pluralStages(stageCount)}</span>
          </>
        )}
        {messageCount > 0 && (
          <>
            <span className="text-text-muted">·</span>
            <span>{pluralMessages(messageCount)}</span>
          </>
        )}
      </div>
      {amount != null && amount > 0 && (
        <div className="text-[18px] font-bold tracking-[-0.02em] text-status-green">
          {fmtMoney(amount)}
        </div>
      )}
    </div>
  )
}
