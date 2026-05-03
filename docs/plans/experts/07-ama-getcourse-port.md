# Q7: AMA → GETCOURSE Quality Page Port

**Experts:** Sam Newman (loose coupling, bounded contexts) + Martin Fowler (extract pattern, preserve behavior).
**Premiere constraint:** 4.05.2026 reviewer; ~24 h.
**User complaint:** «В АМА версии Контроль качества хорошо (графики, пироги). В GETCOURSE — пусто».

---

## 1. Root cause of "пусто" (empty page) for GC

Legacy `getQualityDashboard` / `getQcChartData` / `getQcGraphData` все три читают **`CallScore` table + `CallScoreItem`** (старая схема Master Enrich для amoCRM, где скрипт = `ScriptItem` в БД, оценка = `CallScore.totalScore` 0..100, items = ✅/❌).

**Для diva (GC tenant) Master Enrich пишет НЕ в `CallScore`, а в плоские поля `CallRecord`:**

| AMA path (legacy) | GC path (новая схема) |
|---|---|
| `CallScore.totalScore` (0..100) | `CallRecord.scriptScorePct` (0..100, derived из 11 stages) |
| `CallScoreItem.isDone` per `ScriptItem` | `CallRecord.scriptDetails` jsonb (11 этапов с `score/maxScore`) |
| `CallScore.items.aiComment` | `CallRecord.managerWeakSpot` / `ropInsight` |
| Категория = `CallRecord.category` | Категория = `CallRecord.category` (та же) |
| Теги = `CallTag` table | `CallRecord.enrichedTags` jsonb |
| Скрипт-выполнение = SQL `JOIN CallScoreItem` | `CallRecord.phraseCompliance` jsonb (12 техник diva) |

**Симптом:** для diva `CallScore.findMany` возвращает почти 0 → `scoredCalls.length=0` → `avgScore=0` → `totalCalls === 0` ranches → render «За выбранный период звонков не найдено».

Также `qcCallWhere` фильтрует `transcript: { not: null }`. Для diva 28-29 апреля callOutcome=NULL (Master Enrich pending) — но **транскрипт у них есть**, поэтому это не основной блокер. Главный блокер — пустой `CallScore`.

---

## 2. Component audit (13 + 2 page-level)

| Component | Сейчас рендерит | AMA-works | GC-works | Shape | Что нужно |
|---|---|---|---|---|---|
| `QcSummary` | 4 KPI-карточки | ✅ | ⚠️ avgScore=0 | provider-agnostic shape OK | swap query → use `scriptScorePct` |
| `QcDonutCharts` | категории + теги | ✅ | ⚠️ tags пусто | shape OK | tags читать `enrichedTags`, не `CallTag` |
| `QcComplianceChart` | tremor AreaChart 11 этапов | ✅ | ❌ полностью пусто | **need new shape** | читать `scriptDetails.stages[]` aggregated by name, не `CallScoreItem` |
| `QcScoreDistribution` | tremor BarChart 10 buckets | ✅ | ❌ полностью пусто | shape OK | использовать `scriptScorePct` (0..100) bucketing |
| `QcManagerTable` | таблица МОПов | ✅ | ⚠️ scores=0, criticalMisses=0 | shape OK | swap query → averaged `scriptScorePct`; criticalMisses = `criticalErrors` count |
| `QcRecentCalls` | таблица 20 звонков | ✅ | частично | shape OK | totalScore = `scriptScorePct`; `recommendation` = `nextStepRecommendation` для GC |
| `QcFilters` | period+category+tag+manager+step | ✅ | частично | UI shape OK | step список = `SCRIPT_STAGE_LABELS` (constant), не `ScriptItem` table |
| `QcVoicemailFilter` | toggle `?type=real` | ✅ | ⚠️ field `callType` deprecated | shape OK | для GC заменить на `callOutcome IN (real_conversation)` |
| `QcScriptScoreBadge` | badge X/22 + popover | ✅ | ✅ | provider-agnostic — already принимает `ScriptDetailsPayload` | **reuse as-is** (denom=11 в GC, но max=22 default параметр) |
| `QcTranscriptToggle` | clean/raw переключатель | ✅ | ✅ | UI-only | **reuse as-is** |
| `ScriptChecklist` | список ✅/❌ items | ✅ | ❌ читает `scoreItems` от CallScore | **need new** | для GC рендерить `scriptDetails.stages[]` |
| `AudioPlayer` | `<audio>` плеер | ✅ | ✅ | URL-only | **reuse as-is** |
| `CallSlideOver` | sheet с детализацией звонка | ✅ | ❌ fetch idет в `getCallDetail` (legacy) | **need adapter** | switch fetch → `getCallDetailByPbxUuid` для GC |
| `quality/page.tsx` | компоновка + queries | ✅ | ❌ EMPTY | — | switch by `getCrmProvider()` |
| `lib/queries/quality.ts` | все 6 query-функций | ✅ | ❌ no rows | — | дублировать в `quality-gc.ts` |

**Reusable as-is (4):** `QcScriptScoreBadge`, `QcTranscriptToggle`, `AudioPlayer`, `QcVoicemailFilter` (UI-only, URL toggle).

**Reusable со swap source (5):** `QcSummary`, `QcDonutCharts`, `QcManagerTable`, `QcRecentCalls`, `QcScoreDistribution`. Их **shape не меняется** — нужен только новый query, который наполняет те же типы из GC-полей.

**Need new shape adapter (3):** `QcComplianceChart`, `ScriptChecklist`, `CallSlideOver`. Здесь форма данных другая (`scriptDetails.stages[]` vs `CallScoreItem[]`).

**Filters (1):** `QcFilters` — UI пригоден, но scriptItems-fallback (нет `ScriptItem` table для diva).

---

## 3. GC-specific changes (что нового)

1. **Query layer:** новый `src/lib/queries/quality-gc.ts` — реэкспортирует те же интерфейсы (`QcChartData`, `QcGraphData`, `QcDashboardData`, `QcRecentCallEnhanced`), но читает из `CallRecord.scriptScorePct` / `scriptDetails` / `phraseCompliance` / `enrichedTags`.
2. **7-call-type filter (А-G)** — новый компонент `QcCallTypeFilter` (chip-row из 7 кнопок). Использует `classifyCallType()` уже существующий в `call-detail-gc.ts`. URL param `?ctype=NORMAL,VOICEMAIL_IVR,...`.
3. **Curator exclusion** — в `quality-gc.ts` использовать `getCuratorManagerIds()` из `dashboard-gc.ts` (фильтрует по фамилиям анкеты + isCurator flag).
4. **talkDuration vs duration** — для «Минут разговора» в Summary card использовать `COALESCE(talkDuration, userTalkTime)` FILTER `callOutcome='real_conversation'`, не `duration` (правило #1 из 11 принятых).
5. **Phrase compliance instead of script-step** — в `QcComplianceChart` для GC агрегировать по 12 техникам diva из `phraseCompliance` jsonb (пары used/missed), а не по `ScriptItem.text`.
6. **GC deep-link patterns** — в slide-over для GC формировать ссылки `/calls/[pbxUuid]` вместо `/quality/manager/[id]` (карточка МОПа уже на новом UI).
7. **scriptScore denom = 11** (правило #9) — использовать константу `SCRIPT_TOTAL=11`, а `QcScriptScoreBadge` уже параметризован через `maxScore`.

---

## Expert Analysis

> **Analyzing as Sam Newman + Martin Fowler.**
>
> Sam Newman: "Bounded contexts must not bleed across providers — `quality-gc` and `quality` (legacy) суть две разные доменные модели Master Enrich. Не пытаться унифицировать через один query — разделять."
>
> **Principles from 3 experts:**
> 1. Martin Fowler: **«Extract till you drop. Preserve behavior.»** Не переписывать UI — извлечь query-layer и сделать parallel implementation; компоненты остаются.
> 2. Dan Abramov: **«Lift state only when needed.»** Components получают propsы готовых форм (`QcChartData`); им всё равно откуда данные пришли — это и есть provider-agnostic shape.
> 3. Theo Browne: **«Type-safe contracts. Fail fast.»** `quality-gc.ts` должен экспортировать **те же** типы что `quality.ts`. Если shape расходится, TypeScript заорёт сразу — мёртвый рендер словить нельзя.

---

## Solution Options

### Opt 1: Legacy + GC drill-down снизу (был, откачен)

- **Essence:** оставить legacy QcSummary/Donut/Compliance (читает CallScore — будет пусто для GC) + добавить GC-specific drill-down секцию ниже с 7-call-type chips и flat-list. По коммитам `be098c1` + `96c3ca8`.
- **Pros:** uniform layout AMA/GC; не трогаем legacy code.
- **Cons:** **верхний экран ОСТАЁТСЯ ПУСТЫМ для GC** — это и есть жалоба user'а. Нижняя секция не «лечит» жалобу, она дополняет.
- **When suitable:** если user готов терпеть пустые charts вверху ради единого UI. **User уже отреверт-нул это решение — значит не подходит.**

### Opt 2: Pure legacy (no changes for GC)

- **Essence:** ничего не делать. Оставить как сейчас.
- **Pros:** 0 рисков; 0 строк кода.
- **Cons:** жалоба «пусто» **остаётся**. Reviewer 4.05 увидит пустую страницу.
- **When suitable:** если эта страница НЕ показывается reviewer'у. **Не наш случай — `/quality` есть в `NAV_ITEMS_GC` 4 пункта.**

### Opt 3: Full redesign (новый UI с 7 типами + flat list)

- **Essence:** выбросить QcSummary/Donut/Compliance, написать с нуля под анкету diva (7 типов, 12 техник, 11 этапов скрипта).
- **Pros:** идеально под GC.
- **Cons:** **24 ч мало** — нужны 4-5 дней. Половина уже сделана в Этапе 5, который user откатил без ясного reasoning'а.
- **When suitable:** post-premiere, не сейчас.

### **Opt 4 (РЕКОМЕНДОВАННАЯ — Newman/Fowler «Extract pattern, preserve behavior»):** Query-swap, UI reuse

- **Essence:** оставить **все 13 компонентов как есть** (они UI-pure, принимают provider-agnostic props). Создать `src/lib/queries/quality-gc.ts` — функции `getQualityDashboardGc / getQcChartDataGc / getQcGraphDataGc / getRecentCallsGcEnhanced / getQcCallTypeCountsGc / getQcFilterOptionsGc`, экспортирующие **те же типы** что `quality.ts`, но читающие из `scriptScorePct` / `scriptDetails` / `phraseCompliance` / `enrichedTags`. В `quality/page.tsx` — `if (provider === "GETCOURSE") { …gc queries } else { …legacy }`. Добавить GC-only `QcCallTypeFilter` (chip-row 7 типов) над таблицей recent calls.
- **Pros:**
  - **Лечит «пусто»** — все графики/пироги/таблицы сразу заполнены реальными данными для diva.
  - **Не трогает legacy** — reklama/vastu продолжают работать через `quality.ts`.
  - **24 ч хватает** — query-swap это ~250 строк SQL/Prisma + 5 строк switch в page.tsx.
  - **TypeScript guarantees consistency** — те же интерфейсы, mismatch не пройдёт.
  - **Reuse 11 из 13 компонентов** as-is; 2 (ScriptChecklist, CallSlideOver) получают minor adapter.
- **Cons:**
  - QcComplianceChart рендерит 11 этапов скрипта, но для GC лучше показывать 12 техник `phraseCompliance` — компромисс: сейчас рендерим 11 stages из `scriptDetails`, post-premiere добавим переключатель «Этапы скрипта / Техники продаж».
  - Tag breakdown для diva — придётся читать `enrichedTags` jsonb (неудобный shape) или категории Master Enrich (`callType` из анкеты типа `closer`, `lukewarm`, `cold_lead`).
- **When suitable:** именно этот случай — нужен максимально дешёвый shipable fix к premiere.

---

## Decision from Sam Newman + Martin Fowler

**Choice: Opt 4 (Query-swap, UI reuse)**

**Reasoning:**

Bounded contexts (Newman): `quality.ts` (legacy CallScore) и `quality-gc.ts` (плоские fields на CallRecord) — **разные домены**. Попытка унифицировать в один query породит nullable-cascade и сложный `WHERE provider = ?` SQL. Параллельная реализация чище.

Preserve behavior (Fowler): user уже знаком с layoutом legacy (`QcSummary/QcDonut/QcCompliance/QcManagerTable/QcRecentCalls`). После Opt 1 revert он сказал «не фигня старый дизайн — возвращайте графики». Значит дизайн ему **нравится**. Меняем источник, не рендер.

Type-safe contracts (Browne): экспортируем те же `QcChartData / QcGraphData / QcDashboardData / QcRecentCallEnhanced`. TypeScript гарантирует UI не разъедется.

Cheapest path to ship (Eyal triggers): user-action «зашёл в /quality для diva и увидел пустоту» → variable reward fail. После Opt 4 — заполненная страница, тот же UX что в reklama, нет cognitive load на переучивание.

---

## Component-by-component port plan (13 + 2)

| # | Component | Action | File / lines | Effort |
|---|---|---|---|---|
| 1 | `QcSummary` | **keep as-is**; запитать из `quality-gc.ts` | none | 0 |
| 2 | `QcDonutCharts` | **keep as-is**; для GC заполнять `tagBreakdown` из `enrichedTags` | none | 0 |
| 3 | `QcComplianceChart` | **keep as-is**; в `quality-gc.ts` агрегировать по `scriptDetails.stages[].name` (11 этапов) | none | 0 |
| 4 | `QcScoreDistribution` | **keep as-is**; bucketing по `scriptScorePct` | none | 0 |
| 5 | `QcManagerTable` | **keep as-is**; avgScore=`scriptScorePct`, criticalMisses=count(`criticalErrors`) | none | 0 |
| 6 | `QcRecentCalls` | **keep as-is**; recommendation=`nextStepRecommendation` | none | 0 |
| 7 | `QcFilters` | **minor adapter**; для GC — scriptItems = `Object.entries(SCRIPT_STAGE_LABELS)` | `qc-filters.tsx:13` (опционально проп `mode: 'ama' | 'gc'`) | 30 мин |
| 8 | `QcVoicemailFilter` | **keep as-is**; в `quality-gc.ts` `realOnly` → `callOutcome='real_conversation'` | none | 0 |
| 9 | `QcScriptScoreBadge` | **reuse**; для GC — pass `maxScore=22` (gc denom 11 для score, не для maxScore — score уже scaled внутрь). Альтернативно сделать score=raw (0..22) и стейджи 11 шт. | none | 0 |
| 10 | `QcTranscriptToggle` | **reuse** | none | 0 |
| 11 | `ScriptChecklist` | **needs new** for GC: рендерит 11 этапов из `scriptDetails`. Можно решить через slideover refactor, но MVP — оставить legacy ScriptChecklist пустым для GC и не показывать его в GC-slideover. | `_components/script-checklist.tsx` | пропустить в MVP |
| 12 | `AudioPlayer` | **reuse** | none | 0 |
| 13 | `CallSlideOver` | **adapter:** for GC сделать `<a href="/calls/{pbxUuid}">Открыть полную карточку</a>` вместо in-place fetch (карточка `/calls/[pbxUuid]` уже Этап 2 готова). Slide-over for GC показывает только summary + audio + кнопку. | `call-slide-over.tsx` (~30 строк рефактор) | 1 ч |
| 14 | `quality/page.tsx` | **switch by provider** на верхнем уровне | `quality/page.tsx:30-42` | 15 мин |
| 15 | NEW `QcCallTypeFilter` | chip-row 7 типов A-G (NORMAL/SHORT_RESCHEDULE/VOICEMAIL_IVR/NO_SPEECH/HUNG_UP/TECHNICAL_ISSUE/PIPELINE_GAP). URL `?ctype=NORMAL`. | `_components/qc-call-type-filter.tsx` | 1 ч |

---

## File paths to modify

### Create (new)
- `src/lib/queries/quality-gc.ts` — функции:
  - `getQualityDashboardGc(tenantId, filters): QcDashboardData`
  - `getQcChartDataGc(tenantId, filters): QcChartData`
  - `getQcGraphDataGc(tenantId, filters): QcGraphData`
  - `getRecentCallsGcEnhanced(tenantId, limit, filters): QcRecentCallEnhanced[]`
  - `getQcCallTypeCountsGc(tenantId, filters): { filtered: number; total: number }`
  - `getQcFilterOptionsGc(tenantId): QcFilterOptions`
  - `parseQcFiltersGcFromSearchParams(sp): QcGcFilters` (расширяет с `callTypes: string[]`)
- `src/app/(dashboard)/quality/_components/qc-call-type-filter.tsx` — chip-row 7 кнопок, URL `?ctype=...`.

### Modify
- `src/app/(dashboard)/quality/page.tsx:30` — добавить `const provider = await getCrmProvider(tenantId)` и if-branch вокруг 6 query-calls (строки 33-41) и rendering (строки 79-126). Внутри ветки `provider === "GETCOURSE"` рендерить **те же** компоненты + `<QcCallTypeFilter />` между QcVoicemailFilter и QcSummary.
- `src/app/(dashboard)/quality/_components/call-slide-over.tsx` — добавить prop `provider`; для GC заменить in-component fetch на `<Link href={\`/calls/${call.pbxUuid}\`}>`.
- `src/app/(dashboard)/quality/_components/qc-filters.tsx:13` (optional) — accept `mode: 'ama' | 'gc'` prop; для GC использовать `SCRIPT_STAGE_LABELS` keys как scriptItems.

### Reuse as-is
- `qc-summary.tsx`, `qc-donut-charts.tsx`, `qc-compliance-chart.tsx`, `qc-score-distribution.tsx`, `qc-manager-table.tsx`, `qc-recent-calls.tsx`, `qc-voicemail-filter.tsx`, `qc-script-score-badge.tsx`, `qc-transcript-toggle.tsx`, `audio-player.tsx`, `script-checklist.tsx`.

---

## 24h vs post-premiere split

### MVP в 24 ч (премьера 4.05)
1. ✅ `quality-gc.ts` — 6 query-функций (~250 строк).
2. ✅ `page.tsx` switch — 15 мин.
3. ✅ `qc-call-type-filter.tsx` (новый компонент 7 чипов) — 1 ч.
4. ✅ `call-slide-over.tsx` — заменить fetch на link для GC — 1 ч.
5. ✅ Smoke test для diva: `localhost:3000/quality?period=month` → должна показать заполненные QcSummary (avgScore real), QcDonutCharts (категории), QcComplianceChart (11 этапов), QcScoreDistribution (buckets), QcManagerTable, QcRecentCalls — 30 мин.

**Total: 4-5 ч работы. Есть запас.**

### Backlog (post-premiere)
1. `QcComplianceChart` toggle «Этапы скрипта / 12 техник продаж» — 1 день.
2. `ScriptChecklist` v2 для GC — рендер 11 stages из `scriptDetails` — 0.5 дня.
3. `CallSlideOver` v2 для GC inline (без перехода на /calls/[pbxUuid]) — 1 день.
4. `QcRecentCalls` доп. колонки: critical errors count, weakSpot summary — 0.5 дня.
5. Tag breakdown — отказ от `CallTag` table в пользу `enrichedTags` jsonb с union types — 1 день.
6. Comparison period (`previous` поля) — сейчас плейсхолдер с random; реальный previous-window sum — 1 день.

---

## Risks (Newman/Fowler caveats)

1. **Type drift:** `quality-gc.ts` экспортирует **те же** интерфейсы, что `quality.ts` — НЕ дублировать `QcChartData` и т.п., re-export. Если потом legacy эволюционирует, GC должен следовать (или forking явный).
2. **`scriptScorePct` NULL** — для звонков 28-29 апреля (Master Enrich pending) `scriptScorePct=NULL`. Они выпадут из avgScore → footer должен показывать «⏳ ожидают Master Enrich: N (X%)» — копировать helper из `dashboard-gc.ts`.
3. **`scriptDetails` jsonb sort** — keys в Postgres не упорядочены, `regex /^\d+/` для нормализации (правило #10). Уже решено в `call-card.tsx`.
4. **`criticalErrors` mixed format** — `normalizeCriticalErrors()` helper (правило #4). Если QcManagerTable будет показывать criticalMisses count — использовать его.
5. **Curator exclusion** — `getCuratorManagerIds()` нужно применять к QcManagerTable И к bestManager/worstManager расчёту, иначе кураторы попадут в топ.
6. **Revert risk:** user уже один раз откатил Stage 5 (`9679085`). Перед коммитом — показать скриншоты `/quality` для diva (с заполненными графиками) и явно проговорить «делаю Opt 4: query-swap, UI legacy остаётся». Иначе риск второго revert.
7. **Tag colors** — `enrichedTags` jsonb может быть массивом строк или объектов с severity. Нужен normalizer аналогично criticalErrors. Если deferred — для GC tag breakdown в MVP можно показать `category` distribution в обоих donutах (sub-optimal, но не пусто).
