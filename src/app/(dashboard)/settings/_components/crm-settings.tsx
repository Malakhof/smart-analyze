"use client"

import { useState, useEffect } from "react"

interface CrmConfigData {
  id: string
  provider: "BITRIX24" | "AMOCRM" | "GETCOURSE"
  webhookUrl: string | null
  apiKey: string | null
  subdomain: string | null
  gcEmail: string | null
  gcPassword: string | null
  isActive: boolean
  lastSyncAt: string | null
}

interface FunnelData {
  id: string
  name: string
}

export function CrmSettings() {
  const [bitrixUrl, setBitrixUrl] = useState("")
  const [bitrixConnected, setBitrixConnected] = useState(false)
  const [bitrixCompany, setBitrixCompany] = useState("")
  const [bitrixLastSync, setBitrixLastSync] = useState<string | null>(null)
  const [funnels, setFunnels] = useState<FunnelData[]>([])
  const [selectedFunnel, setSelectedFunnel] = useState("")

  const [amoSubdomain, setAmoSubdomain] = useState("")
  const [amoApiKey, setAmoApiKey] = useState("")
  const [amoConnected, setAmoConnected] = useState(false)

  const [gcSubdomain, setGcSubdomain] = useState("")
  const [gcEmail, setGcEmail] = useState("")
  const [gcPassword, setGcPassword] = useState("")
  const [gcConnected, setGcConnected] = useState(false)
  const [gcTesting, setGcTesting] = useState(false)

  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)

  useEffect(() => {
    fetchConfig()
  }, [])

  async function fetchConfig() {
    try {
      const res = await fetch("/api/settings/crm")
      if (!res.ok) return
      const data = await res.json()

      const bitrix = data.configs?.find(
        (c: CrmConfigData) => c.provider === "BITRIX24",
      )
      if (bitrix) {
        setBitrixUrl(bitrix.webhookUrl || "")
        setBitrixConnected(bitrix.isActive)
        setBitrixLastSync(bitrix.lastSyncAt)
      }

      const amo = data.configs?.find(
        (c: CrmConfigData) => c.provider === "AMOCRM",
      )
      if (amo) {
        setAmoSubdomain(amo.subdomain || "")
        setAmoConnected(amo.isActive)
      }

      const gc = data.configs?.find(
        (c: CrmConfigData) => c.provider === "GETCOURSE",
      )
      if (gc) {
        setGcSubdomain(gc.subdomain || "")
        setGcEmail(gc.gcEmail || "")
        setGcConnected(gc.isActive)
      }

      if (data.tenant?.name) {
        setBitrixCompany(data.tenant.name)
      }

      if (data.funnels) {
        setFunnels(data.funnels)
      }
    } catch {
      // ignore
    }
  }

  async function handleSaveBitrix() {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch("/api/settings/crm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "BITRIX24",
          webhookUrl: bitrixUrl,
          funnelId: selectedFunnel || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setMessage({ type: "error", text: data.error || "Ошибка сохранения" })
        return
      }
      setBitrixConnected(true)
      setMessage({ type: "success", text: "Сохранено" })
    } catch {
      setMessage({ type: "error", text: "Ошибка сети" })
    } finally {
      setSaving(false)
    }
  }

  async function handleSync() {
    setSyncing(true)
    setMessage(null)
    try {
      const res = await fetch("/api/settings/crm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "BITRIX24", webhookUrl: bitrixUrl }),
      })
      const data = await res.json()
      if (data.success) {
        setBitrixConnected(true)
        setBitrixLastSync(new Date().toISOString())
        if (data.company) setBitrixCompany(data.company)
        setMessage({ type: "success", text: "Синхронизация выполнена" })
      } else {
        setMessage({ type: "error", text: data.error || "Не удалось подключиться" })
      }
    } catch {
      setMessage({ type: "error", text: "Ошибка сети" })
    } finally {
      setSyncing(false)
    }
  }

  async function handleConnectAmo() {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch("/api/settings/crm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "AMOCRM",
          subdomain: amoSubdomain,
          apiKey: amoApiKey,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setMessage({ type: "error", text: data.error || "Ошибка подключения" })
        return
      }
      setAmoConnected(true)
      setMessage({ type: "success", text: "amoCRM подключен" })
    } catch {
      setMessage({ type: "error", text: "Ошибка сети" })
    } finally {
      setSaving(false)
    }
  }

  async function handleTestGc() {
    setGcTesting(true)
    setMessage(null)
    try {
      const res = await fetch("/api/settings/crm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "GETCOURSE",
          subdomain: gcSubdomain,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setMessage({ type: "success", text: "GetCourse доступен" })
      } else {
        setMessage({ type: "error", text: data.error || "Не удалось подключиться к GetCourse" })
      }
    } catch {
      setMessage({ type: "error", text: "Ошибка сети" })
    } finally {
      setGcTesting(false)
    }
  }

  async function handleSaveGc() {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch("/api/settings/crm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "GETCOURSE",
          subdomain: gcSubdomain,
          gcEmail,
          gcPassword,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setMessage({ type: "error", text: data.error || "Ошибка сохранения" })
        return
      }
      setGcConnected(true)
      setMessage({ type: "success", text: "GetCourse подключён" })
    } catch {
      setMessage({ type: "error", text: "Ошибка сети" })
    } finally {
      setSaving(false)
    }
  }

  function formatDate(iso: string | null) {
    if (!iso) return null
    const d = new Date(iso)
    return d.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
    }) + ", " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
  }

  return (
    <div>
      <h2 className="mb-1 text-[20px] font-bold tracking-[-0.03em]">
        Подключение CRM
      </h2>
      <p className="mb-6 text-[13px] text-text-secondary">
        Настройте интеграцию для автоматической загрузки сделок.
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

      {/* Bitrix24 */}
      <div
        className={`mb-3 inline-flex items-center gap-2 rounded-[6px] border px-3 py-1.5 text-[13px] font-medium ${
          bitrixConnected
            ? "border-status-green-border bg-status-green-dim text-status-green"
            : "border-status-red-border bg-status-red-dim text-status-red"
        }`}
      >
        {bitrixConnected ? (
          <>
            <span>&#10003;</span> Битрикс24 подключён{bitrixCompany ? ` — ${bitrixCompany}` : ""}
          </>
        ) : (
          <>
            <span>&#10005;</span> Битрикс24 не подключён
          </>
        )}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-text-secondary">
            Webhook URL
          </label>
          <input
            type="text"
            value={bitrixUrl}
            onChange={(e) => setBitrixUrl(e.target.value)}
            placeholder="https://portal.bitrix24.ru/rest/1/abc123xyz/"
            className="w-full rounded-[6px] border border-border-default bg-surface-2 px-3 py-2 text-[13px] text-text-primary outline-none transition-colors focus:border-ai-1"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-text-secondary">
            Воронка
          </label>
          <select
            value={selectedFunnel}
            onChange={(e) => setSelectedFunnel(e.target.value)}
            className="w-full rounded-[6px] border border-border-default bg-surface-2 px-3 py-2 text-[13px] text-text-primary outline-none transition-colors focus:border-ai-1"
          >
            <option value="">Все воронки</option>
            {funnels.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={handleSync}
          disabled={syncing || !bitrixUrl}
          className="cursor-pointer rounded-[6px] px-4 py-2 text-[13px] font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: "var(--ai-grad)" }}
        >
          {syncing ? "Синхронизация..." : "Синхронизировать"}
        </button>
        <button
          onClick={handleSaveBitrix}
          disabled={saving || !bitrixUrl}
          className="cursor-pointer rounded-[6px] border border-border-default bg-transparent px-4 py-2 text-[13px] font-medium text-text-secondary transition-colors hover:border-border-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Сохранение..." : "Сохранить"}
        </button>
        {bitrixLastSync && (
          <span className="text-[11px] text-text-tertiary">
            {formatDate(bitrixLastSync)}
          </span>
        )}
      </div>

      {/* Divider */}
      <hr className="mb-6 border-border-default" />

      {/* amoCRM */}
      <div
        className={`mb-3 inline-flex items-center gap-2 rounded-[6px] border px-3 py-1.5 text-[13px] font-medium ${
          amoConnected
            ? "border-status-green-border bg-status-green-dim text-status-green"
            : "border-status-red-border bg-status-red-dim text-status-red"
        }`}
      >
        {amoConnected ? (
          <>
            <span>&#10003;</span> amoCRM подключён
          </>
        ) : (
          <>
            <span>&#10005;</span> amoCRM не подключён
          </>
        )}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-text-secondary">
            Субдомен
          </label>
          <input
            type="text"
            value={amoSubdomain}
            onChange={(e) => setAmoSubdomain(e.target.value)}
            placeholder="company.amocrm.ru"
            className="w-full rounded-[6px] border border-border-default bg-surface-2 px-3 py-2 text-[13px] text-text-primary outline-none transition-colors focus:border-ai-1"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-text-secondary">
            API-ключ
          </label>
          <input
            type="password"
            value={amoApiKey}
            onChange={(e) => setAmoApiKey(e.target.value)}
            placeholder="Ключ"
            className="w-full rounded-[6px] border border-border-default bg-surface-2 px-3 py-2 text-[13px] text-text-primary outline-none transition-colors focus:border-ai-1"
          />
        </div>
      </div>

      <button
        onClick={handleConnectAmo}
        disabled={saving || !amoSubdomain || !amoApiKey}
        className="cursor-pointer rounded-[6px] border border-border-default bg-transparent px-4 py-2 text-[13px] font-medium text-text-secondary transition-colors hover:border-border-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        Подключить amoCRM
      </button>

      {/* Divider */}
      <hr className="my-6 border-border-default" />

      {/* GetCourse */}
      <div
        className={`mb-3 inline-flex items-center gap-2 rounded-[6px] border px-3 py-1.5 text-[13px] font-medium ${
          gcConnected
            ? "border-status-green-border bg-status-green-dim text-status-green"
            : "border-status-red-border bg-status-red-dim text-status-red"
        }`}
      >
        {gcConnected ? (
          <>
            <span>&#10003;</span> GetCourse подключён
          </>
        ) : (
          <>
            <span>&#10005;</span> GetCourse не подключён
          </>
        )}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-text-secondary">
            Аккаунт (субдомен)
          </label>
          <input
            type="text"
            value={gcSubdomain}
            onChange={(e) => setGcSubdomain(e.target.value)}
            placeholder="myschool"
            className="w-full rounded-[6px] border border-border-default bg-surface-2 px-3 py-2 text-[13px] text-text-primary outline-none transition-colors focus:border-ai-1"
          />
          <p className="mt-1 text-[11px] text-text-tertiary">
            myschool.getcourse.ru
          </p>
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-text-secondary">
            Email сотрудника
          </label>
          <input
            type="email"
            value={gcEmail}
            onChange={(e) => setGcEmail(e.target.value)}
            placeholder="manager@company.ru"
            className="w-full rounded-[6px] border border-border-default bg-surface-2 px-3 py-2 text-[13px] text-text-primary outline-none transition-colors focus:border-ai-1"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-text-secondary">
            Пароль сотрудника
          </label>
          <input
            type="password"
            value={gcPassword}
            onChange={(e) => setGcPassword(e.target.value)}
            placeholder="Пароль"
            className="w-full rounded-[6px] border border-border-default bg-surface-2 px-3 py-2 text-[13px] text-text-primary outline-none transition-colors focus:border-ai-1"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleTestGc}
          disabled={gcTesting || !gcSubdomain}
          className="cursor-pointer rounded-[6px] px-4 py-2 text-[13px] font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: "var(--ai-grad)" }}
        >
          {gcTesting ? "Проверка..." : "Проверить подключение"}
        </button>
        <button
          onClick={handleSaveGc}
          disabled={saving || !gcSubdomain || !gcEmail || !gcPassword}
          className="cursor-pointer rounded-[6px] border border-border-default bg-transparent px-4 py-2 text-[13px] font-medium text-text-secondary transition-colors hover:border-border-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Сохранение..." : "Сохранить"}
        </button>
      </div>
    </div>
  )
}
