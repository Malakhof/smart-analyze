import type { ReactNode } from "react"

export function Field({ value, fallback = "skip" }: {
  value: unknown
  fallback?: "skip" | "dash" | "loading"
}): ReactNode {
  if (value === null || value === undefined || value === "") {
    if (fallback === "skip") return null
    if (fallback === "dash") return <span className="text-text-muted">—</span>
    if (fallback === "loading") return <span className="text-text-tertiary">…загрузка</span>
  }
  return <>{typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value)}</>
}
