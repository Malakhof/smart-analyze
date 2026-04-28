# Канон #37 — Минимальный дашборд РОПа

**Date:** 2026-04-28
**Memory ref:** `feedback-rop-dashboard-minimum.md`
**Master Enrich source:** `docs/canons/canon-master-enrich-card.md`

---

## Rule

Главный экран РОПа = строго **5 болей анкеты** + **4 metadata-insights из PBX** + **3 UX-фичи**. Остальные 4 PBX-insights → **скрытый advanced tab**. Денежные графики (выручка / AOV / комиссия) — **НЕ показывать вообще** (или вынести в отдельную «Бизнес»-вкладку как опцию).

## Why

1. **РОП покупает контроль качества разговоров, не BI на CRM.** Деньги/выручку он смотрит в CRM/1С/Excel — там полнее и быстрее. Когда мы дублируем — становимся хуже Roistat.
2. **Differentiation продукта** = «AI слушает звонки и говорит где косяк», не «BI на сделках».
3. **Прямой сигнал из анкеты diva** (раздел 9): «Алерты НЕ нужны. Юзеры — РОП + собственник.» → узкий фокус на качестве.

## How to apply

При проектировании любого нового виджета задать 4 вопроса (чек-лист):
1. Это решает боль из анкеты конкретного клиента?
2. Это просили хотя бы 2/5 клиентов?
3. Это уже не показывается в их CRM/BI?
4. Это про **разговор**, не про **сделку**?

Если ≥2 ответа НЕТ → не на главный, в advanced tab.

---

## Главный экран — 5 блоков (must-have)

### Блок 1 — Daily activity per МОП (метаданные PBX, без LLM)

| Колонка | Источник | Master Enrich field |
|---|---|---|
| Имя МОПа | onPBX `/user/get.json` map | `managerName` |
| Наборы (попытки) | `count(uuid)` per `caller_id_number` | агрегат `managerName` |
| **НДЗ** (недозвоны) | `userTalkTime = 0 AND hangupCause IN (...)` | `callOutcome = 'no_answer'` |
| **Автоответчики** | `callType = 'voicemail'` (DeepSeek classifier) | `callOutcome = 'voicemail'` |
| **Реальные разговоры** | `userTalkTime > 30 AND callType ≠ 'voicemail'` | `callOutcome = 'real_conversation'` |
| Средняя длина разговора | `avg(userTalkTime)` где real | агрегат `userTalkTime` |

### Блок 2 — Quality score per МОП (relative ranking)
- top/bottom 30% от отдела (relative, не absolute)
- Score = `scriptScore` aggregate per МОП
- Цвет: зелёный (top 30%) / жёлтый / красный (bottom 30%)
- Master Enrich field: `scriptScore`, `scriptScorePct`

### Блок 3 — Drill-down (клик по МОПу → top-10 худших звонков)
- Top-10 худших звонков сегодня per МОП
- Каждый — с AI-резюме 1 предложение из `summary` или `managerWeakSpot`
- Master Enrich fields: `cleanedTranscript`, `summary`, `managerWeakSpot`, `criticalErrors`, `ropInsight`
- Аудио + транскрипт за один клик

### Блок 4 — Chat-style ask
- Свободный ввод РОПа: «где Вася сливает?» / «кто чаще пропускает выявление потребностей?»
- DeepSeek читает enriched cards (всю schema Master Enrich) → 2-3 паттерна + ссылки на доказательства
- Использует поля: `psychTriggers`, `managerStyle`, `criticalErrors`, `keyClientPhrases`

### Блок 5 — Оценка отдела (summary всех МОПов)
- Aggregate: средний `scriptScore`, общий conversion дозвона (real / попытки), median `userTalkTime`
- Trend 7d/30d (для понимания «отдел стабилизируется или деградирует»)

---

## Advanced tab (скрыто по умолчанию)

| Insight | Когда полезен | Master Enrich field |
|---|---|---|
| Лучшее время для звонка (8:00 / 21:00 = 33% pickup) | Раз в месяц | `startStamp` distribution |
| Re-call patterns (3+ попыток к одному клиенту) | Раз в неделю | `clientPhone` + `startStamp` ordering |
| Cost per SIM (gateway attribution) | Раз в месяц | `gateway` |
| Tone analysis (позитив / негатив) | Раз в неделю | `clientReaction`, `managerStyle` |

---

## Что НЕ показывать вообще (anti-patterns)

❌ Выручка по МОПу / AOV / средний чек / комиссия (есть в CRM)
❌ Конверсия стадий воронки в %% (есть в CRM)
❌ ROI рекламных кампаний (не наша задача)
❌ LTV / retention клиентов (не наша задача)
❌ 14 виджетов на главной — РОП теряется
❌ «Все KPI равны» — нет иерархии

---

## Per-tenant адаптация

| Клиент | Главный экран | Адаптация |
|---|---|---|
| **Diva** | Базовый (5+4+3) | Две вкладки: «МОПы» + «Первая линия» (разные скрипты) |
| **Vastu** | Базовый | Sipuni вместо onPBX, тот же набор метрик |
| **Reklama** | Базовый | Sipuni, упор на категории звонков |
| **Coral** | Базовый + спец-блок «Сезонность направлений» | МегаПБХ + туристические направления как dim |
| **Shumka** | TBD | По мере подключения телефонии |

---

## Связь с другими канонами

- **Канон Master Enrich card** (`docs/canons/canon-master-enrich-card.md`) — data layer для этого view
- **Канон #6** «Финансовые графики» — пересмотреть, скорее всего убрать или вынести в advanced
- **Канон #8** «PBX call metadata required» — основа Блока 1
- **Канон #30** «Применение транскриптов в UI» — это где (страницы), этот — что (виджеты)

---

## Реализация (UI pages)

- `/managers` — Блок 1 (Daily activity per МОП)
- `/quality` — Блок 2 + Блок 5 (Quality score + оценка отдела)
- `/retro` — Блок 3 (drill-down) + Блок 4 (chat-style ask)
- `/advanced` — 4 скрытых insight'а

Все эти страницы потребляют enriched поля из БД, заполненные через `/enrich-calls` (Master Enrich slash skill).

---

## Status (2026-04-28)

- Memory canon ✅ зафиксирован
- Compiled doc canon ✅ (этот файл)
- UI implementation: ⏳ в плане tech-debts (`docs/plans/2026-04-21-tech-debts-master.md` P1)
