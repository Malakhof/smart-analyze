"use client"

import { useState, useEffect } from "react"

export function CompanySettings() {
  const [companyName, setCompanyName] = useState("")
  const [plan, setPlan] = useState("")
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{
    type: "success" | "error"
    text: string
  } | null>(null)

  useEffect(() => {
    fetchConfig()
  }, [])

  async function fetchConfig() {
    try {
      const res = await fetch("/api/settings/crm")
      if (!res.ok) return
      const data = await res.json()
      if (data.tenant) {
        setCompanyName(data.tenant.name || "")
        setPlan(data.tenant.plan || "")
      }
    } catch {
      // ignore
    }
  }

  async function handleSave() {
    setSaving(true)
    setMessage(null)
    // Company name update would need its own endpoint.
    // For now, show a placeholder message.
    setTimeout(() => {
      setSaving(false)
      setMessage({ type: "success", text: "Сохранено (демо)" })
    }, 500)
  }

  const planLabels: Record<string, string> = {
    DEMO: "Демо",
    BASIC: "Базовый",
    STANDARD: "Стандарт",
    PRO: "Профессиональный",
  }

  return (
    <div>
      <h2 className="mb-1 text-[20px] font-bold tracking-[-0.03em]">
        Компания
      </h2>
      <p className="mb-6 text-[13px] text-text-secondary">
        Основные данные вашей компании.
      </p>

      {message && (
        <div
          className={`mb-4 rounded-[6px] border px-3 py-2 text-[13px] ${
            message.type === "success"
              ? "border-status-green-border bg-status-green-dim text-status-green"
              : "border-status-red-border bg-status-red-dim text-status-red"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="mb-4 max-w-md">
        <label className="mb-1.5 block text-[12px] font-medium text-text-secondary">
          Название компании
        </label>
        <input
          type="text"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          className="w-full rounded-[6px] border border-border-default bg-surface-2 px-3 py-2 text-[13px] text-text-primary outline-none transition-colors focus:border-ai-1"
        />
      </div>

      <div className="mb-6 max-w-md">
        <label className="mb-1.5 block text-[12px] font-medium text-text-secondary">
          Тарифный план
        </label>
        <div className="rounded-[6px] border border-border-default bg-surface-2 px-3 py-2 text-[13px] text-text-tertiary">
          {planLabels[plan] || plan || "---"}
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="cursor-pointer rounded-[6px] px-4 py-2 text-[13px] font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: "var(--ai-grad)" }}
      >
        {saving ? "Сохранение..." : "Сохранить"}
      </button>
    </div>
  )
}
