import { Suspense } from "react"
import { SettingsContent } from "./_components/settings-content"

export default function SettingsPage() {
  return (
    <>
      <h2 className="mb-5 text-[24px] font-bold tracking-[-0.04em]">
        Настройки
      </h2>
      <Suspense>
        <SettingsContent />
      </Suspense>
    </>
  )
}
