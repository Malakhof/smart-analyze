# UI Inventory — Pre-handoff (2026-05-03)

**Status:** premiere 4.05.2026, GC-only (`provider='GETCOURSE'`).
**Switch:** `getCrmProvider(tenantId)` в `src/lib/queries/active-window.ts` — возвращает `"GETCOURSE" | "AMOCRM" | "BITRIX24" | null`. Layout/page компоненты делают branch.

---

## Stack

- Next.js 16.2.3 (Turbopack) + React 19.2.4
- Tailwind v4 (через `@tailwindcss/postcss`, конфиг в `globals.css` через `@theme inline`, **нет `tailwind.config.ts`**)
- shadcn 4.2 (17 компонентов в `src/components/ui/`: accordion, avatar, badge, button, card, dialog, dropdown-menu, input, label, select, separator, sheet, sonner, switch, table, tabs, tooltip)
- Recharts 3.8 + `@tremor/react` 3.18
- next-themes light/dark
- lucide-react
- Prisma 7.7 (client в `@/generated/prisma/client`)

## Layout

- Topbar Header (`src/components/header.tsx`), max-width 1120px, sidebar отсутствует
- Custom CSS vars: `surface-0..4`, `text-primary..muted`, `ai-1/2/3` gradient (#7C6AEF → #5B8DEF → #4ECDC4), `status-green/amber/red`, radius 14px

## Routes — текущая карта

```
src/app/(dashboard)/
├── page.tsx                              # switch GC/legacy → 8 блоков канона #37
├── layout.tsx                            # резолвит provider, передаёт в Header
├── _components/
│   ├── (legacy: ai-insights, conversion-chart, dealstat-snapshot,
│   │    duplicate-badge, funnel-chart, funnel-switcher, key-metrics,
│   │    manager-rating-table, period-filter, revenue-potential,
│   │    success-fail-cards) — для amoCRM
│   └── gc/                               # 🆕 GC-only компоненты
│       ├── period-filter-gc.tsx          # 3-кнопка today/week/month
│       ├── dashboard-rop.tsx             # 8 блоков канона #37
│       ├── call-card.tsx                 # 11 блоков эталона + 7 типов
│       ├── managers-list.tsx
│       ├── manager-detail.tsx            # 6 счётчиков + паттерны + heatmap
│       └── client-card.tsx               # flat list + stage journey
├── calls/[pbxUuid]/page.tsx              # 🆕 GC-only route
├── managers/
│   ├── page.tsx                          # switch
│   ├── _components/                      # legacy
│   ├── [id]/
│   │   ├── page.tsx                      # switch
│   │   ├── _components/                  # legacy
│   │   └── clients/[gcContactId]/        # 🆕 GC-only route
│   │       └── page.tsx
├── deals/                                # legacy (amoCRM only)
├── patterns/                             # legacy
├── quality/page.tsx                      # ⚠️ Этап 5 откачен, сейчас legacy для всех
├── retro/                                # legacy
└── settings/                             # ⏳ Этап 6 не начат
```

## Header navigation

```ts
// src/components/header.tsx
NAV_ITEMS_GC = [Главная, Менеджеры, Контроль качества, Настройки]  // 4 пункта
NAV_ITEMS_BASE = [+ Паттерны, + Сделки]                            // amoCRM
NAV_ITEMS_WITH_RETRO = [+ Ретро аудит, ...NAV_ITEMS_BASE]          // diva-school legacy live mode
```

Switch по `crmProvider === "GETCOURSE"` (server-side в layout).

## Queries (server-side)

| Файл | Назначение |
|---|---|
| `lib/queries/active-window.ts` | `getCrmProvider`, `getTenantMode`, helpers для legacy live-mode |
| `lib/queries/dashboard-gc.ts` | 8 блоков главной + heatmap + curator helper |
| `lib/queries/call-detail-gc.ts` | `getCallDetailByPbxUuid` + `classifyCallType` (7 types A-G) |
| `lib/queries/managers-gc.ts` | список МОПов + детальная карточка с паттернами |
| `lib/queries/client-detail-gc.ts` | карточка клиента + stage journey |
| `lib/queries/dashboard.ts` | legacy (amoCRM) |
| `lib/queries/manager-detail.ts` | legacy |
| `lib/queries/managers.ts` | legacy |
| `lib/queries/quality.ts` | legacy (amoCRM + diva live) |
| `lib/queries/retro.ts` | legacy |
| `lib/queries/patterns.ts` | legacy |
| `lib/queries/deal-detail.ts` | legacy |

## Helpers (UI normalization)

В `_components/gc/call-card.tsx`:
- `unescapeNewlines(s)` — заменяет literal `\\r\\n`/`\\n`/`\\t` на real chars (Master Enrich пишет JSON-encoded в TEXT)
- `normalizeCriticalErrors(raw)` — handles mixed string | `{error, evidence, severity}`
- `asObject<T>(v)`, `asArray<T>(v)` — type-safe jsonb readers
- `SCRIPT_STAGE_LABELS` map — `1_приветствие` → «1. Приветствие» (включая варианты `2_причина` / `2_причина_звонка`, `5_крюк` / `5_выявление_потребностей`, `10_ответы` / `10_ответы_на_вопросы`)
- `CRITICAL_ERROR_LABELS` — 6 enum diva + расширения (`no_compliments`, `no_pain_discovery`)

## 7 типов звонка для условного рендера

| Тип | Признак | Что рендерится |
|---|---|---|
| **A NORMAL** | `callOutcome=real_conversation` AND `duration ≥ 60` | все 11 блоков эталона |
| **B SHORT_RESCHEDULE** | `real_conversation` AND `duration < 60` | транскрипт + summary + nextStep + commitments |
| **C VOICEMAIL_IVR** | `callOutcome IN (voicemail, ivr)` | бейдж + транскрипт + commitments |
| **D NO_SPEECH** | `transcript ≤ 100 chars` OR `callOutcome=no_speech_or_silence` | бейдж + raw transcript |
| **E HUNG_UP** | `callOutcome IN (hung_up, no_answer)` | бейдж + НДЗ + raw transcript |
| **F TECHNICAL_ISSUE** | `callOutcome=technical_issue` | 🚨 alert + транскрипт |
| **G PIPELINE_GAP** | `transcript=NULL` AND `audioUrl=NULL` | статика без AI-разбора |

`classifyCallType()` в `call-detail-gc.ts`.

## Demo URLs (diva, login `kirill+diva@smart-analyze.ru`)

- Главная: `localhost:3000/?period=month`
- Менеджеры: `localhost:3000/managers`
- Карточка МОПа: `localhost:3000/managers/<managerId>?period=month`
- Карточка клиента: `localhost:3000/managers/<managerId>/clients/<gcContactId>`
- Карточка звонка (эталоны):
  - `localhost:3000/calls/c4fe3358-a886-48b8-a280-6cc9269287d1` (Эльнура — strong_closer, 8/12 phraseCompliance, scriptScore 18/22)
  - `localhost:3000/calls/0e3bd264-bc5d-4de0-b9ff-4bc71851f7aa` (Светлана — closer)

## Что НЕ делать (anti-patterns)

- ❌ Менять цветовую палитру / шрифты / sidebar layout
- ❌ Вводить новые UI-библиотеки (Recharts + Tremor + 17 shadcn — хватает)
- ❌ Парсить GC данные клиента (только deep-link)
- ❌ Скачивать аудио в нашу инфру (`<audio src={audioUrl}>` прямой fileservice URL)
- ❌ BI-страницы (выручка / AOV / LTV / комиссия / ROI рекламы)
- ❌ Удалять legacy `/retro`, `/patterns`, `/deals` — нужны amoCRM
- ❌ Сделки как центральная сущность — у нас ЗВОНКИ (deal = маленький badge)
