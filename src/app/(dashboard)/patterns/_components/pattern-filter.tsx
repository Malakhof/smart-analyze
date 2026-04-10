"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"

const FILTERS = [
  { label: "Все", value: "" },
  { label: "Успех", value: "success" },
  { label: "Провал", value: "failure" },
] as const

export function PatternFilter() {
  const searchParams = useSearchParams()
  const current = searchParams.get("filter") ?? ""

  return (
    <div className="mb-5 flex gap-1.5">
      {FILTERS.map((f) => {
        const isActive = current === f.value
        return (
          <Link
            key={f.value}
            href={f.value ? `/patterns?filter=${f.value}` : "/patterns"}
            className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${
              isActive
                ? "bg-text-primary text-surface-0"
                : "bg-surface-2 text-text-secondary hover:bg-surface-3 hover:text-text-primary"
            }`}
          >
            {f.label}
          </Link>
        )
      })}
    </div>
  )
}
