"use client"

import { useRouter } from "next/navigation"
import { fmtMoney, fmtPercent } from "@/lib/format"

interface ManagerRow {
  id: string
  name: string
  totalDeals: number | null
  successDeals: number | null
  conversionRate: number | null
  avgDealValue: number | null
  avgDealTime: number | null
  talkRatio: number | null
  status: string | null
}

interface ManagersTableProps {
  managers: ManagerRow[]
}

const AVATAR_CLASSES = [
  "bg-gradient-to-br from-ai-1 to-ai-2",
  "bg-gradient-to-br from-[#EC4899] to-ai-1",
  "bg-gradient-to-br from-status-amber to-[#EF4444]",
  "bg-surface-4 !text-text-tertiary",
]

function getInitials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function getStatusBadge(status: string | null) {
  switch (status) {
    case "EXCELLENT":
      return {
        label: "Отлично",
        bg: "bg-status-green-dim",
        text: "text-status-green",
        dot: "bg-status-green",
      }
    case "WATCH":
      return {
        label: "На карандаше",
        bg: "bg-status-amber-dim",
        text: "text-status-amber",
        dot: "bg-status-amber",
      }
    case "CRITICAL":
      return {
        label: "Критично",
        bg: "bg-status-red-dim",
        text: "text-status-red",
        dot: "bg-status-red",
      }
    default:
      return {
        label: "—",
        bg: "bg-surface-3",
        text: "text-text-tertiary",
        dot: "bg-text-tertiary",
      }
  }
}

export function ManagersTable({ managers }: ManagersTableProps) {
  const router = useRouter()

  return (
    <div className="overflow-hidden rounded-[10px] border border-border-default bg-surface-1 shadow-[var(--card-shadow)]">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {[
              "Менеджер",
              "Статус",
              "Сделок",
              "Конверсия",
              "Ср. Чек",
              "Talk Ratio",
            ].map((h) => (
              <th
                key={h}
                className="border-b border-border-default px-[18px] py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {managers.map((m, i) => {
            const badge = getStatusBadge(m.status)
            return (
              <tr
                key={m.id}
                onClick={() => router.push(`/managers/${m.id}`)}
                className="cursor-pointer transition-colors duration-100 hover:bg-surface-2 [&:not(:last-child)>td]:border-b [&:not(:last-child)>td]:border-border-default"
              >
                <td className="px-[18px] py-3 text-[14px]">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white ${AVATAR_CLASSES[i % AVATAR_CLASSES.length]}`}
                    >
                      {getInitials(m.name)}
                    </div>
                    <div>
                      <div className="text-[13px] font-medium">{m.name}</div>
                      <div className="text-[11px] text-text-tertiary">
                        Менеджер
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-[18px] py-3 text-[14px]">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${badge.bg} ${badge.text}`}
                  >
                    <span
                      className={`inline-block h-1.5 w-1.5 rounded-full ${badge.dot}`}
                    />
                    {badge.label}
                  </span>
                </td>
                <td className="px-[18px] py-3 text-[14px]">
                  {m.totalDeals ?? 0}
                </td>
                <td className="px-[18px] py-3 text-[14px]">
                  {fmtPercent(m.conversionRate ?? 0)}
                </td>
                <td className="px-[18px] py-3 text-[14px]">
                  {fmtMoney(m.avgDealValue ?? 0)}
                </td>
                <td className="px-[18px] py-3 text-[14px]">
                  {fmtPercent(m.talkRatio ?? 0)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
