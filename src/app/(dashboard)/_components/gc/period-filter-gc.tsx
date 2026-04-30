"use client"

import { useRouter, useSearchParams } from "next/navigation"

const PERIODS = [
  { label: "Сегодня", value: "today" },
  { label: "Неделя", value: "week" },
  { label: "Месяц", value: "month" },
] as const

export function PeriodFilterGc() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const current = searchParams.get("period") ?? "month"

  function handleClick(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("period", value)
    router.push(`?${params.toString()}`, { scroll: false })
  }

  return (
    <div className="inline-flex gap-0.5 rounded-[10px] bg-surface-2 p-[3px]">
      {PERIODS.map((p) => (
        <button
          key={p.value}
          onClick={() => handleClick(p.value)}
          className={`cursor-pointer rounded-[6px] border-none px-3.5 py-[5px] font-sans text-[12px] font-medium transition-all duration-[0.18s] ${
            current === p.value
              ? "bg-surface-4 text-text-primary shadow-[0_1px_2px_rgba(0,0,0,0.06)] dark:shadow-none"
              : "bg-transparent text-text-tertiary hover:text-text-secondary"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}
