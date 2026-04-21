import { requireTenantId } from "@/lib/auth"
import {
  getRetroVolume,
  getRetroNonTaggedInsights,
  getRetroSectionInsights,
  getRetroManagerPortraits,
  getRetroPatterns,
} from "@/lib/queries/retro"
import { AiInsights } from "@/app/(dashboard)/_components/ai-insights"
import { RetroSection } from "./_components/retro-section"
import { RetroHero } from "./_components/retro-hero"
import { RetroMasterInsight } from "./_components/retro-master-insight"
import { RetroManagerPortraits } from "./_components/retro-manager-portraits"
import { RetroPatterns } from "./_components/retro-patterns"

export const dynamic = "force-dynamic"

export default async function RetroPage() {
  const tenantId = await requireTenantId()

  const [volume, sectionInsights, otherInsights, managers, patterns] =
    await Promise.all([
      getRetroVolume(tenantId),
      getRetroSectionInsights(tenantId),
      getRetroNonTaggedInsights(tenantId, 10),
      getRetroManagerPortraits(tenantId),
      getRetroPatterns(tenantId, 9),
    ])

  // Combine all retro-tagged insights (except master) into single accordion
  const sectionList = [
    sectionInsights.duplicates,
    sectionInsights.deals,
    sectionInsights.calls,
    sectionInsights.messages,
    sectionInsights.transcripts,
    sectionInsights.callscores,
  ].filter((i): i is NonNullable<typeof i> => i !== null)

  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-[-0.02em] text-text-primary md:text-4xl">
          Ретро аудит — что мы нашли в ваших данных
        </h1>
        <p className="mt-2 text-[14px] text-text-secondary">
          Глубокий анализ за весь доступный период работы школы
        </p>
      </header>

      {/* 1. Hero — 6 цифр (объём работы) */}
      <div className="mt-6">
        <RetroHero volume={volume} />
      </div>

      {/* 2. Master summary — главный вывод аудита */}
      {sectionInsights.master && (
        <div className="mt-8">
          <RetroMasterInsight insight={sectionInsights.master} />
        </div>
      )}

      {/* 3. Аккордеон AI Insight по отделу — Retro */}
      {sectionList.length > 0 && (
        <RetroSection
          title="🤖 Аналитика по разделам"
          subtitle="AI-вывод под каждой большой цифрой — кликни чтобы развернуть"
        >
          <AiInsights insights={sectionList} />
        </RetroSection>
      )}

      {/* 4. Менеджеры — все портреты */}
      <RetroSection
        title="👥 Портреты менеджеров"
        subtitle="Лидеры, середняки и те, кому нужна помощь"
      >
        <RetroManagerPortraits managers={managers} />
      </RetroSection>

      {/* 5. Дополнительные находки (insights без ретро-тега) */}
      {otherInsights.length > 0 && (
        <RetroSection
          title="💎 Дополнительные находки"
          subtitle="Конкретные сделки, фразы и паттерны, найденные AI"
        >
          <AiInsights insights={otherInsights} />
        </RetroSection>
      )}

      {/* 6. Паттерны 90 дней — компактно */}
      <RetroSection
        title="🔄 Паттерны за 90 дней"
        subtitle={`${patterns.length} повторяющихся закономерностей в общении с клиентами`}
      >
        <RetroPatterns patterns={patterns} />
      </RetroSection>
    </div>
  )
}
