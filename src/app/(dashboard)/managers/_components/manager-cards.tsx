"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { fmtMoney, fmtPercent, fmtDays } from "@/lib/format"

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

interface ManagerCardsProps {
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

function getConversionGradient(rate: number): string {
  if (rate >= 60) return "from-emerald-600 to-emerald-900"
  if (rate >= 40) return "from-amber-500 to-amber-800"
  return "from-red-500 to-red-800"
}

function getStatusBadge(status: string | null) {
  switch (status) {
    case "EXCELLENT":
      return {
        label: "Высокая эффективность",
        classes: "bg-status-green-dim text-status-green border-status-green/20",
      }
    case "WATCH":
      return {
        label: "На карандаше",
        classes: "bg-status-amber-dim text-status-amber border-status-amber/20",
      }
    case "CRITICAL":
      return {
        label: "Требуется поддержка",
        classes: "bg-status-red-dim text-status-red border-status-red/20",
      }
    default:
      return {
        label: "\u2014",
        classes: "bg-surface-3 text-text-tertiary border-border-default",
      }
  }
}

function getTrendArrow(status: string | null) {
  if (status === "EXCELLENT") return "\u2197"
  if (status === "CRITICAL") return "\u2198"
  return "\u2192"
}

type FilterType = "all" | "top" | "attention"

export function ManagerCards({ managers }: ManagerCardsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const filter = (searchParams.get("filter") as FilterType) ?? "all"

  const filtered = managers.filter((m) => {
    if (filter === "top") return m.status === "EXCELLENT"
    if (filter === "attention")
      return m.status === "WATCH" || m.status === "CRITICAL"
    return true
  })

  const topCount = managers.filter((m) => m.status === "EXCELLENT").length
  const attentionCount = managers.filter(
    (m) => m.status === "WATCH" || m.status === "CRITICAL"
  ).length

  const pills: { label: string; value: FilterType; count: number }[] = [
    { label: "Все", value: "all", count: managers.length },
    { label: "Топ исполнителей", value: "top", count: topCount },
    { label: "Требуют внимания", value: "attention", count: attentionCount },
  ]

  function setFilter(value: FilterType) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === "all") {
      params.delete("filter")
    } else {
      params.set("filter", value)
    }
    router.push(`?${params.toString()}`, { scroll: false })
  }

  return (
    <>
      {/* Filter pills */}
      <div className="mb-5 flex gap-2">
        {pills.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => setFilter(p.value)}
            className={`cursor-pointer rounded-full border px-4 py-1.5 text-[13px] font-medium transition-all duration-150 ${
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

      {/* Card grid */}
      <div className="grid grid-cols-3 gap-4">
        {filtered.map((m, i) => {
          const conv = m.conversionRate ?? 0
          const badge = getStatusBadge(m.status)
          const trend = getTrendArrow(m.status)

          return (
            <div
              key={m.id}
              onClick={() => router.push(`/managers/${m.id}`)}
              className="cursor-pointer rounded-[14px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]"
            >
              {/* Top row: avatar + name + badge + trend */}
              <div className="mb-4 flex items-center gap-3">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white ${AVATAR_CLASSES[i % AVATAR_CLASSES.length]}`}
                >
                  {getInitials(m.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-bold text-text-primary">
                      {m.name}
                    </span>
                    {m.status === "EXCELLENT" && (
                      <span className="text-[14px]" title="Топ исполнитель">
                        &#127941;
                      </span>
                    )}
                    <span
                      className="ml-auto text-[14px] text-text-tertiary"
                      title="Тренд"
                    >
                      {trend}
                    </span>
                  </div>
                  <div className="text-[12px] text-text-tertiary">
                    Отдел продаж
                  </div>
                </div>
              </div>

              {/* Conversion block with gradient */}
              <div className="mb-4">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
                  Конверсия
                </div>
                <div
                  className={`rounded-[10px] bg-gradient-to-br ${getConversionGradient(conv)} p-4`}
                >
                  <div className="text-[24px] font-extrabold leading-none tracking-[-0.04em] text-white">
                    {fmtPercent(conv)}
                  </div>
                  <div className="mt-1 text-[12px] text-white/70">
                    {m.successDeals ?? 0} из {m.totalDeals ?? 0} сделок
                  </div>
                </div>
              </div>

              {/* Metrics 2x2 */}
              <div className="mb-4 grid grid-cols-2 gap-3">
                <div>
                  <div className="mb-0.5 flex items-center gap-1 text-[11px] text-text-tertiary">
                    <span>&#128176;</span> Средний чек
                  </div>
                  <div className="text-[14px] font-bold tabular-nums">
                    {m.avgDealValue
                      ? fmtMoney(m.avgDealValue).replace(" \u20BD", "K")
                      : "\u2014"}
                  </div>
                </div>
                <div>
                  <div className="mb-0.5 flex items-center gap-1 text-[11px] text-text-tertiary">
                    <span>&#128200;</span> Время
                  </div>
                  <div className="text-[14px] font-bold tabular-nums">
                    {m.avgDealTime != null ? fmtDays(m.avgDealTime) : "\u2014"}
                  </div>
                </div>
                <div>
                  <div className="mb-0.5 flex items-center gap-1 text-[11px] text-text-tertiary">
                    <span>&#128483;&#65039;</span> Talk Ratio
                  </div>
                  <div className="text-[14px] font-bold tabular-nums">
                    {m.talkRatio != null ? fmtPercent(m.talkRatio) : "\u2014"}
                  </div>
                </div>
                <div>
                  <div className="mb-0.5 flex items-center gap-1 text-[11px] text-text-tertiary">
                    <span>&#128203;</span> Ист. сделок
                  </div>
                  <div className="text-[14px] font-bold tabular-nums">
                    {m.totalDeals ?? 0}
                  </div>
                </div>
              </div>

              {/* Status badge */}
              <div
                className={`rounded-[8px] border px-3 py-1.5 text-center text-[12px] font-semibold ${badge.classes}`}
              >
                {badge.label}
              </div>
            </div>
          )
        })}

        {filtered.length === 0 && (
          <div className="col-span-3 py-12 text-center text-[13px] text-text-tertiary">
            Нет менеджеров по выбранному фильтру
          </div>
        )}
      </div>
    </>
  )
}
