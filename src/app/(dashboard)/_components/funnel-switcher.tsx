"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"

interface FunnelOption {
  id: string
  name: string
  dealCount: number
}

interface FunnelSwitcherProps {
  funnels: FunnelOption[]
  selectedId?: string
}

export function FunnelSwitcher({ funnels, selectedId }: FunnelSwitcherProps) {
  const router = useRouter()
  const sp = useSearchParams()
  const [isPending, startTransition] = useTransition()

  // Default selection = busiest funnel (matches server-side default)
  const sorted = [...funnels].sort((a, b) => b.dealCount - a.dealCount)
  const effectiveId = selectedId ?? sorted[0]?.id

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value
    const params = new URLSearchParams(sp.toString())
    params.set("funnel", id)
    startTransition(() => {
      router.push(`?${params.toString()}`, { scroll: false })
    })
  }

  return (
    <select
      value={effectiveId}
      onChange={onChange}
      disabled={isPending}
      className="cursor-pointer rounded-md border border-border-default bg-surface-1 px-2.5 py-1 text-[12px] text-text-secondary transition-colors hover:border-border-hover focus:outline-none focus:ring-1 focus:ring-ai-1"
    >
      {sorted.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name} ({f.dealCount})
        </option>
      ))}
    </select>
  )
}
