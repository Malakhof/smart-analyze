"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useRef, useState, useEffect } from "react"
import { ChevronDown, X } from "lucide-react"

// ── Types ──────────────────────────────────────────────

interface QcFiltersProps {
  categories: string[]
  tags: string[]
  managers: { id: string; name: string }[]
  scriptItems: { id: string; text: string; order: number }[]
  hideManagers?: boolean
}

// ── Period helpers ──────────────────────────────────────

type Period = "day" | "week" | "month"

const PERIODS: { label: string; value: Period }[] = [
  { label: "День", value: "day" },
  { label: "Неделя", value: "week" },
  { label: "Месяц", value: "month" },
]

function getPeriodRange(period: Period): { start: Date; end: Date } {
  const now = new Date()
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const start = new Date(end)
  if (period === "day") {
    // today
  } else if (period === "week") {
    start.setDate(start.getDate() - 6)
  } else {
    start.setDate(start.getDate() - 29)
  }
  return { start, end }
}

function getComparisonRange(period: Period): { start: Date; end: Date } {
  const { start, end } = getPeriodRange(period)
  const diff = end.getTime() - start.getTime()
  const compEnd = new Date(start.getTime() - 86400000) // day before current start
  const compStart = new Date(compEnd.getTime() - diff)
  return { start: compStart, end: compEnd }
}

function fmtDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`
}

// ── Multi-select dropdown ──────────────────────────────

interface MultiSelectProps {
  placeholder: string
  options: { value: string; label: string }[]
  selected: string[]
  onChange: (values: string[]) => void
}

function MultiSelect({ placeholder, options, selected, onChange }: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  function toggle(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center justify-between rounded-[8px] border border-border-default bg-surface-2 px-3 py-[7px] text-left text-[12px] transition-colors hover:border-border-hover"
      >
        <span className={selected.length === 0 ? "text-text-tertiary" : "text-text-primary"}>
          {selected.length === 0
            ? placeholder
            : `Выбрано: ${selected.length}`}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-text-tertiary" />
      </button>

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {selected.map((val) => {
            const opt = options.find((o) => o.value === val)
            return (
              <span
                key={val}
                className="inline-flex items-center gap-1 rounded-[6px] bg-surface-3 px-2 py-0.5 text-[11px] text-text-secondary"
              >
                {opt?.label ?? val}
                <button
                  type="button"
                  onClick={() => toggle(val)}
                  className="cursor-pointer text-text-tertiary hover:text-text-primary"
                >
                  <X className="size-3" />
                </button>
              </span>
            )
          })}
        </div>
      )}

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-[200px] w-full overflow-y-auto rounded-[8px] border border-border-default bg-surface-1 shadow-md">
          {options.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-text-tertiary">
              Нет вариантов
            </div>
          )}
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggle(opt.value)}
              className={`flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-surface-2 ${
                selected.includes(opt.value)
                  ? "text-text-primary font-medium"
                  : "text-text-secondary"
              }`}
            >
              <span
                className={`flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border text-[10px] ${
                  selected.includes(opt.value)
                    ? "border-ai-1 bg-ai-1 text-white"
                    : "border-border-default"
                }`}
              >
                {selected.includes(opt.value) ? "✓" : ""}
              </span>
              <span className="truncate">{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Range slider ───────────────────────────────────────

interface RangeSliderProps {
  min: number
  max: number
  valueMin: number
  valueMax: number
  onChange: (min: number, max: number) => void
}

function RangeSlider({ min, max, valueMin, valueMax, onChange }: RangeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)

  const leftPct = ((valueMin - min) / (max - min)) * 100
  const rightPct = ((valueMax - min) / (max - min)) * 100

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[12px] text-text-secondary">
        <span>{valueMin}%</span>
        <span>{valueMax}%</span>
      </div>
      <div ref={trackRef} className="relative h-[6px] rounded-full bg-surface-3">
        <div
          className="absolute h-full rounded-full bg-ai-1"
          style={{ left: `${leftPct}%`, width: `${rightPct - leftPct}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          value={valueMin}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (v <= valueMax) onChange(v, valueMax)
          }}
          className="range-thumb pointer-events-none absolute inset-0 m-0 h-full w-full appearance-none bg-transparent"
        />
        <input
          type="range"
          min={min}
          max={max}
          value={valueMax}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (v >= valueMin) onChange(valueMin, v)
          }}
          className="range-thumb pointer-events-none absolute inset-0 m-0 h-full w-full appearance-none bg-transparent"
        />
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────

export function QcFilters({ categories, tags, managers, scriptItems, hideManagers }: QcFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Read state from URL
  const period = (searchParams.get("period") as Period) ?? "week"
  const selectedCategories = searchParams.getAll("category")
  const selectedTags = searchParams.getAll("tag")
  const scoreMin = Number(searchParams.get("scoreMin") ?? "0")
  const scoreMax = Number(searchParams.get("scoreMax") ?? "100")
  const selectedManagers = searchParams.getAll("manager")
  const scriptStepStatus = searchParams.get("stepStatus") ?? ""
  const selectedSteps = searchParams.getAll("step")

  const updateParams = useCallback(
    (updater: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString())
      updater(params)
      router.push(`?${params.toString()}`, { scroll: false })
    },
    [router, searchParams]
  )

  // Helpers for array params
  function setArrayParam(key: string, values: string[]) {
    updateParams((p) => {
      p.delete(key)
      values.forEach((v) => p.append(key, v))
    })
  }

  // Period ranges
  const currentRange = getPeriodRange(period)
  const compRange = getComparisonRange(period)

  return (
    <aside className="flex h-fit w-[280px] shrink-0 flex-col gap-5 rounded-[14px] border border-border-default bg-surface-1 p-4">
      {/* ── Период ── */}
      <section>
        <label className="mb-2 block text-[13px] font-semibold text-text-primary">
          Период
        </label>
        <div className="inline-flex gap-0.5 rounded-[10px] bg-surface-2 p-[3px]">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() =>
                updateParams((params) => params.set("period", p.value))
              }
              className={`cursor-pointer rounded-[6px] border-none px-3 py-[5px] text-[12px] font-medium transition-all duration-[0.18s] ${
                period === p.value
                  ? "bg-surface-4 text-text-primary shadow-[0_1px_2px_rgba(0,0,0,0.06)] dark:shadow-none"
                  : "bg-transparent text-text-tertiary hover:text-text-secondary"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-2 space-y-0.5 text-[11px] text-text-secondary">
          <div>
            Текущий период: {fmtDate(currentRange.start)} &ndash;{" "}
            {fmtDate(currentRange.end)}
          </div>
          <div>
            Сравнение с периодом: {fmtDate(compRange.start)} &ndash;{" "}
            {fmtDate(compRange.end)}
          </div>
        </div>
      </section>

      {/* ── Категории ── */}
      <section>
        <label className="mb-2 block text-[13px] font-semibold text-text-primary">
          Категории
        </label>
        <MultiSelect
          placeholder="Выберите категории"
          options={categories.map((c) => ({ value: c, label: c }))}
          selected={selectedCategories}
          onChange={(vals) => setArrayParam("category", vals)}
        />
      </section>

      {/* ── Теги ── */}
      <section>
        <label className="mb-2 block text-[13px] font-semibold text-text-primary">
          Теги
        </label>
        <MultiSelect
          placeholder="Выберите теги"
          options={tags.map((t) => ({ value: t, label: t }))}
          selected={selectedTags}
          onChange={(vals) => setArrayParam("tag", vals)}
        />
      </section>

      {/* ── Оценка ── */}
      <section>
        <label className="mb-2 block text-[13px] font-semibold text-text-primary">
          Оценка
        </label>
        <RangeSlider
          min={0}
          max={100}
          valueMin={scoreMin}
          valueMax={scoreMax}
          onChange={(sMin, sMax) =>
            updateParams((p) => {
              p.set("scoreMin", String(sMin))
              p.set("scoreMax", String(sMax))
            })
          }
        />
      </section>

      {/* ── Менеджеры ── */}
      {!hideManagers && (
        <section>
          <label className="mb-2 block text-[13px] font-semibold text-text-primary">
            Менеджеры
          </label>
          <MultiSelect
            placeholder="Выберите менеджеров"
            options={managers.map((m) => ({ value: m.id, label: m.name }))}
            selected={selectedManagers}
            onChange={(vals) => setArrayParam("manager", vals)}
          />
        </section>
      )}

      {/* ── Шаги скрипта ── */}
      <section>
        <label className="mb-2 block text-[13px] font-semibold text-text-primary">
          Шаги скрипта
        </label>
        <div className="mb-2 inline-flex gap-0.5 rounded-[10px] bg-surface-2 p-[3px]">
          {[
            { label: "Выполнено", value: "done" },
            { label: "Не выполнено", value: "missed" },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() =>
                updateParams((p) => {
                  if (scriptStepStatus === opt.value) {
                    p.delete("stepStatus")
                  } else {
                    p.set("stepStatus", opt.value)
                  }
                })
              }
              className={`cursor-pointer rounded-[6px] border-none px-3 py-[5px] text-[12px] font-medium transition-all duration-[0.18s] ${
                scriptStepStatus === opt.value
                  ? "bg-surface-4 text-text-primary shadow-[0_1px_2px_rgba(0,0,0,0.06)] dark:shadow-none"
                  : "bg-transparent text-text-tertiary hover:text-text-secondary"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <MultiSelect
          placeholder="Выберите шаги скрипта"
          options={scriptItems.map((s) => ({ value: s.id, label: s.text }))}
          selected={selectedSteps}
          onChange={(vals) => setArrayParam("step", vals)}
        />
      </section>
    </aside>
  )
}
