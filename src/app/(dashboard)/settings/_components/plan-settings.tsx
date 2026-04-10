"use client"

import { useState, useEffect } from "react"

export function PlanSettings() {
  const [plan, setPlan] = useState("")
  const [dealsUsed, setDealsUsed] = useState(0)
  const [dealsLimit, setDealsLimit] = useState(0)

  useEffect(() => {
    fetchConfig()
  }, [])

  async function fetchConfig() {
    try {
      const res = await fetch("/api/settings/crm")
      if (!res.ok) return
      const data = await res.json()
      if (data.tenant) {
        setPlan(data.tenant.plan || "")
        setDealsUsed(data.tenant.dealsUsed || 0)
        setDealsLimit(data.tenant.dealsLimit || 0)
      }
    } catch {
      // ignore
    }
  }

  const planLabels: Record<string, string> = {
    DEMO: "Демо",
    BASIC: "Базовый",
    STANDARD: "Стандарт",
    PRO: "Профессиональный",
  }

  const planPrices: Record<string, { text: number; audio: number }> = {
    DEMO: { text: 0, audio: 0 },
    BASIC: { text: 100, audio: 150 },
    STANDARD: { text: 80, audio: 120 },
    PRO: { text: 60, audio: 100 },
  }

  const prices = planPrices[plan] || { text: 100, audio: 150 }
  const usagePercent = dealsLimit > 0 ? Math.round((dealsUsed / dealsLimit) * 100) : 0

  return (
    <div>
      <h2 className="mb-1 text-[20px] font-bold tracking-[-0.03em]">
        Тарифный план
      </h2>
      <p className="mb-6 text-[13px] text-text-secondary">
        Текущий план и использование.
      </p>

      {/* Plan name */}
      <div className="mb-6 rounded-[10px] border border-border-default bg-surface-1 p-5">
        <div className="mb-4 flex items-center gap-3">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
            style={{ background: "var(--ai-grad)" }}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={2}>
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <div>
            <div className="text-[15px] font-semibold text-text-primary">
              {planLabels[plan] || "---"}
            </div>
            <div className="text-[12px] text-text-tertiary">
              Лимит: {dealsLimit} сделок
            </div>
          </div>
        </div>

        {/* Usage bar */}
        <div className="mb-2">
          <div className="mb-1 flex items-center justify-between text-[12px]">
            <span className="text-text-secondary">Использовано сделок</span>
            <span className="font-medium text-text-primary">
              {dealsUsed} / {dealsLimit}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(usagePercent, 100)}%`,
                background: "var(--ai-grad)",
              }}
            />
          </div>
          <div className="mt-1 text-right text-[11px] text-text-tertiary">
            {usagePercent}%
          </div>
        </div>
      </div>

      {/* Pricing */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-[10px] border border-border-default bg-surface-1 p-4">
          <div className="mb-1 text-[12px] text-text-tertiary">
            Текстовая сделка
          </div>
          <div className="text-[20px] font-bold text-text-primary">
            {prices.text} &#8381;
          </div>
        </div>
        <div className="rounded-[10px] border border-border-default bg-surface-1 p-4">
          <div className="mb-1 text-[12px] text-text-tertiary">
            Аудио сделка
          </div>
          <div className="text-[20px] font-bold text-text-primary">
            {prices.audio} &#8381;
          </div>
        </div>
      </div>
    </div>
  )
}
