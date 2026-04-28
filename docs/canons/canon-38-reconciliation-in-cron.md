# Канон #38 — Daily Reconciliation (сверка PBX↔CRM↔БД в cron)

**Date:** 2026-04-28
**Memory ref:** `feedback-canon-38-daily-reconciliation.md`
**Status:** Запланирован. Реализация — после стабилизации pipeline (post-backfill 6126 diva).

---

## Rule

В каждом проходе **cron-автообновления** (когда подтягиваем свежие звонки) **дополнительно** делаем reconciliation между 3 источниками правды:

1. **onPBX** — что было звонков (ground truth для телефонии)
2. **CRM админка** (GC ленту звонков / amoCRM Notes) — что записано
3. **Наша БД** — что мы знаем

Расхождение > 5% → Telegram-alert РОПу + лог инцидента.

## Why

- РОП должен **доверять цифрам** в дашборде. Расхождения подрывают доверие
- Sync может **терять звонки** (network timeout, rate limit, GPU краш) — мы не узнаем без сверки
- CRM-PBX bridge у клиента может **сломаться** — звонки не попадают в карточки
- **Дубли** — race condition создаёт 2 записи на 1 звонок
- **Incident detection** — 0 звонков за час когда должно быть 30 → алерт

## Архитектура — встраиваем в существующий cron

```
┌─ cron каждые 30 мин (готовый Stage 3.5 + расширение) ────────┐
│                                                                │
│  1. Pull onPBX history за last 1h        → uuids_in_pbx       │
│  2. Pull CRM ленту звонков за last 1h    → uuids_in_crm       │
│  3. Sync новые звонки в CallRecord       → uuids_in_db        │
│  4. Phone resolve + Deal link (Stage 3.5) — уже есть          │
│  5. ⭐ RECONCILIATION                                          │
│     - missing_in_db = pbx - db                                 │
│     - missing_in_crm = pbx - crm                               │
│     - duplicates = db with count > 1                           │
│     - discrepancyPct = (missing+dupes) / pbx * 100             │
│  6. INSERT INTO ReconciliationCheck                            │
│  7. IF discrepancyPct > 5 → Telegram-alert                     │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**Преимущества встраивания:**
- ✅ Один проход cron делает всё (sync + link + reconciliation)
- ✅ Минимум нагрузки — данные уже в памяти
- ✅ Невозможно перепутаться — sync и reconciliation атомарны

## Schema (новая таблица)

```prisma
model ReconciliationCheck {
  id              String   @id @default(cuid())
  tenantId        String
  checkedAt       DateTime @default(now())
  windowStart     DateTime
  windowEnd       DateTime
  pbxCount        Int
  dbCount         Int
  crmCount        Int?
  missingInDb     Json?    // [uuids]
  missingInCrm    Json?    // [uuids]
  duplicates      Json?
  discrepancyPct  Float
  alertSent       Boolean  @default(false)
}
```

## UI: Канон #37 advanced tab — System Health

```
┌─ 🩺 System Health ─────────────────────────────────────┐
│ Last sync:        ✅ 5 мин назад                        │
│ Last reconcile:   ✅ 5 мин назад                        │
│                                                          │
│ За последний час:                                       │
│   PBX:  47 звонков                                      │
│   БД:   47 ✅                                           │
│   CRM:  45 ⚠️ 2 missing                                 │
│                                                          │
│ 7d trend: avg discrepancy 2.1%                          │
│                                                          │
│ Топ-5 инцидентов:                                       │
│   2026-04-25 14:30 — 8 missing in CRM                   │
│   2026-04-26 09:15 — 3 duplicates in DB                 │
│   ...                                                   │
└─────────────────────────────────────────────────────────┘
```

## Per-tenant источники

| Tenant | PBX | CRM лента | Reconciliation |
|---|---|---|---|
| diva (GC) | onPBX `/mongo_history/search.json` | scraping `/pl/teach/control/stream/calls` | 3-way: PBX/CRM/БД |
| vastu / reklama / coral (amoCRM) | Sipuni / МегаПБХ API | amoCRM `/api/v4/leads/notes?filter[note_type]=call_in/out` | 3-way |
| shumoff | TBD | TBD | 2-way pending |

## Стоимость

- 1-2 дня разработки
- **0 отдельной нагрузки** — встраивается в существующий cron каждые 30 мин
- Хранение `ReconciliationCheck` ~ 50KB / tenant / месяц (минимально)

## Когда делать

ПОСЛЕ:
1. ✅ Backfill 6126 diva стабилизируется
2. ✅ Первый прогон `/loop /enrich-calls` пройдёт
3. ✅ Cron автообновления работает стабильно неделю

Тогда добавляем reconciliation step как **расширение** уже работающего cron.

## Связь с другими канонами

- **Канон #8** (PBX metadata) — `pbxUuid` как primary key для сверки
- **Канон #37** (минимальный дашборд РОПа) — System Health в advanced tab
- **Канон #37 main** — на основе reconciliation добавить "состояние данных за сегодня" badge

## NOT to do (anti-patterns)

❌ Отдельный cron только для reconciliation — лишняя нагрузка
❌ Reconciliation в `/enrich-calls` — это data layer, не sync layer
❌ Алерты на любое расхождение — будет шум, threshold 5%+ обязателен
❌ Хранить full transcript несовпавших звонков в `ReconciliationCheck` — только UUIDs

---

## Status (2026-04-28)

- ✅ Канон зафиксирован (memory + repo)
- ⏳ Реализация — после стабилизации pipeline (post-backfill, post-/loop)
- ⏳ Schema migration `ReconciliationCheck` — отдельной итерацией
- ⏳ Логика встраивается в `cron-stage35-link-fresh-calls.ts` или новый master cron
