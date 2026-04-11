"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { fmtMoney, fmtDays } from "@/lib/format"

interface DealRow {
  id: string
  crmId: string | null
  amount: number | null
  status: string
  duration: number | null
}

interface DealsListProps {
  deals: DealRow[]
}

type DealFilter = "all" | "won" | "lost" | "open"

function getStatusBadge(status: string) {
  switch (status) {
    case "WON":
      return {
        label: "Успешная",
        classes: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      }
    case "LOST":
      return {
        label: "Провалена",
        classes: "bg-red-500/15 text-red-400 border-red-500/20",
      }
    case "OPEN":
      return {
        label: "В работе",
        classes: "bg-blue-500/15 text-blue-400 border-blue-500/20",
      }
    default:
      return {
        label: status,
        classes: "bg-gray-500/15 text-gray-400 border-gray-500/20",
      }
  }
}

const INITIAL_SHOW = 10

export function DealsList({ deals }: DealsListProps) {
  const router = useRouter()
  const [filter, setFilter] = useState<DealFilter>("all")
  const [expanded, setExpanded] = useState(false)

  const filtered = deals.filter((d) => {
    if (filter === "won") return d.status === "WON"
    if (filter === "lost") return d.status === "LOST"
    if (filter === "open") return d.status === "OPEN"
    return true
  })

  const wonCount = deals.filter((d) => d.status === "WON").length
  const lostCount = deals.filter((d) => d.status === "LOST").length
  const openCount = deals.filter((d) => d.status === "OPEN").length

  const pills: { label: string; value: DealFilter; count: number }[] = [
    { label: "Все", value: "all", count: deals.length },
    { label: "Успешные", value: "won", count: wonCount },
    { label: "Провальные", value: "lost", count: lostCount },
    { label: "В работе", value: "open", count: openCount },
  ]

  const visible = expanded ? filtered : filtered.slice(0, INITIAL_SHOW)

  // Find the highest amount for highlighting top deals
  const maxAmount = Math.max(...deals.map((d) => d.amount ?? 0), 0)
  const topThreshold = maxAmount > 0 ? maxAmount * 0.8 : Infinity

  return (
    <section className="mt-8">
      <h3 className="mb-4 text-[16px] font-bold">Список сделок менеджера</h3>

      {/* Filter pills */}
      <div className="mb-4 flex gap-2">
        {pills.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => {
              setFilter(p.value)
              setExpanded(false)
            }}
            className={`cursor-pointer rounded-full border px-3.5 py-1 text-[12px] font-medium transition-all duration-150 ${
              filter === p.value
                ? "border-ai-1/30 bg-ai-1/10 text-ai-1"
                : "border-border-default bg-surface-1 text-text-secondary hover:border-border-hover hover:text-text-primary"
            }`}
          >
            {p.label}{" "}
            <span className="ml-0.5 tabular-nums opacity-70">({p.count})</span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-[10px] border border-border-default bg-surface-1 shadow-[var(--card-shadow)]">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["ID", "Сумма", "Статус", "Тип клиента", "Длительность"].map(
                  (h) => (
                    <th
                      key={h}
                      className="border-b border-border-default px-[14px] py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary"
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map((d) => {
                const badge = getStatusBadge(d.status)
                const isTop = (d.amount ?? 0) >= topThreshold && (d.amount ?? 0) > 0
                return (
                  <tr
                    key={d.id}
                    onClick={() => router.push(`/deals/${d.id}`)}
                    className={`cursor-pointer transition-colors duration-100 hover:bg-surface-2 [&:not(:last-child)>td]:border-b [&:not(:last-child)>td]:border-border-default ${
                      isTop ? "bg-violet-500/5" : ""
                    }`}
                  >
                    {/* ID */}
                    <td className="whitespace-nowrap px-[14px] py-3 text-[13px] font-medium text-text-primary tabular-nums">
                      {d.crmId ?? d.id.slice(0, 8)}
                    </td>

                    {/* Amount */}
                    <td className="whitespace-nowrap px-[14px] py-3 text-[13px] font-medium tabular-nums">
                      {fmtMoney(d.amount ?? 0)}
                    </td>

                    {/* Status */}
                    <td className="px-[14px] py-3">
                      <span
                        className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${badge.classes}`}
                      >
                        {badge.label}
                      </span>
                    </td>

                    {/* Client type */}
                    <td className="px-[14px] py-3">
                      <span className="inline-block rounded-md border border-violet-500/20 bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium text-violet-400">
                        Первичный
                      </span>
                    </td>

                    {/* Duration */}
                    <td className="whitespace-nowrap px-[14px] py-3 text-[13px] tabular-nums text-text-secondary">
                      {d.duration != null ? (
                        <span className="flex items-center gap-1">
                          {fmtDays(d.duration)}
                          <span className="text-text-tertiary">&nearr;</span>
                        </span>
                      ) : (
                        "\u2014"
                      )}
                    </td>
                  </tr>
                )
              })}

              {visible.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-[14px] py-8 text-center text-[13px] text-text-tertiary"
                  >
                    Нет сделок
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Export + Footer */}
      {filtered.length > 0 && (
        <div className="mt-3 flex justify-end">
          <button
            onClick={() => {
              const header = ["ID", "Сумма", "Статус", "Длительность"]
              const rows = filtered.map((d) => [
                d.crmId ?? d.id.slice(0, 8),
                d.amount != null ? String(d.amount) : "",
                d.status === "WON" ? "Успешная" : d.status === "LOST" ? "Провалена" : "В работе",
                d.duration != null ? String(d.duration) : "",
              ])
              const csv = [header, ...rows]
                .map((row) =>
                  row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")
                )
                .join("\n")
              const bom = "\uFEFF"
              const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" })
              const url = URL.createObjectURL(blob)
              const date = new Date().toISOString().slice(0, 10)
              const a = document.createElement("a")
              a.href = url
              a.download = `deals-export-${date}.csv`
              a.click()
              URL.revokeObjectURL(url)
            }}
            className="rounded-lg border border-border-default bg-surface-1 px-4 py-2 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
          >
            Экспорт
          </button>
        </div>
      )}

      {/* Footer: count + toggle */}
      {filtered.length > 0 && (
        <div className="mt-2.5 flex items-center justify-between text-[12px] text-text-tertiary">
          <span>
            Показано {visible.length} из {filtered.length} сделок
          </span>
          {filtered.length > INITIAL_SHOW && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="cursor-pointer font-medium text-text-secondary transition-colors hover:text-text-primary"
            >
              {expanded ? "\u25B4 Свернуть" : "\u25BE Показать все"}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
