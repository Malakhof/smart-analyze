# План — UI Rebuild SalesGuru под канон #37 + анкету diva (GC-only)

**Дата:** 2026-04-30
**Approval gate:** этот файл. После «ОК» — этап 1, не раньше.
**Скоуп:** ТОЛЬКО tenants где `CrmConfig.provider='GETCOURSE'`. amoCRM-tenants (`reklamalift74`, `vastu`) видят старый UI без изменений.

---

## 1. ЦЕЛИ И НЕ-ЦЕЛИ (расшифровка user'а 30.04 + handoff'ы)

### Цель сессии
> «Чтоб РОП открывал → сразу видел дашборд (Канон #37) → drill-down в МОПов → drill-down в звонок (карточка по эталону) → задачи/обещания (Block 7).»
> *(2026-04-28-ui-rebuild-handoff.md, строка 76)*

> «Делать НЕ то что у CRM, а то чего нет — контроль качества разговоров.»
> *(canon-37, строка 18)*

### Что строим
1. Главная = **Дашборд РОПа Канон #37** (5 блоков, без BI)
2. Карточка звонка = **эталон sample-3 + sample-4** (TABLE-RICH с эмодзи)
3. Карточка МОПа = 6 счётчиков из анкеты diva 9.1-9.5 + pipeline_gap
4. Карточка клиента = flat-список звонков по `gcContactId` + 3 deep-link'а
5. Контроль качества = скрипт-ориентированный rating с фильтрами 7 типов звонка
6. Settings = телефония + health (cron last_sync, GC cookie expires_at)

### Не-цели
- ❌ Ретро-аудит (никто не просил, дублирует CRM)
- ❌ BI-страницы (выручка / AOV / LTV / комиссия / ROI рекламы)
- ❌ Потенциалы выручки/провала
- ❌ Сделки как центральная сущность (у нас ЗВОНКИ)
- ❌ Воронка как главная страница (у diva нет осмысленной воронки)
- ❌ Парсинг клиентских данных GC (только deep-link)
- ❌ Скачивание аудио в нашу инфру (играть прямой `audioUrl`)
- ❌ Любая косметика дизайна / новые UI-библиотеки / смена цветовой палитры

---

## 2. КАРТА СТРАНИЦ

| Route | Статус | Действие |
|---|---|---|
| `/` | МЕНЯЕТСЯ | старый KeyMetrics+RevenuePotential+FunnelChart → 5 блоков канона #37 |
| `/quality` | МЕНЯЕТСЯ | список звонков с фильтрами по 7 типам + script rating |
| `/managers` | МЕНЯЕТСЯ | исключить `isCurator=true`, рейтинг по `scriptScorePct` + phraseCompliance |
| `/managers/[id]` | МЕНЯЕТСЯ | 6 счётчиков из анкеты + pipeline_gap badge + список клиентов |
| `/managers/[id]/clients/[gcContactId]` | НОВАЯ | flat-список звонков клиента + 3 GC deep-link'а |
| `/calls/[pbxUuid]` | НОВАЯ | карточка звонка по эталону sample-3/4 |
| `/settings` | МЕНЯЕТСЯ | + телефония (onPBX status), + health (cron sync, GC cookie) |
| `/retro` | УДАЛЯЕТСЯ | ретро-аудит — никто не просил |
| `/patterns` | УДАЛЯЕТСЯ | паттерны — данные интегрируются в карточку МОПа |
| `/deals` | УДАЛЯЕТСЯ для GC | deals не центральная сущность; для amoCRM остаётся |

### Header navigation (для GC-tenants)
```
Главная | Менеджеры | Контроль качества | Настройки
```
Удалить из навигации (для GC): «Ретро аудит», «Паттерны», «Сделки».

### Переключение GC vs amoCRM
- В `getTenantMode()` (`src/lib/queries/active-window.ts:8`) уже есть infra по `tenant.name`. Заменить на `CrmConfig.provider='GETCOURSE'` (новый helper `getCrmProvider(tenantId)`).
- В `app/(dashboard)/page.tsx` и `header.tsx` switch: GC → новый UI, иначе → старый UI остаётся как есть.

---

## 3. СПЕЦИФИКАЦИЯ КАЖДОЙ СТРАНИЦЫ

### 3.1 Главная `/` = Дашборд РОПа

**Header:**
- `<h1>` «Дашборд» + tenant display name (Diva School)
- Period filter: today / week / month (default = today для diva)
- Last-sync timestamp: «Обновлено N мин назад» (берём `MAX(CallRecord.createdAt)`)
- Опц. badge: `pipeline_gap` если % за период > 10%: «N% звонков без аудио — проверить тех. отдел»

**Block 1 — Daily Activity per МОП**

Sortable Table (shadcn `<Table>` с sticky header):

| МОП | Наборы | Дозвоны (real) | НДЗ | Автоответчики | Минут разговора (talkDuration) | Без аудио |
|---|---|---|---|---|---|---|
| Ольга | 47 | 36 | 8 | 3 | 5:42 | 0 |
| Татьяна | 38 | 21 | 12 | 5 | 4:11 | 2 ⚠️ |

⭐ **«Минут разговора» = `SUM(talkDuration)`, НЕ `SUM(duration)` и НЕ `SUM(userTalkTime)`.** Это живой разговор из GC «Продолжительность разговора», заполняется на Stage 7.5b cron. Если `talkDuration IS NULL` (старые карточки до Stage 7.5b) — fallback на `userTalkTime`. Никогда не использовать `duration` (это длительность ЗАПИСИ с гудками+IVR — раздуется метрика на 50-100%).

SQL источник:
```sql
SELECT m.name,
  COUNT(*) AS dialed,
  COUNT(*) FILTER (WHERE c."callOutcome"='real_conversation') AS real,
  COUNT(*) FILTER (WHERE c."callOutcome" IN ('no_answer','hung_up')) AS ndz,
  COUNT(*) FILTER (WHERE c."callOutcome"='voicemail') AS voicemail,
  ROUND(SUM(COALESCE(c."talkDuration", c."userTalkTime"))
        FILTER (WHERE c."callOutcome"='real_conversation') / 60.0, 1) AS talk_min,
  COUNT(*) FILTER (WHERE c.transcript IS NULL AND c."audioUrl" IS NULL) AS pipeline_gap
FROM "CallRecord" c
JOIN "Manager" m ON c."managerId"=m.id
WHERE c."tenantId"=$1
  AND c."createdAt" >= $period_start
  AND m."isCurator" = false
GROUP BY m.id, m.name
ORDER BY dialed DESC;
```

Click row → `/managers/[id]`.

**Block 2 — Quality Score per МОП (avg scriptScorePct)**

Recharts `<BarChart>` horizontal:
- ось Y — имя МОПа
- ось X — `AVG(scriptScorePct)` × 100, диапазон 0-100
- цвет: top 30% зелёный (`status-green`), bottom 30% красный (`status-red`), середина amber
- фильтр: `WHERE callOutcome='real_conversation' AND duration ≥ 60`
- tooltip: «N звонков, avg score X.X/9»

**Block 3 — Топ-10 худших звонков сегодня**

Список карточек (shadcn `<Card>`), отсортированных `scriptScorePct ASC`:

```
┌─ Звонок 5cb7b77d  ⚠️ 3/9 (33%) ──────────────────────┐
│ Ольга → Алёна  | 28.04 14:32  | 5:04                  │
│ "Не сделала попытку сделки. Упустила пик готовности."  │
│ Бейджи: [no_close_attempt] [продажи_новый]            │
│ [→ Открыть карточку]                                  │
└────────────────────────────────────────────────────────┘
```

Поля: `pbxUuid`, `manager.name`, `clientName`, `createdAt` (МСК), `userTalkTime` (форматирован mm:ss), `scriptScorePct`, `managerWeakSpot` (1 строка), `criticalErrors[0]`, `callType`. Фильтр: `transcript IS NOT NULL AND callOutcome='real_conversation' AND duration ≥ 60`.

Click → `/calls/[pbxUuid]`.

**Block 4 — Топ-3 фразы которые МОПы НЕ используют (из 12 техник)**

Recharts `<BarChart>` или просто 3 cards с прогресс-индикатором:

```
┌─ "Выбор без выбора" не использован в 67% звонков (320/477) ──┐
│ Подсказка: "Вам какой вариант удобнее — оплатить или         │
│           в рассрочку?" после презентации                    │
└──────────────────────────────────────────────────────────────┘
```

SQL агрегат `phraseCompliance` jsonb (см. data-layer-handoff строка 41-50). 12 техник: `программирование_звонка | искренние_комплименты | эмоциональный_подхват | юмор_забота | крюк_к_боли | презентация_под_боль | попытка_сделки_без_паузы | выбор_без_выбора | бонусы_с_дедлайном | повторная_попытка_после_возражения | маленькая_просьба | следующий_шаг_с_временем`.

**Block 4b — ПАТТЕРНЫ ОТДЕЛА** 🆕

Три карточки рядом (grid 3 cols):

```
┌─ Топ-5 повторяющихся managerWeakSpot ────────────────┐
│ "не сделала попытку сделки"          12 раз / 8 МОПов │
│ "монолог не привязан к боли"         9 раз / 5 МОПов  │
│ "не отработала возражение 'дорого'"  7 раз / 4 МОПов  │
│ "упустила пик готовности"            6 раз / 3 МОПов  │
│ "не назначила следующий шаг"         5 раз / 4 МОПов  │
└────────────────────────────────────────────────────────┘
┌─ Топ-5 critical errors отдела ───────────────────────┐
│ no_close_attempt           23% звонков (47/200)       │
│ monolog_not_pain_tied      18% звонков (36/200)       │
│ no_objection_handling      14% звонков (28/200)       │
│ no_needs_discovery         11% звонков (22/200)       │
│ interrupted_client          5% звонков (10/200)       │
└────────────────────────────────────────────────────────┘
┌─ Топ-3 фразы из 12 техник которые НЕ используют ──────┐
│ (то что было Block 4 — переиспользуем)                 │
└────────────────────────────────────────────────────────┘
```

SQL топ weakSpot:
```sql
SELECT "managerWeakSpot" AS spot,
  COUNT(*) AS occurrences,
  COUNT(DISTINCT "managerId") AS managers
FROM "CallRecord"
WHERE "tenantId"=$1 AND "managerWeakSpot" IS NOT NULL
  AND "createdAt" >= $period_start
GROUP BY "managerWeakSpot"
ORDER BY occurrences DESC LIMIT 5;
```

SQL топ critical errors (jsonb unnest):
```sql
SELECT err, COUNT(*)::float / (SELECT COUNT(*) FROM "CallRecord" WHERE ...) AS pct
FROM "CallRecord", jsonb_array_elements_text("criticalErrors") AS err
WHERE "tenantId"=$1 AND "createdAt" >= $period_start
GROUP BY err ORDER BY COUNT(*) DESC LIMIT 5;
```

**Block 5 — Невыполненные обещания Block 7 (>24ч)**

Список (shadcn `<Card>` + `<Badge>`):

```
┌─ ⏰ 2 дня назад ─ Ольга → Эльнура ────────────────────┐
│ "Делаю ссылочку на частичную оплату"  07:22           │
│ Action: send_payment_link  | Deadline: сразу           │
│ Status: ❌ не выполнено (по CRM нет задачи закрытой)    │
│ [→ Открыть звонок c4fe3358]                            │
└────────────────────────────────────────────────────────┘
```

Источник: `extractedCommitments` jsonb где `commitmentsTracked=false AND createdAt < now() - 24h`. Top 10.

**Block 6 — Тепловая карта дозвонов** 🆕

Heatmap 7 дней × 24 часа. Цвет = success rate (`real_conversation %`). Recharts composable либо canvas-grid из shadcn.

SQL:
```sql
SELECT
  EXTRACT(DOW FROM "startStamp" AT TIME ZONE 'Europe/Moscow') AS dow,
  EXTRACT(HOUR FROM "startStamp" AT TIME ZONE 'Europe/Moscow') AS hour,
  COUNT(*) FILTER (WHERE "callOutcome"='real_conversation')::float
    / NULLIF(COUNT(*), 0) AS success_rate,
  COUNT(*) AS total
FROM "CallRecord"
WHERE "tenantId"=$1 AND "startStamp" >= NOW() - INTERVAL '30 days'
GROUP BY dow, hour;
```

Tooltip на hover: «Пн 14:00 — 47 звонков, 67% success».

**Block 7 — Этапы воронки** 🆕 (заменяет страницу `/funnel`)

Donut или horizontal bar chart: `Deal.stageName` → count активных открытых карточек.

SQL:
```sql
SELECT "stageName", COUNT(*) AS open_deals
FROM "Deal"
WHERE "tenantId"=$1 AND status='OPEN'
GROUP BY "stageName"
ORDER BY open_deals DESC;
```

Без % конверсий — просто **сколько клиентов сейчас на каком этапе**. Click сегмент → `/quality?stageName=X` (фильтр звонков по этапу).

---

### 3.2 Контроль качества `/quality`

**Header:** title + фильтры:
- Period: today / week / month
- callType (8 enum'ов)
- callOutcome (5 enum'ов)
- Manager (select)
- hadRealConversation (toggle)

**Список звонков** (shadcn `<Table>`):

| pbxUuid | Дата (МСК) | МОП | Клиент | Длит. | callType | scriptScorePct | criticalErrors | callOutcome |
|---|---|---|---|---|---|---|---|---|
| 5cb7b77d... | 28.04 14:32 | Ольга | Алёна | 5:04 | продажи_новый | 33% 🔴 | [no_close_attempt] | real_conversation |

Sortable по `scriptScorePct`, `createdAt`, `userTalkTime`. Pagination 50/page.

**Drill-down:** click row → `/calls/[pbxUuid]`.

---

### 3.3 Менеджеры `/managers`

**Header:** title «Менеджеры» + period filter.

**Список МОПов** (shadcn `<Table>`):

| МОП | Звонков | scriptScorePct avg | phraseCompliance avg | pipeline_gap % | Топ-1 critical error |
|---|---|---|---|---|---|
| Ольга | 47 | 78% 🟢 | 8/12 | 0% | (none) |
| Татьяна | 38 | 52% 🟡 | 4/12 | 5% | no_close_attempt |

Filter: `isCurator=false` (исключаем по полю `Manager.isCurator` или матчингу анкеты diva). 

Click row → `/managers/[id]`.

---

### 3.4 Карточка МОПа `/managers/[id]`

**Header:** имя МОПа + период filter + breadcrumbs `Менеджеры / Ольга`.

**Block A — 6 счётчиков** (grid 3x2 на desktop, shadcn `<Card>`):

```
┌─ Наборы ─┐ ┌─ Дозвоны ┐ ┌─ НДЗ ────┐
│   47     │ │   36     │ │   8      │
│          │ │ 76%      │ │ 17%      │
└──────────┘ └──────────┘ └──────────┘
┌─ Автоответчики ┐ ┌─ Минут разговора ┐ ┌─ Без аудио ⚠️ ──┐
│      3         │ │      342         │ │   2 (4%)         │
│      6%        │ │    avg 5:42      │ │ проверить онPBX  │
└────────────────┘ └──────────────────┘ └──────────────────┘
```

Источники: см. data-layer-handoff блок 3.1 (строка 99-110). Pipeline_gap = `transcript IS NULL AND audioUrl IS NULL`.

**Block B — Distribution `callType`** (Recharts pie или horizontal bar)

Распределение 8 типов: `квалификация_лида | продажи_новый | поддержка_ученика | техвопрос | NPS | upsell | win_back | курьер | прочее`.

**Block C — Distribution `managerStyle`**

5 типов: `soft_seller | aggressive | empathic | neutral | technical | strong_closer | empathic_seller | tech_naive`. Bar chart.

**Block D — TopN `criticalErrors`**

Список 6 ошибок отсортирован по частоте у этого МОПа:

```
no_close_attempt           ▓▓▓▓▓▓▓ 12 звонков (32%)
monolog_not_pain_tied      ▓▓▓ 5 звонков (13%)
no_needs_discovery         ▓▓ 3 звонка (8%)
...
```

**Block E — ПАТТЕРНЫ МОПа** 🆕

Четыре блока в grid 2x2:

```
┌─ Топ-3 повторяющихся managerWeakSpot ─┐ ┌─ Топ-3 critical errors МОПа ──────┐
│ "не сделала попытку"     5 раз         │ │ no_close_attempt        12 (32%)   │
│ "монолог не под боль"    3 раза        │ │ monolog_not_pain_tied    5 (13%)   │
│ "не отработала 'дорого'" 2 раза        │ │ no_needs_discovery       3 (8%)    │
└────────────────────────────────────────┘ └────────────────────────────────────┘
┌─ managerStyle distribution ────────────┐ ┌─ phraseCompliance avg ─────────────┐
│ soft_seller        70%                  │ │ 7.2 / 12 техник used:true          │
│ empathic           20%                  │ │ vs средний по отделу: 6.1 / 12 ↑   │
│ neutral            10%                  │ │ Топ-3 missed: выбор_без_выбора,    │
│                                         │ │   бонусы_с_дедлайном, юмор_забота  │
└────────────────────────────────────────┘ └────────────────────────────────────┘
```

**Сравнение с отделом:** для каждой метрики стрелка ↑/↓/= и delta vs avg отдела (исключая текущего МОПа).

**Block F — Мини-heatmap «когда МОП X эффективнее»** 🆕

Тот же запрос Block 6 главной но `WHERE managerId=$id`. Inline-инсайт под heatmap: «эффективнее всего звонит во вторник 14:00 (78% success), хуже всего в пятницу вечер (22%)».

**Block G — Список клиентов**

Уникальные `gcContactId` у этого МОПа за период, с агрегатом «N звонков, последний DD.MM, avg score X%»:

```
┌─ Клиент 208995833 (Эльнура) — 4 звонка, последний 25.04, avg 82% ──┐
│ [→ Открыть карточку клиента]                                       │
└────────────────────────────────────────────────────────────────────┘
```

Click → `/managers/[id]/clients/[gcContactId]`.

---

### 3.5 Карточка клиента `/managers/[id]/clients/[gcContactId]`

**Header:** breadcrumbs `Менеджеры / Ольга / Клиент 208995833`.

**Block A — Шапка (3 GC deep-link'а)**

```
🆔 gcContactId: 208995833
👤 Карточка клиента в GC: https://web.diva.school/user/control/user/update/id/208995833 [→]
🤝 Сделка в GC (если Deal.crmId известен): https://web.diva.school/sales/control/deal/update/id/{Deal.crmId} [→]
```

Если `Deal.crmId IS NULL` — скрыть третий link.

**Block B — Список ВСЕХ звонков** (flat, без вложенности по сделкам)

shadcn `<Table>` с колонкой «Этап сделки» 🆕:

| Дата (МСК) | duration | talkDuration ⭐ | МОП | callType | scriptScorePct | outcome | Этап сделки | dealId badge |
|---|---|---|---|---|---|---|---|---|
| 25.04 11:32 | 13:45 | 12:00 | Наталья | продажи_новый | 82% 🟢 | objection_unresolved | Диагностика после МК | [Deal abc123] |
| 24.04 09:14 | 0:42 | — | Наталья | продажи_новый | — (HUNG_UP) | — | Лид новый | [Deal abc123] |

⭐ Две колонки: `duration` (запись) и `talkDuration` (живой разговор). Никогда не складывать.

«Этап сделки» = `Deal.stageName` через JOIN на `dealId`. Если звонок не привязан к сделке — `—`. Это даёт «история касаний — на каком этапе клиент был при каждом звонке, как двигался по воронке».

**Без личных данных клиента** — только last 4 digits `clientPhone` (например `***1234`) и кнопка «→ Открыть полную карточку клиента в GC». Имя клиента берётся из GC, не парсим.

`dealId` — маленький `<Badge>` справа. Click row → `/calls/[pbxUuid]`.

---

### 3.6 Карточка звонка `/calls/[pbxUuid]`

**Эталон:** `sample-3-proper-cleanup-lara.md` + `sample-4-strong-closer-tech-block.md`. TABLE-RICH с эмодзи, плотные таблицы.

**Block 0 — Шапка**

```
📋 ЭТАЛОН — Звонок c4fe3358 (Эльнура, 36 лет, Кыргызстан)

Менеджер: Наталья → Клиент: Эльнура (clientName из БД)
⭐ duration (запись): 13:45 (825 sec)
⭐ talkDuration (живой разговор): 12:00 (720 sec)
Дата: 2026-04-25 (МСК)
pbxUuid: c4fe3358-... | gcCallId: 208995833 | scriptScore: 18/22 (82%) | hotLead: true
🆕 Этап сделки на момент звонка: <Deal.stageName>  (например «Диагностика после МК»)

🔗 Deep-links:
  🎯 Карточка звонка в GC: https://web.diva.school/user/control/contact/update/id/{gcCallId}
  👤 Карточка клиента: https://web.diva.school/user/control/user/update/id/{gcContactId}
  🤝 Сделка: https://web.diva.school/sales/control/deal/update/id/{Deal.crmId}  (если есть)

🎵 Плеер: <audio controls src={audioUrl} preload="metadata" />
```

⭐ **duration vs talkDuration** показывать ОБЕ строки раздельно, никогда не складывать. Если запись 1:12 / разговор 0:36 — это 50% мёртвое время (гудки + IVR), РОП должен видеть оба числа. Если `talkDuration IS NULL` (старые до Stage 7.5b) — fallback на `userTalkTime` с пометкой «(fallback)».

Domain (`web.diva.school`) — берём из `CrmConfig.subdomain` через JOIN.

**Block 1 — 🧼 Очищенный транскрипт**

`<pre>` или markdown render `cleanedTranscript`. Если NULL — fallback на `transcriptRepaired`, если и его нет — на `transcript`. Если всё NULL и тип ≠ NORMAL → не показывать блок.

**Block 2 — 📝 Резюме**

`callSummary` (3-4 строки). Если NULL — disclaimer «Резюме не сгенерировано».

**Block 3 — 🧠 Психология и нейропродажи**

Таблицы:
- ✅ Удачные приёмы — таблица из `psychTriggers.positive` (`time | technique | effect`)
- ❌ Упущенные — из `psychTriggers.missed` (`trigger | why_missed | what_to_do`)
- 🔥 Триггеры клиента — из `keyClientPhrases`
- 👤 Клиент: `clientReaction` + `clientEmotionPeaks`
- 👤 Менеджер: `managerStyle` + `managerWeakSpot`

**Block 4 — 📊 Скрипт-скоринг (11 этапов)**

Таблица из `scriptDetails`: `# | Этап | ✅/⚠️/❌ | Комментарий`. ИТОГО `scriptScore/N (scriptScorePct%)`.

**Block 5 — 🆕 phraseCompliance — 12 техник diva**

YAML-style рендер из `phraseCompliance` jsonb. Каждая техника: статус (used/missed) + evidence или missed-причина.

```
программирование_звонка   ✅ used: "С пятки начнём..." (00:39)
искренние_комплименты      ✅ used (2/3): "Какой подарок..." (04:52)
выбор_без_выбора            ❌ missed: клиент сама спросила "разделить?" — упущен момент
```

Aggregate: «8 из 12 техник used:true» в шапке блока.

**Block 6 — 🚨 Критические ошибки**

Чек-лист 6 ошибок из анкеты diva (из `criticalErrors` array):

```
1. Перебивание клиента                          ✅ не перебивала
2. Отсутствие выявления потребностей             ⚠️ поверхностно
3. Отсутствие отработки возражений               ⚠️ с задержкой
4. Отсутствие попытки сделки                     ✅ ДОШЛА до суммы
5. Не назначен следующий шаг                     ✅ deadline 11 мая
6. Монологная презентация не под боль            ✅ привязана к жалобам
```

**Block 7 — 💡 Инсайт для РОПа**

Markdown render `ropInsight` (3-5 action items).

**Block 8 — 🛠️ Что МОП должен сделать**

Markdown render `nextStepRecommendation` (5 шагов до следующего контакта).

**Block 9 — 📋 Block 7 Extracted Commitments**

Таблица из `extractedCommitments`:

| # | Speaker | Quote | Time | Action | Deadline | Target |
|---|---|---|---|---|---|---|
| 1 | МЕНЕДЖЕР | «Делаю ссылочку на оплату» | 07:22 | send_payment_link | сразу | ссылка на 50% |

`commitmentsCount: 4 | commitmentsTracked: false` в шапке.

**Block 10 — 🎯 Категория и исход**

Таблица: `callType | callOutcome | hadRealConversation | outcome | isCurator | isFirstLine | possibleDuplicate | purchaseProbability`.

**Block 11 — 🏷️ Теги**

`enrichedTags` array как chip badges (используем `<chip-badge>` из `src/components/`).

#### Условный рендер по 7 типам звонка

| Тип | Признак | Рендерится |
|---|---|---|
| **A NORMAL** | `callOutcome=real_conversation AND duration ≥ 60` | все 11 блоков |
| **B SHORT_RESCHEDULE** | `callOutcome=real_conversation AND duration 30-60s` | блоки 0,1,7,8,9,10,11 (без psych/script/12-tech/errors) |
| **C VOICEMAIL/IVR** | `callOutcome IN ('voicemail','ivr')` | блок 0 + 🎙️ бейдж + блок 9 (если МОП оставила message) |
| **D NO_SPEECH** | `transcript ≤ 100 chars` | блок 0 + 🤐 бейдж «Whisper не нашёл речи» |
| **E HUNG_UP** | `callOutcome IN ('hung_up','no_answer') AND duration < 30` | блок 0 + ☎️ бейдж «НДЗ» + длит. |
| **F TECHNICAL_ISSUE** | `callOutcome='technical_issue'` | блок 0 + 🚨 алерт «Проверить SIP/гарнитуру — тех. отдел» |
| **G PIPELINE_GAP** | `transcript=NULL AND audioUrl=NULL` | **NOT_FOUND 404** — этот тип НЕ имеет AI-карточки, только счётчик в МОПе |

Для типов B-F блоки 1, 4, 5, 6, 7, 8 рендерим disclaimer'ом «Не оценивается — звонок не подходит под NORMAL».

---

### 3.7 Воронка — НЕ отдельная страница ✅ DECIDED

User подтвердил: НЕ делать `/funnel`. Вместо этого этапы воронки рендерятся в трёх местах:

1. **Главная Block 7** — donut/bar `Deal.stageName` → count активных открытых карточек (см. 3.1)
2. **Карточка звонка Block 0** — строка «Этап сделки на момент звонка: <Deal.stageName>» (см. 3.6)
3. **Карточка клиента Block B** — колонка «Этап сделки» в flat-списке (см. 3.5) — даёт историю движения клиента по воронке через звонки

Никаких % конверсий между этапами — это в CRM. Только **где сейчас клиенты** + **на каком этапе был каждый звонок**.

---

### 3.8 Settings `/settings`

**Существующие секции:** оставить (скрипт продаж, связки МОП/Куратор).

**🆕 Telephony tab:**
```
┌─ onlinePBX ───────────────────────────────────────────────┐
│ Status: ✅ connected (last-sync N мин назад)              │
│ apiKey: ********** (masked)                                │
│ Domain: diva-school.onpbx.ru                              │
│ Stereo recording: ✅ enabled (с 10.04.2026)               │
└────────────────────────────────────────────────────────────┘
```
Источник: `Tenant.pbxConfig` jsonb или новая table.

**🆕 Health tab:**
```
┌─ 🩺 System Health ─────────────────────────────────────────┐
│ Cron last-sync: ✅ 5 мин назад (cron-master-pipeline.ts)   │
│ GC cookie: ✅ valid (expires 2026-05-15)                    │
│ Reconciliation: 2.1% discrepancy (последний час)           │
│                                                              │
│ За последний час:                                            │
│   PBX:  47  |  БД: 47 ✅  |  GC: 45 ⚠️ 2 missing            │
└──────────────────────────────────────────────────────────────┘
```
Источники: `MAX(CallRecord.createdAt)`, `CrmConfig.expiresAt` (для GC cookie), `ReconciliationCheck` table (если есть, иначе skip — Канон #38 ещё не реализован).

---

## 4. КАКИЕ ДАННЫЕ ОТКУДА (connection map)

| Страница | Query файл | Что используется |
|---|---|---|
| `/` (дашборд) | новый `src/lib/queries/dashboard-gc.ts` | CallRecord aggregate (managerId, callOutcome, scriptScorePct, phraseCompliance jsonb, transcript IS NULL gap) |
| `/quality` | новый `src/lib/queries/quality-gc.ts` | CallRecord WHERE tenantId + filters |
| `/managers` | новый `src/lib/queries/managers-gc.ts` | Manager LEFT JOIN CallRecord, isCurator=false, agg |
| `/managers/[id]` | расширить `manager-detail.ts` | + 6 counters + distributions + clients list |
| `/managers/[id]/clients/[gcContactId]` | новый `client-detail-gc.ts` | CallRecord WHERE managerId=X AND gcContactId=Y |
| `/calls/[pbxUuid]` | новый `call-detail-gc.ts` | CallRecord WHERE pbxUuid=X (все 64 поля) + JOIN Deal+Manager+Tenant.crmConfig.subdomain |
| `/settings` health tab | новый `health-gc.ts` | MAX(CallRecord.createdAt), CrmConfig.expiresAt, ReconciliationCheck |

**НЕ переписывать:** `dashboard.ts`, `manager-detail.ts`, `quality.ts`, `retro.ts`, `managers.ts`, `deal-detail.ts`, `patterns.ts` — они работают для amoCRM tenants. GC-tenants пользуются новыми `*-gc.ts` файлами, switch в page.tsx.

**Важно:** SQL фильтр `transcript IS NOT NULL AND callOutcome='real_conversation' AND duration >= 60` для AI-метрик (scriptScorePct, phraseCompliance, criticalErrors). Это правильно отсекает type 7 PIPELINE_GAP — НЕ ТРОГАТЬ.

**Connection map для phraseCompliance:** агрегация через jsonb operators (см. data-layer-handoff строка 41-50). 12 счётчиков `COUNT(*) FILTER (WHERE "phraseCompliance"->'KEY'->>'used'='false')`, top-3 max в Block 4 главной.

---

## 5. STATES (для каждой страницы)

Для каждой страницы — 4 состояния:

1. **Loading skeleton** — shadcn `<Skeleton>` (если нет — собрать через `<div className="animate-pulse bg-surface-2 rounded h-N">`)
2. **Empty** — нет данных за период:
   - Дашборд: «Нет звонков за выбранный период. Попробуй сменить фильтр.»
   - Карточка МОПа: «У этого МОПа нет звонков за период.»
   - Карточка звонка: 404
3. **Error** — try/catch на queries:
   - БД недоступна → toast `sonner` «Ошибка БД, попробуй обновить»
   - GC cookie expired (для health tab) → красный badge «GC cookie протух — обновить в Settings»
4. **Partial-data** — fallback chain:
   - `cleanedTranscript NULL` → `transcriptRepaired` → `transcript` → disclaimer
   - `callSummary NULL` → disclaimer «Резюме не сгенерировано»
   - `phraseCompliance NULL` → блок не показывается (старые v9.0/9.1/9.2 — 74 звонка из data-layer-handoff)

---

## 6. LIVE-ОБНОВЛЕНИЕ

**Подход:** server-side rendering, refresh on visit. Cron каждые 15 мин обновляет БД → user F5 → видит свежие данные.

**НЕ делаем для MVP:**
- ❌ WebSocket / SSE
- ❌ Polling каждые N сек
- ❌ Optimistic UI

**Что делаем:**
- `export const dynamic = "force-dynamic"` на каждой странице (как сейчас на `/`)
- Last-sync timestamp в header дашборда («Обновлено N мин назад»)

---

## 7. STOP-LIST (НЕ повторять ошибки)

```
❌ Tenant.subdomain НЕ существует — subdomain в CrmConfig.subdomain (JOIN!)
❌ Имена колонок CallRecord — camelCase: possibleDuplicate, callSummary, enrichedTags,
   criticalDialogMoments, psychTriggers, cleanedTranscript, ropInsight,
   extractedCommitments, gcCallId, talkDuration, scriptScorePct
❌ Аудио — играть прямой audioUrl (fileservice.getcourse.ru), НЕ скачивать в нашу инфру
❌ Сделки НЕ центральная сущность — у нас ЗВОНКИ. Сделка = маленький badge в строке звонка
❌ НЕ делать BI-страниц (выручка / AOV / LTV / комиссия / ROI рекламы)
❌ НЕ вводить новые UI-библиотеки — Recharts + Tremor + shadcn 17 компонентов хватит
❌ НЕ менять цветовую палитру / шрифт / sidebar layout / header стиль
❌ НЕ парсить GC данные клиента — только deep-link (ID + URL, ничего больше)
❌ TimeZone: GC в МСК, БД в UTC — UI ВСЕГДА показывает МСК (через format helper в src/lib/format.ts)
❌ Для amoCRM tenants старый UI остаётся — переключение в page.tsx по CrmConfig.provider='GETCOURSE'
❌ НЕ менять filter `transcript IS NOT NULL` в существующих queries — корректно отсекает type 7
❌ НЕ копировать sample-1/sample-2 эталоны (архивированы — compression bug). Только sample-3, sample-4
❌ НЕ удалять `getTenantMode()` — через него работает diva live-mode для legacy /retro
   (которая удаляется только из навигации, route остаётся для амосrm)
```

---

## 8. ЭТАПЫ РЕАЛИЗАЦИИ (commit per page)

**Pre-этап 0 — инфраструктура switching (без UI изменений):**
- Добавить `getCrmProvider(tenantId): Promise<'GETCOURSE' | 'AMOCRM' | null>` в `src/lib/queries/active-window.ts`
- На основе `CrmConfig.provider` field
- В Header.tsx — switch nav items по provider

**Этап 1 — Главная (Дашборд РОПа)**
- Файлы: `src/app/(dashboard)/page.tsx` (switch GC/amoCRM), новый `src/app/(dashboard)/_components/gc/dashboard-rop.tsx`, новый `src/lib/queries/dashboard-gc.ts`
- 5 блоков канона #37
- Period filter (today/week/month) + last-sync timestamp + pipeline_gap badge
- Commit message: `feat(ui): GC dashboard РОПа — 5 блоков канона #37`
- Approval gate: user проверяет `localhost:3000/` для diva-school

**Этап 2 — Карточка звонка**
- Новый route `src/app/(dashboard)/calls/[pbxUuid]/page.tsx`
- Новый query `src/lib/queries/call-detail-gc.ts`
- 11 блоков по эталону sample-3/4 + condition по 7 типам звонка
- `<audio src={audioUrl} controls preload="metadata" />`
- 3 deep-link'а в шапке (через JOIN на Deal+CrmConfig)
- Commit: `feat(ui): GC call card — sample-3/4 эталон, 11 blocks, 7 types`
- Approval gate: user проверяет `localhost:3000/calls/c4fe3358-a886-48b8-a280-6cc9269287d1`

**Этап 3 — Менеджеры + карточка МОПа**
- `src/app/(dashboard)/managers/page.tsx` (switch GC) + `src/app/(dashboard)/managers/[id]/page.tsx`
- Новые queries `managers-gc.ts`, расширение `manager-detail.ts`
- 6 счётчиков из анкеты diva 9.1-9.5 + pipeline_gap
- Distribution callType / managerStyle / criticalErrors topN
- Список клиентов
- Commit: `feat(ui): GC managers + карточка МОПа — 6 counters + clients list`
- Approval gate: user проверяет `/managers` и `/managers/[someId]`

**Этап 4 — Карточка клиента**
- Новый route `src/app/(dashboard)/managers/[id]/clients/[gcContactId]/page.tsx`
- Новый query `client-detail-gc.ts`
- 3 GC deep-link'а + flat list звонков с dealId badge
- Commit: `feat(ui): GC client card — flat call list + 3 deep-links`
- Approval gate: user проверяет `/managers/[id]/clients/208995833`

**Этап 5 — Контроль качества**
- `src/app/(dashboard)/quality/page.tsx` (switch GC)
- Новый query `quality-gc.ts`
- Список + фильтры (callType / callOutcome / managerId / hadRealConversation) + sortable
- Drill-down на `/calls/[pbxUuid]`
- Commit: `feat(ui): GC quality — 7 types filtering + script rating`
- Approval gate: user проверяет `/quality`

**Этап 6 — Settings + Telephony + Health**
- Расширить `src/app/(dashboard)/settings/page.tsx` для GC-tenant'ов
- Новый query `health-gc.ts`
- Tabs: Скрипт (existing) | Связки (existing) | Телефония (new) | Health (new)
- Commit: `feat(ui): GC settings — telephony + health tabs`
- Approval gate: user проверяет `/settings`

**Этап 7 — Cleanup старых страниц для GC**
- Удалить из навигации: «Ретро аудит», «Паттерны», «Сделки» (только для GC)
- Routes остаются для amoCRM
- Удалить из главной (для GC mode): RevenuePotential, FunnelChart, ConversionChart, KeyMetrics, ManagerRatingTable (старая), AiInsights, DealStatSnapshotWidget
- Старые `_components` файлы — НЕ удаляем (используются amoCRM)
- Commit: `chore(ui): hide retro/patterns/deals from GC nav`
- Approval gate: user проверяет что для diva эти routes не показаны, для reklama/vastu всё на месте

**Этап 8 — Smoke test на localhost**
- Pass scenarios:
  1. РОП открывает `/` для diva → видит 5 блоков, никаких BI элементов
  2. Click row Block 1 → `/managers/[id]` → видит 6 counters
  3. Click клиента → `/managers/[id]/clients/[gcContactId]` → flat list
  4. Click звонок → `/calls/[pbxUuid]` → 11 блоков по эталону, плеер играет
  5. Click МОП с pipeline_gap > 0% → видит warning badge
  6. Open `/quality` → видит фильтры, drill-down работает
  7. Open `/settings` → видит Telephony+Health tabs
  8. Switch tenant в admin к reklamalift74 → видит старый UI без изменений
- Если найдены баги — точечные фиксы коммитом каждый
- Commit: `chore(ui): smoke test pass — GC rebuild complete`

---

## 9. APPROVAL GATES

- ✅ **После плана (этот шаг)** → user читает markdown → ОК / поправки
- ✅ **После каждого этапа** → commit + сообщение «Этап N готов, проверь localhost:3000/<path>, скажи ОК — иду в следующий»
- ✅ **После этапа 8** → отчёт о smoke test'е, готовность к деплою

---

## 10. РЕШЕНИЯ USER'А (30.04)

### Подтверждено
1. ✅ **Карточка клиента — оставить** (flat list + колонка «Этап сделки», без личных данных, last 4 digits phone + GC deep-link)
2. ✅ **Block 4 chat-style ask — отложить** (не делать сейчас, нужен AI endpoint)
3. ✅ **Воронка `/funnel` — пропустить** как страницу, рендерится в 3 местах (см. 3.7)
4. ✅ **Block 4b ПАТТЕРНЫ ОТДЕЛА** — добавлено на главную (топ weakSpot + topN critical errors)
5. ✅ **ПАТТЕРНЫ МОПа** — добавлено в карточку МОПа (топ weakSpot + critErrors + style distribution + 12 техник vs avg отдела)
6. ✅ **Тепловая карта 7×24** — добавлено на главную Block 6 + мини-heatmap в карточке МОПа
7. ✅ **duration vs talkDuration** — раздельные колонки везде, никогда не складываются, fallback на userTalkTime если NULL

### Открытые (проверю на этапе 0)
1. `Manager.isCurator` — поле существует или матчинг по фамилиям? Если поля нет → migration.
2. `CrmConfig.provider` enum — фактическое значение в БД (`'GETCOURSE'` / `'getcourse'` / `'gc'`)?
3. `Deal.stageName` — поле существует и заполнено для diva?
4. `talkDuration` — заполнено для свежих карточек после Stage 7.5b cron?
5. `Manager.gcUserId` — используем сейчас или отложим?
6. `ReconciliationCheck` table — существует в schema или skip section пока?
7. Header switch — внутри `Header.tsx` по provider (склоняюсь к этому), не плодить `HeaderGC.tsx`.

### Этап 0 — РЕЗУЛЬТАТЫ DB CHECK (30.04)

| # | Вопрос | Реальность | Adaptation |
|---|---|---|---|
| 1 | `Manager.isCurator` | ❌ нет в schema. ✅ Есть `CallRecord.isCurator` (per-call от Master Enrich) | Аггрегировать: `bool_or(isCurator)` через все звонки МОПа → если хоть один помечен куратором → исключить из `/managers`. Fallback: матчинг по фамилиям анкеты diva (Лукашенко, Чернышева, Марьяна, Чиркова, Щ, Добренькова, Романова, Довгалева, Николае). |
| 2 | `CrmConfig.provider` enum | ✅ `GETCOURSE` (заглавный, prisma enum `CrmProvider`) | `provider === "GETCOURSE"` в queries и Header |
| 3 | `Deal.stageName` | ❌ нет. ✅ Есть `Deal.currentStageCrmId` + `FunnelStage.crmId/name` (через Funnel) | JOIN: `Deal.funnelId → Funnel.stages → FunnelStage where crmId=Deal.currentStageCrmId → name`. Использовать в карточке клиента + карточке звонка + Block 7 главной |
| 4 | `talkDuration` | ✅ заполнено 95% (3223/3378 за 7д) | Использовать `COALESCE(talkDuration, userTalkTime)` везде где «минут разговора» |
| 5 | `Manager.gcUserId` | ✅ есть в schema, индексирован | Используем для cross-check атрибуции (опц. в карточке МОПа) |
| 6 | `ReconciliationCheck` table | ⚠️ существует в БД, **НЕТ в Prisma schema** | Чтобы избежать миграции → читать через raw SQL `db.$queryRaw` в Health tab. Если table пустая — skip section. |
| 7 | Header switch | ✅ внутри Header.tsx через `crmProvider` prop | Реализовано: layout.tsx читает `getCrmProvider()` → передаёт в `<Header crmProvider={...} />` → switch nav к `NAV_ITEMS_GC` (4 пункта без Паттернов) |

**Изменения этапа 0:**
- ✅ `src/lib/queries/active-window.ts` — добавлен `getCrmProvider(tenantId): "GETCOURSE" | "AMOCRM" | "BITRIX24" | null`
- ✅ `src/app/(dashboard)/layout.tsx` — резолвит provider и передаёт в Header
- ✅ `src/components/header.tsx` — `NAV_ITEMS_GC` (4 пункта: Главная / Менеджеры / Контроль качества / Настройки), switch по `crmProvider === "GETCOURSE"`

---

## 11. КРОСС-CUT С CRON (из data-layer-handoff)

UI **читает то что cron пишет**. Cron уже даёт:
- `gcCallId`, `talkDuration`, `gcOutcomeLabel`, `gcEndCause` — после Stage 3.5b PBX↔GC linking
- `audioUrl` (fileservice.getcourse.ru) — прямой URL, не скачиваем
- `phraseCompliance` jsonb — после Master Enrich v9.3+

UI **НЕ должен**:
- Триггерить Master Enrich (это Opus подписка, отдельный flow)
- Парсить GC HTML (это cron делает через `src/lib/crm/getcourse/parsers/call-detail.ts`)
- Полнить `gcCallId` если NULL — это работа cron'а через `pending_gc_link` retry

Если `enrichmentStatus='pipeline_gap'` или `enrichmentLockedAt < 30min ago` — UI показывает соответствующий бейдж («обогащается прямо сейчас» / «нет аудио»), но не вмешивается.

---

## 12. ОКРУЖЕНИЕ

- Tenant ID diva: `cmo4qkb1000000jo432rh0l3u`
- GC subdomain: `web.diva.school` (из `CrmConfig.subdomain`)
- БД: ssh `~/.ssh/timeweb` → `root@80.76.60.130` → `docker exec smart-analyze-db psql -U smartanalyze -d smartanalyze`
- Local dev: `npm run dev` → `localhost:3000`
- Тестовый pbxUuid (sample-4): `c4fe3358-a886-48b8-a280-6cc9269287d1`
- Тестовый gcCallId: `208995833` (Эльнура)

---

## 13. CHECKLIST ДО НАЧАЛА КОДА

- [x] Read'ы всех 12 источников
- [x] Inventory компонентов / queries / схемы
- [x] План написан
- [x] **APPROVAL ОТ USER** (30.04 — ОК + 5 дополнений интегрированы)
- [ ] **Этап 0 — DB schema check:** Manager.isCurator, CrmConfig.provider enum value, Deal.stageName заполнено, talkDuration заполнено, ReconciliationCheck существует
- [ ] Этап 1 — Главная (8 блоков: 1, 2, 3, 4, 4b, 5, 6, 7)
- [ ] Этап 2 — Карточка звонка (Block 0 с duration+talkDuration+Этап сделки)
- [ ] Этап 3 — Менеджеры + карточка МОПа (с ПАТТЕРНАМИ + мини-heatmap)
- [ ] Этап 4 — Карточка клиента (flat list с колонкой Этап + last 4 digits phone)
- [ ] Этап 5 — Контроль качества
- [ ] Этап 6 — Settings (Telephony + Health)
- [ ] Этап 7 — Cleanup nav для GC
- [ ] Этап 8 — Smoke test

---

**Final scope (главная):** Block 1 + 2 + 3 + 4 + 4b ПАТТЕРНЫ + 5 обещания + 6 heatmap + 7 этапы воронки.
**Final scope (карточка МОПа):** 6 счётчиков + distributions + ПАТТЕРНЫ МОПа + мини-heatmap + список клиентов.
**Final scope (карточка звонка):** Block 0 (duration ⭐ talkDuration ⭐ Этап сделки ⭐ 3 deep-link'а) + 11 блоков эталона + 7 типов рендера.
**Final scope (карточка клиента):** flat list со столбцом «Этап сделки» + last 4 digits phone + 3 GC deep-link'а.

Иду в Этап 0 — DB schema check.
