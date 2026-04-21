import { requireTenantId } from "@/lib/auth"
import { getDealStatSnapshot } from "@/lib/queries/dashboard"
import {
  getRetroVolume,
  getRetroTopInsights,
  getRetroManagerPortraits,
  getRetroPatterns,
} from "@/lib/queries/retro"
import { DealStatSnapshotWidget } from "@/app/(dashboard)/_components/dealstat-snapshot"
import { RetroSection } from "./_components/retro-section"
import { RetroHero } from "./_components/retro-hero"
import { RetroVolumeBar } from "./_components/retro-volume-bar"
import { RetroInsightsTop } from "./_components/retro-insights-top"
import { RetroManagerPortraits } from "./_components/retro-manager-portraits"
import { RetroPatterns } from "./_components/retro-patterns"

export const dynamic = "force-dynamic"

export default async function RetroPage() {
  const tenantId = await requireTenantId()

  const [volume, insights, managers, patterns, dealStat] = await Promise.all([
    getRetroVolume(tenantId),
    getRetroTopInsights(tenantId, 4),
    getRetroManagerPortraits(tenantId),
    getRetroPatterns(tenantId, 9),
    getDealStatSnapshot(tenantId),
  ])

  return (
    <div className="p-6">
      <header className="mb-2">
        <h1 className="text-3xl font-extrabold tracking-[-0.02em] text-text-primary md:text-4xl">
          Ретро аудит — что мы нашли в ваших данных
        </h1>
        <p className="mt-2 text-[14px] text-text-secondary">
          Анализ за весь доступный период
        </p>
      </header>

      {/* Hero — 6 huge tiles. No section header above; this IS the headline. */}
      <div className="mt-8">
        <RetroHero volume={volume} />
      </div>

      <RetroSection
        title="Объём данных"
        subtitle="Сколько сделок, сообщений и звонков мы прочитали и разобрали"
      >
        <RetroVolumeBar volume={volume} />
      </RetroSection>

      <RetroSection
        title="Главные инсайты"
        subtitle="То, что чаще всего повторяется в успехах и провалах"
      >
        <RetroInsightsTop insights={insights} />
      </RetroSection>

      <RetroSection
        title="Портреты менеджеров"
        subtitle="Лидеры, середняки и те, кому нужна помощь"
      >
        <RetroManagerPortraits managers={managers} />
      </RetroSection>

      <RetroSection
        title="Паттерны поведения"
        subtitle="9 самых сильных закономерностей в общении с клиентами"
      >
        <RetroPatterns patterns={patterns} />
      </RetroSection>

      {dealStat && (
        <RetroSection
          title="Финансы по данным CRM"
          subtitle="Pre-aggregated отчёт из CRM-системы клиента"
        >
          <DealStatSnapshotWidget snapshot={dealStat} />
        </RetroSection>
      )}
    </div>
  )
}
