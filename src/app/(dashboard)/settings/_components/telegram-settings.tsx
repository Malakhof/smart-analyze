"use client"

import { useState } from "react"

export function TelegramSettings() {
  const [botToken, setBotToken] = useState("")
  const [chatId, setChatId] = useState("")
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{
    type: "success" | "error"
    text: string
  } | null>(null)

  function handleConnect() {
    setSaving(true)
    setMessage(null)
    // Placeholder: no backend endpoint yet
    setTimeout(() => {
      setSaving(false)
      setMessage({ type: "success", text: "Настройки сохранены (демо)" })
    }, 500)
  }

  return (
    <div>
      <h2 className="mb-1 text-[20px] font-bold tracking-[-0.03em]">
        Telegram-бот
      </h2>
      <p className="mb-6 text-[13px] text-text-secondary">
        Настройте бота для получения алертов о качестве звонков.
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
          Bot Token
        </label>
        <input
          type="text"
          value={botToken}
          onChange={(e) => setBotToken(e.target.value)}
          placeholder="123456:ABC-DEF..."
          className="w-full rounded-[6px] border border-border-default bg-surface-2 px-3 py-2 text-[13px] text-text-primary outline-none transition-colors focus:border-ai-1"
        />
      </div>

      <div className="mb-6 max-w-md">
        <label className="mb-1.5 block text-[12px] font-medium text-text-secondary">
          Chat ID
        </label>
        <input
          type="text"
          value={chatId}
          onChange={(e) => setChatId(e.target.value)}
          placeholder="-1001234567890"
          className="w-full rounded-[6px] border border-border-default bg-surface-2 px-3 py-2 text-[13px] text-text-primary outline-none transition-colors focus:border-ai-1"
        />
      </div>

      <button
        onClick={handleConnect}
        disabled={saving || !botToken || !chatId}
        className="mb-8 cursor-pointer rounded-[6px] px-4 py-2 text-[13px] font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: "var(--ai-grad)" }}
      >
        {saving ? "Подключение..." : "Подключить"}
      </button>

      {/* Alerts config placeholder */}
      <hr className="mb-6 border-border-default" />

      <div className="flex flex-col items-center justify-center rounded-[10px] border border-dashed border-border-default bg-surface-1 px-8 py-12 text-center">
        <div className="mb-2 text-[15px] font-semibold text-text-primary">
          Настройка алертов — в разработке
        </div>
        <div className="max-w-[320px] text-[13px] text-text-tertiary">
          Здесь можно будет выбрать критичные пункты скрипта, при нарушении
          которых бот отправит уведомление.
        </div>
      </div>
    </div>
  )
}
