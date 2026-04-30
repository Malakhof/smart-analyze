"use client"

import { useRouter, useSearchParams } from "next/navigation"
import type { QualityFilterOptions } from "@/lib/queries/quality-gc"

export function QualityFiltersGc({
  options,
}: {
  options: QualityFilterOptions
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function update(name: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === "" || value === "all") {
      params.delete(name)
    } else {
      params.set(name, value)
    }
    params.delete("page")
    router.push(`?${params.toString()}`, { scroll: false })
  }

  function reset() {
    const params = new URLSearchParams()
    const period = searchParams.get("period")
    if (period) params.set("period", period)
    router.push(`?${params.toString()}`, { scroll: false })
  }

  const callType = searchParams.get("callType") ?? "all"
  const callOutcome = searchParams.get("callOutcome") ?? "all"
  const managerId = searchParams.get("managerId") ?? "all"
  const realOnly = searchParams.get("realOnly") ?? "all"
  const sortBy = searchParams.get("sortBy") ?? "date"

  const hasActive =
    callType !== "all" ||
    callOutcome !== "all" ||
    managerId !== "all" ||
    realOnly !== "all"

  return (
    <div className="grid grid-cols-2 gap-3 rounded-md border border-border-default bg-surface-1 p-3 sm:grid-cols-3 lg:grid-cols-6">
      <FilterSelect
        label="callType"
        value={callType}
        onChange={(v) => update("callType", v)}
        options={[
          { v: "all", l: "Все типы" },
          ...options.callTypes.map((t) => ({ v: t, l: t })),
        ]}
      />
      <FilterSelect
        label="callOutcome"
        value={callOutcome}
        onChange={(v) => update("callOutcome", v)}
        options={[
          { v: "all", l: "Все исходы" },
          ...options.callOutcomes.map((o) => ({ v: o, l: o })),
        ]}
      />
      <FilterSelect
        label="МОП"
        value={managerId}
        onChange={(v) => update("managerId", v)}
        options={[
          { v: "all", l: "Все МОПы" },
          ...options.managers.map((m) => ({ v: m.id, l: m.name })),
        ]}
      />
      <FilterSelect
        label="Real conv?"
        value={realOnly}
        onChange={(v) => update("realOnly", v)}
        options={[
          { v: "all", l: "Все" },
          { v: "true", l: "Только real" },
          { v: "false", l: "Только не-real" },
        ]}
      />
      <FilterSelect
        label="Сортировка"
        value={sortBy}
        onChange={(v) => update("sortBy", v)}
        options={[
          { v: "date", l: "По дате" },
          { v: "score", l: "По score" },
          { v: "duration", l: "По длительности" },
        ]}
      />
      <button
        type="button"
        onClick={reset}
        className={`rounded-md border border-border-default bg-surface-1 px-3 py-2 text-[12px] transition-colors ${
          hasActive
            ? "text-status-amber hover:border-status-amber"
            : "text-text-muted"
        }`}
      >
        Сбросить
      </button>
    </div>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<{ v: string; l: string }>
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-text-tertiary">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border-default bg-surface-2 px-2 py-1.5 text-[12px] text-text-primary focus:border-ai-1 focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.l}
          </option>
        ))}
      </select>
    </label>
  )
}
