"use client"

import { useRouter } from "next/navigation"

function scoreColor(score: number): string {
  if (score >= 80) return "text-status-green"
  if (score >= 50) return "text-status-amber"
  return "text-status-red"
}

function fmtDuration(seconds: number | null): string {
  if (!seconds) return "--:--"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

function fmtDate(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date))
}

interface RecentCall {
  id: string
  managerName: string | null
  clientName: string | null
  direction: string
  duration: number | null
  totalScore: number | null
  createdAt: Date
}

interface QcRecentCallsProps {
  calls: RecentCall[]
}

export function QcRecentCalls({ calls }: QcRecentCallsProps) {
  const router = useRouter()

  return (
    <div className="overflow-hidden rounded-[10px] border border-border-default bg-surface-1 shadow-[var(--card-shadow)]">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {["Дата", "Менеджер", "Клиент", "Длительность", "Балл", "Тип"].map(
              (h) => (
                <th
                  key={h}
                  className="border-b border-border-default px-[18px] py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary"
                >
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {calls.map((c) => (
            <tr
              key={c.id}
              onClick={() => router.push(`/quality/calls/${c.id}`)}
              className="cursor-pointer transition-colors duration-100 hover:bg-surface-2 [&:not(:last-child)>td]:border-b [&:not(:last-child)>td]:border-border-default"
            >
              <td className="px-[18px] py-3 text-[13px] text-text-secondary">
                {fmtDate(c.createdAt)}
              </td>
              <td className="px-[18px] py-3 text-[13px] font-medium">
                {c.managerName ?? "—"}
              </td>
              <td className="px-[18px] py-3 text-[13px]">
                {c.clientName ?? "—"}
              </td>
              <td className="px-[18px] py-3 text-[13px] text-text-secondary">
                {fmtDuration(c.duration)}
              </td>
              <td className="px-[18px] py-3 text-[13px]">
                {c.totalScore != null ? (
                  <span
                    className={`font-semibold ${scoreColor(c.totalScore)}`}
                  >
                    {Math.round(c.totalScore)}%
                  </span>
                ) : (
                  <span className="text-text-tertiary">—</span>
                )}
              </td>
              <td className="px-[18px] py-3 text-[13px]">
                {c.direction === "INCOMING" ? (
                  <span className="text-text-secondary" title="Входящий">
                    &#8601; Входящий
                  </span>
                ) : (
                  <span className="text-text-secondary" title="Исходящий">
                    &#8599; Исходящий
                  </span>
                )}
              </td>
            </tr>
          ))}
          {calls.length === 0 && (
            <tr>
              <td
                colSpan={6}
                className="px-[18px] py-8 text-center text-[13px] text-text-tertiary"
              >
                Нет записей звонков
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
