"use client"

import { useState, useEffect, useCallback } from "react"

export function TelegramSettings() {
  const [botToken, setBotToken] = useState("")
  const [chatId, setChatId] = useState("")
  const [isActive, setIsActive] = useState(false)
  const [alertOnCritical, setAlertOnCritical] = useState(true)
  const [isConnected, setIsConnected] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{
    type: "success" | "error"
    text: string
  } | null>(null)

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/telegram")
      if (!res.ok) return
      const data = await res.json()
      if (data.config) {
        setBotToken(data.config.botToken || "")
        setChatId(data.config.chatId || "")
        setIsActive(data.config.isActive ?? false)
        setAlertOnCritical(data.config.alertOnCritical ?? true)
        setIsConnected(true)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  async function handleTest() {
    setTesting(true)
    setMessage(null)
    try {
      const res = await fetch("/api/settings/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", botToken, chatId }),
      })
      const data = await res.json()
      if (data.success) {
        setMessage({
          type: "success",
          text: "Тестовое сообщение отправлено!",
        })
      } else {
        setMessage({
          type: "error",
          text: data.error || "Не удалось отправить",
        })
      }
    } catch {
      setMessage({ type: "error", text: "Ошибка сети" })
    } finally {
      setTesting(false)
    }
  }

  async function handleSave(active: boolean) {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch("/api/settings/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botToken,
          chatId,
          isActive: active,
          alertOnCritical,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setMessage({ type: "error", text: data.error || "Ошибка сохранения" })
        return
      }
      setIsActive(active)
      setIsConnected(true)
      setMessage({
        type: "success",
        text: active ? "Бот подключён" : "Бот отключён",
      })
    } catch {
      setMessage({ type: "error", text: "Ошибка сети" })
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleCritical() {
    const newValue = !alertOnCritical
    setAlertOnCritical(newValue)
    if (isConnected) {
      // Auto-save the setting
      try {
        await fetch("/api/settings/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            botToken,
            chatId,
            isActive,
            alertOnCritical: newValue,
          }),
        })
      } catch {
        // ignore
      }
    }
  }

  if (loading) {
    return (
      <div className="py-8 text-center text-[13px] text-text-tertiary">
        Загрузка...
      </div>
    )
  }

  return (
    <div>
      <h2 className="mb-1 text-[20px] font-bold tracking-[-0.03em]">
        Telegram-бот
      </h2>
      <p className="mb-6 text-[13px] text-text-secondary">
        Настройте бота для получения алертов о качестве звонков.
      </p>

      {/* Status indicator */}
      <div
        className={`mb-4 inline-flex items-center gap-2 rounded-[6px] border px-3 py-1.5 text-[13px] font-medium ${
          isConnected && isActive
            ? "border-status-green-border bg-status-green-dim text-status-green"
            : "border-status-red-border bg-status-red-dim text-status-red"
        }`}
      >
        {isConnected && isActive ? (
          <>
            <span>&#10003;</span> Бот подключён
          </>
        ) : (
          <>
            <span>&#10005;</span> Бот не подключён
          </>
        )}
      </div>

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

      <div className="mb-8 flex items-center gap-3">
        {/* Test button */}
        <button
          onClick={handleTest}
          disabled={testing || !botToken || !chatId}
          className="cursor-pointer rounded-[6px] border border-border-default bg-transparent px-4 py-2 text-[13px] font-medium text-text-secondary transition-colors hover:border-border-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {testing ? "Отправка..." : "Тестировать"}
        </button>

        {/* Connect / Disconnect */}
        {isConnected && isActive ? (
          <button
            onClick={() => handleSave(false)}
            disabled={saving}
            className="cursor-pointer rounded-[6px] border border-status-red-border bg-status-red-dim px-4 py-2 text-[13px] font-semibold text-status-red transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "..." : "Отключить"}
          </button>
        ) : (
          <button
            onClick={() => handleSave(true)}
            disabled={saving || !botToken || !chatId}
            className="cursor-pointer rounded-[6px] px-4 py-2 text-[13px] font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: "var(--ai-grad)" }}
          >
            {saving ? "Подключение..." : "Подключить"}
          </button>
        )}
      </div>

      {/* Alerts config */}
      <hr className="mb-6 border-border-default" />

      <h3 className="mb-3 text-[15px] font-semibold text-text-primary">
        Настройка алертов
      </h3>

      <label className="flex cursor-pointer items-center gap-3">
        <div
          onClick={handleToggleCritical}
          className={`relative h-5 w-9 rounded-full transition-colors ${
            alertOnCritical ? "bg-ai-1" : "bg-surface-3"
          }`}
        >
          <div
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
              alertOnCritical ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </div>
        <span className="text-[13px] text-text-primary">
          Уведомлять при критичных пропусках
        </span>
      </label>
      <p className="ml-12 mt-1 text-[12px] text-text-tertiary">
        Бот отправит сообщение, когда менеджер пропустит пункт скрипта с
        отметкой &quot;Критичный&quot;
      </p>
    </div>
  )
}
