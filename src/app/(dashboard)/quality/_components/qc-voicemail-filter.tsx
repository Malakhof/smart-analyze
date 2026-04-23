"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"

interface QcVoicemailFilterProps {
  filteredCount: number
  totalCount: number
}

/**
 * Toggle that hides autoresponder / voicemail rows. Reflected in URL as
 * `?type=real`. Implemented with `<Link>` so the server component above
 * re-runs the query — no client-side state.
 *
 * The chip renders "234 / 567 показано" so the operator can see how many
 * rows the toggle removes (or "234 показано" if the toggle is off and the
 * counts match).
 */
export function QcVoicemailFilter({
  filteredCount,
  totalCount,
}: QcVoicemailFilterProps) {
  const searchParams = useSearchParams()
  const isActive = searchParams.get("type") === "real"

  // Build href that toggles `?type=real` while preserving every other param.
  const params = new URLSearchParams(searchParams.toString())
  if (isActive) {
    params.delete("type")
  } else {
    params.set("type", "real")
  }
  const queryString = params.toString()
  const href = queryString ? `?${queryString}` : "?"

  return (
    <div className="flex items-center gap-3">
      <Link
        href={href}
        scroll={false}
        prefetch={false}
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${
          isActive
            ? "border-ai-1 bg-ai-glow text-ai-1"
            : "border-border-default bg-surface-2 text-text-secondary hover:bg-surface-3 hover:text-text-primary"
        }`}
        aria-pressed={isActive}
      >
        <span
          className={`flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border text-[10px] ${
            isActive
              ? "border-ai-1 bg-ai-1 text-white"
              : "border-border-default"
          }`}
        >
          {isActive ? "✓" : ""}
        </span>
        Только реальные диалоги (скрыть автоответчики)
      </Link>
      <span className="text-[12px] text-text-tertiary tabular-nums">
        {isActive
          ? `${filteredCount} / ${totalCount} показано`
          : `${filteredCount} показано`}
      </span>
    </div>
  )
}
