"use client"

import { useSearchParams } from "next/navigation"
import { SettingsNav } from "./settings-nav"
import { CrmSettings } from "./crm-settings"
import { CompanySettings } from "./company-settings"
import { PlanSettings } from "./plan-settings"
import { ScriptsSettings } from "./scripts-settings"
import { TelegramSettings } from "./telegram-settings"

function UsersPlaceholder() {
  return (
    <div>
      <h2 className="mb-1 text-[20px] font-bold tracking-[-0.03em]">
        Пользователи
      </h2>
      <p className="mb-6 text-[13px] text-text-secondary">
        Управление пользователями и ролями.
      </p>
      <div className="flex flex-col items-center justify-center rounded-[10px] border border-dashed border-border-default bg-surface-1 px-8 py-16 text-center">
        <div className="mb-2 text-[15px] font-semibold text-text-primary">
          Раздел в разработке
        </div>
        <div className="text-[13px] text-text-tertiary">
          Приглашение пользователей и управление ролями будет доступно в
          следующем обновлении.
        </div>
      </div>
    </div>
  )
}

function NotificationsPlaceholder() {
  return (
    <div>
      <h2 className="mb-1 text-[20px] font-bold tracking-[-0.03em]">
        Уведомления
      </h2>
      <p className="mb-6 text-[13px] text-text-secondary">
        Настройка оповещений и каналов доставки.
      </p>
      <div className="flex flex-col items-center justify-center rounded-[10px] border border-dashed border-border-default bg-surface-1 px-8 py-16 text-center">
        <div className="mb-2 text-[15px] font-semibold text-text-primary">
          Раздел в разработке
        </div>
        <div className="text-[13px] text-text-tertiary">
          Настройка уведомлений будет доступна в следующем обновлении.
        </div>
      </div>
    </div>
  )
}

export function SettingsContent() {
  const searchParams = useSearchParams()
  const activeTab = searchParams.get("tab") || "crm"

  function renderContent() {
    switch (activeTab) {
      case "crm":
        return <CrmSettings />
      case "company":
        return <CompanySettings />
      case "plan":
        return <PlanSettings />
      case "users":
        return <UsersPlaceholder />
      case "scripts":
        return <ScriptsSettings />
      case "telegram":
        return <TelegramSettings />
      case "notifications":
        return <NotificationsPlaceholder />
      default:
        return <CrmSettings />
    }
  }

  return (
    <div className="flex gap-8">
      <SettingsNav />
      <div className="min-w-0 flex-1 rounded-[10px] border border-border-default bg-surface-1 p-6">
        {renderContent()}
      </div>
    </div>
  )
}
