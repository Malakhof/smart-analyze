"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"

/**
 * Chip-row filter for the 7 derived call-type categories (A-G) that
 * `classifyCallType()` (call-detail-gc.ts) maps from (callOutcome, duration)
 * pairs. The row writes/reads the URL param `?ctype=NORMAL,VOICEMAIL_IVR`
 * so the filter is shareable and bookmarkable.
 *
 * Server-side honoring lives in quality-gc.ts via QcFilters.callTypes; the
 * legacy quality.ts predicate inspects the same field but is currently a
 * no-op for non-NORMAL ctypes (premiere-pragmatic — see Task 24 notes in
 * docs/plans). NORMAL keeps the existing real_conversation+duration>=60
 * baseline so the default behavior is unchanged when the chip is inactive.
 */
const TYPES = [
  { id: "NORMAL", label: "Норма" },
  { id: "SHORT_RESCHEDULE", label: "Перенос" },
  { id: "VOICEMAIL_IVR", label: "IVR" },
  { id: "HUNG_UP", label: "НДЗ" },
  { id: "NO_SPEECH", label: "Без речи" },
  { id: "TECHNICAL_ISSUE", label: "Тех." },
  { id: "PIPELINE_GAP", label: "Pipeline gap" },
] as const

export function QcCallTypeFilter() {
  const router = useRouter()
  const params = useSearchParams()
  const active = params.get("ctype")?.split(",").filter(Boolean) ?? []

  const toggle = (id: string) => {
    const next = active.includes(id)
      ? active.filter((x) => x !== id)
      : [...active, id]
    const p = new URLSearchParams(params.toString())
    if (next.length) p.set("ctype", next.join(","))
    else p.delete("ctype")
    router.push(`?${p.toString()}`)
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {TYPES.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => toggle(t.id)}
          className={cn(
            "rounded px-2 py-1 text-xs",
            active.includes(t.id)
              ? "bg-ai-1 text-white"
              : "bg-surface-3 text-text-secondary"
          )}
          aria-pressed={active.includes(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
