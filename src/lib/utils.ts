import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Traffic-light text-color class for a script score.
 *
 * Thresholds (Gong canon, Task 39):
 *   ≥ 70%  — green
 *   ≥ 50%  — amber
 *    < 50% — red
 *
 * `pct` is expected as a fraction in `[0, 1]`. Pass a percentage in `[0, 100]`?
 * Use `scoreColorPct100` instead. `null` returns the muted text-tertiary class.
 */
export function scoreColor(pct: number | null): string {
  if (pct === null) return "text-text-tertiary"
  if (pct >= 0.7) return "text-status-green"
  if (pct >= 0.5) return "text-status-amber"
  return "text-status-red"
}

/** Same as `scoreColor` but accepts a percentage in `[0, 100]`. */
export function scoreColorPct100(pct: number | null): string {
  if (pct === null) return "text-text-tertiary"
  return scoreColor(pct / 100)
}

/**
 * Background variant of the traffic-light, for progress bars or indicator dots.
 * Accepts a fraction in `[0, 1]`.
 */
export function scoreBg(pct: number | null): string {
  if (pct === null) return "bg-surface-3"
  if (pct >= 0.7) return "bg-status-green"
  if (pct >= 0.5) return "bg-status-amber"
  return "bg-status-red"
}

/** Same as `scoreBg` but accepts a percentage in `[0, 100]`. */
export function scoreBgPct100(pct: number | null): string {
  if (pct === null) return "bg-surface-3"
  return scoreBg(pct / 100)
}
