"use client"

import { useSearchParams, useRouter } from "next/navigation"

const TABS = [
  { key: "crm", label: "CRM-подключение" },
  { key: "company", label: "Компания" },
  { key: "plan", label: "Тарифный план" },
  { key: "users", label: "Пользователи" },
  { key: "scripts", label: "Скрипты" },
  { key: "telegram", label: "Telegram-бот" },
  { key: "notifications", label: "Уведомления" },
] as const

export function SettingsNav() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const activeTab = searchParams.get("tab") || "crm"

  function handleTabClick(tab: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", tab)
    router.push(`/settings?${params.toString()}`)
  }

  return (
    <nav className="flex w-[200px] shrink-0 flex-col gap-0.5">
      {TABS.map((tab) => {
        const isActive = activeTab === tab.key
        return (
          <button
            key={tab.key}
            onClick={() => handleTabClick(tab.key)}
            className={`cursor-pointer rounded-[6px] px-3 py-2 text-left text-[13px] font-medium transition-all duration-[0.18s] ${
              isActive
                ? "bg-ai-glow text-ai-1"
                : "text-text-tertiary hover:bg-surface-2 hover:text-text-secondary"
            }`}
          >
            {tab.label}
          </button>
        )
      })}
    </nav>
  )
}
