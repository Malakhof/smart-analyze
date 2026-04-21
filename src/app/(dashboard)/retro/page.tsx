import { requireTenantId } from "@/lib/auth"
import { getDealStatSnapshot } from "@/lib/queries/dashboard"
import {
  getRetroVolume,
  getRetroNonTaggedInsights,
  getRetroSectionInsights,
  getRetroManagerPortraits,
  getRetroPatterns,
} from "@/lib/queries/retro"
import { DealStatSnapshotWidget } from "@/app/(dashboard)/_components/dealstat-snapshot"
import { RetroSection } from "./_components/retro-section"
import { RetroHero } from "./_components/retro-hero"
import { RetroSectionInsight } from "./_components/retro-section-insight"
import { RetroMasterInsight } from "./_components/retro-master-insight"
import { RetroInsightsTop } from "./_components/retro-insights-top"
import { RetroManagerPortraits } from "./_components/retro-manager-portraits"
import { RetroPatterns } from "./_components/retro-patterns"

export const dynamic = "force-dynamic"

export default async function RetroPage() {
  const tenantId = await requireTenantId()

  const [volume, sectionInsights, otherInsights, managers, patterns, dealStat] =
    await Promise.all([
      getRetroVolume(tenantId),
      getRetroSectionInsights(tenantId),
      getRetroNonTaggedInsights(tenantId, 6),
      getRetroManagerPortraits(tenantId),
      getRetroPatterns(tenantId, 9),
      getDealStatSnapshot(tenantId),
    ])

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

      {/* Master summary FIRST — главный вывод аудита */}
      {sectionInsights.master && (
        <div className="mt-6">
          <RetroMasterInsight insight={sectionInsights.master} />
        </div>
      )}

      {/* Hero — 6 huge tiles */}
      <div className="mt-8">
        <RetroHero volume={volume} />
      </div>

      {/* Per-section AI summaries */}
      <RetroSection
        title="📊 Сделки"
        subtitle={`${volume.dealsTotal.toLocaleString("ru-RU")} карточек обработано — что мы об этом думаем`}
      >
        <RetroSectionInsight
          insight={sectionInsights.deals}
          fallback="Анализ сделок ещё не сгенерирован"
        />
      </RetroSection>

      {/* Дубли клиентов — отдельный жирный блок */}
      <RetroSection
        title="🔁 Дубли клиентов — главный источник шума"
        subtitle="Один клиент = много карточек в разных воронках. Эту боль вы хотели увидеть"
      >
        <RetroSectionInsight
          insight={sectionInsights.duplicates}
          fallback="Анализ дублей ещё не сгенерирован"
        />
      </RetroSection>

      <RetroSection
        title="📞 Звонки"
        subtitle={`${volume.calls.toLocaleString("ru-RU")} звонков, ${volume.transcripts} расшифровано`}
      >
        <RetroSectionInsight
          insight={sectionInsights.calls}
          fallback="Анализ звонков ещё не сгенерирован"
        />
      </RetroSection>

      <RetroSection
        title="💬 Сообщения и переписки"
        subtitle={`${volume.messagesTotal.toLocaleString("ru-RU")} сообщений (${volume.messagesByRole.client.toLocaleString("ru-RU")} от клиентов / ${volume.messagesByRole.manager.toLocaleString("ru-RU")} от менеджеров)`}
      >
        <RetroSectionInsight
          insight={sectionInsights.messages}
          fallback="Анализ переписок ещё не сгенерирован"
        />
      </RetroSection>

      <RetroSection
        title="🎯 Расшифровки звонков"
        subtitle={`Разобрано ${volume.transcripts} разговоров — общая характеристика стиля`}
      >
        <RetroSectionInsight
          insight={sectionInsights.transcripts}
          fallback="Анализ расшифровок ещё не сгенерирован"
        />
      </RetroSection>

      <RetroSection
        title="⭐ Оценки качества звонков (100-балльная)"
        subtitle={`${volume.callScores} звонков оценено по 8 критериям продаж`}
      >
        <RetroSectionInsight
          insight={sectionInsights.callscores}
          fallback="Оценки ещё не сгенерированы"
        />
      </RetroSection>

      {/* Менеджеры — все портреты */}
      <RetroSection
        title="👥 Портреты менеджеров"
        subtitle="Лидеры, середняки и те, кому нужна помощь"
      >
        <RetroManagerPortraits managers={managers} />
      </RetroSection>

      {/* Прочие insights (без ретро-тега) */}
      {otherInsights.length > 0 && (
        <RetroSection
          title="💎 Дополнительные находки"
          subtitle="Конкретные сделки и фразы, найденные AI"
        >
          <RetroInsightsTop insights={otherInsights} />
        </RetroSection>
      )}

      {/* Паттерны — компактно */}
      <RetroSection
        title="🔄 Паттерны поведения"
        subtitle={`${patterns.length} закономерностей в общении с клиентами`}
      >
        <RetroPatterns patterns={patterns} />
      </RetroSection>

      {/* CRM raw stats внизу */}
      {dealStat && (
        <RetroSection
          title="📈 Финансы по данным CRM (raw)"
          subtitle="Pre-aggregated отчёт из GetCourse — для сравнения с нашим анализом"
        >
          <DealStatSnapshotWidget snapshot={dealStat} />
        </RetroSection>
      )}
    </div>
  )
}
