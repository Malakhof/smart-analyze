# Q6: Deal Card — Calls-by-Stage Visualization

**Date:** 2026-05-03
**Experts:** Edward Tufte (visualization) + Steve Krug (don't-make-me-think for РОП)
**Scope:** карточка клиента (`/managers/[id]/clients/[gcContactId]`) — секция «Звонки по этапам сделки»
**Constraint:** premiere 4.05.2026 (24h budget), GC-only, no new DB fields, Recharts/Tremor preferred over custom SVG.

---

## 0. Project Context (что уже есть)

### 0.1 Current implementation (`src/app/(dashboard)/_components/gc/client-card.tsx`)

Сейчас карточка клиента показывает:

1. **Header** — имя клиента, gcContactId, МОП, телефон tail.
2. **4 счётчика** — Звонков всего / Дозвоны (real) / Минут разговора / Avg script score.
3. **Deep-links** — Клиент в GC, Сделка в GC, Последний звонок, телефон.
4. **Stage journey** (chip-row) — `→`-цепочка уникальных этапов воронки с датой:
   ```
   [Заявка 12.04] → [Квалификация 14.04] → [Презентация 18.04] → [Оплата 22.04]
   ```
5. **Flat call table** — 9 колонок (Дата, duration, talkDuration, МОП, callType, scriptScore, outcome, **этап сделки**, dealId).

### 0.2 Data layer (`src/lib/queries/client-detail-gc.ts`)

`ClientCallRow` уже содержит:
- `startStamp`, `createdAt` — для сортировки во времени
- `callOutcome` (`real_conversation | voicemail | hung_up | no_answer | ivr | technical_issue | no_speech_or_silence`)
- `outcome` (`closed_won | closed_lost | scheduled_callback | objection_unresolved | no_offer_made`)
- `scriptScorePct`
- `dealCrmId`, `dealId` (nullable)
- `stageName`, `currentStageCrmId` (nullable — «на момент звонка»)
- `talkDuration`, `duration`

`stageJourney` уже строится chronologically — мы знаем порядок и timestamp каждого первого захода в этап.

### 0.3 USER COMPLAINT (РОП)

> «Карточка сделки: распределение звонков по этапам сделки задумано, но реализовано странно/ненаглядно».

Текущий UX-дефект: чтобы понять «на каком этапе застряла сделка», РОП должен:
1. Прочитать chip-row stage journey (даты есть, но количество звонков на этап — нет).
2. Скроллить flat-table из ~12-50 строк.
3. **Глазами агрегировать** — сколько звонков пришлось на «Презентацию», какой у них outcome.

Это нарушает Krug-правило «don't make me think» — РОП должен **сразу видеть проблемный этап**.

### 0.4 Known data quality bug

Per memory: «only 1 distinct deal per 5038 calls» — у большинства звонков `dealId = NULL`. Значит и `stageName = NULL`. Solution must degrade gracefully.

### 0.5 Доступные UI primitives (`src/components/ui/`)

shadcn 4.2: accordion, badge, card, dialog, dropdown-menu, separator, table, tabs, tooltip.
**Recharts 3.8** + **@tremor/react 3.18** + **lucide-react** + Tailwind v4.
**No** sidebar, max-width 1120px, custom CSS vars `surface-0..4`, `text-primary..muted`, `status-green/amber/red`, `ai-1/2/3`.

---

## 1. Expert Analysis

> **Main expert: Edward Tufte** (timeline/sequence visualization) — задача про temporal-sequence + multivariate (stage × outcome × duration), это его core area.
>
> **Принципы трёх дополнительных экспертов:**
> 1. **Steve Krug:** "Don't make me think — РОП за 3 секунды понимает, на каком этапе провал."
> 2. **Stephen Few** (информационный дизайн): "Show comparison, not just data — outcomes должны контрастировать визуально."
> 3. **Dan Abramov** (React/state): "Colocation — не плодить отдельную страницу для drill-down, секция = self-contained."

### Tufte's principles applied

- **Data-ink ratio** — каждая чернильная точка кодирует данные (этап + outcome + duration).
- **Small multiples** — повторяющийся pattern по этапам, глаз сразу видит аномалию.
- **No chartjunk** — никаких 3D-funnel-плюшек, никаких градиентных bar'ов «для красоты».
- **Sparkline thinking** — visualization in ~80px height, inline в карточке, не отдельный экран.

### Krug's checklist

- РОП *кликает* на этап → раскрывается список звонков того этапа (progressive disclosure).
- Никаких легенд-«где-же-эта-инструкция» — иконки + цвета self-explanatory, tooltip on hover.
- Mobile/tablet — горизонтальный timeline scrollable если этапов >5 (у diva 5-7 этапов норма).

---

## 2. Solution Options — 5 вариантов

### Option A: Horizontal Timeline (band-on-axis + dots)

**Essence:** ось X — время (`firstCallAt → lastCallAt`). Горизонтальные band'ы (одна полоса = один этап, цвет фона варьируется), на полосах — точки звонков, color/shape = outcome. Под timeline — список этапов с count badges.

```
                    12.04         14.04       18.04        22.04        TODAY
Заявка        ▓▓▓●─●▓
Квалификация       ▓▓▓●─●─●▓▓
Презентация              ▓▓▓●─●─✕─✕─●▓▓▓▓▓▓
Оплата                                       ▓▓▓●─●▓▓▓▓
Won/Завершён                                              ▓▓▓●▓
```
- `●` зелёный = real_conversation + outcome=closed_won/no_objection
- `●` жёлтый = real_conversation + objection_unresolved/no_offer_made
- `●` красный = real_conversation + closed_lost
- `○` (ring) = voicemail/no_answer/ivr — недозвон
- `✕` = hung_up/technical_issue
- размер dot ∝ talkDuration (sqrt-scale, max ~10px)

**Pros:**
- Tufte-perfect: time on X (естественная семантика), stages as small multiples (Y), outcomes as visual encoding.
- РОП мгновенно видит «кластер красных на этапе X» = bottleneck.
- Fits 80-120px height, inline в карточке.
- Reuse: Recharts `<ScatterChart>` + custom Y-axis ticks (этапы), or Tremor `<Tracker>` mosaic-style.

**Cons:**
- Если у клиента 50+ звонков на одном этапе — точки накладываются. Mitigation: jitter по Y внутри band, либо force-collapse в bin (`6 calls in 2h`).
- Time gaps большие (этап «висел» 3 недели) → пустота. Mitigation: log-scale time axis, либо break-axis (Tufte допускает explicit break marker).
- Custom Y-axis с этапами — кастомный код, не plug-and-play чарт из Tremor.

**Когда подходит:** наша ситуация ровно такая — 5-7 этапов × 5-50 звонков, временна́я дистанция ~14-90 дней.

**Tufte verdict:** This is the canonical small-multiples + temporal answer.

**Krug verdict:** ✅ если каждый dot tooltip-разворачивается ("18.04 14:23 · Иван · objection_unresolved · 8:42 talk"), а click → drill-down list ниже.

---

### Option B: Vertical Funnel (count badges per stage)

**Essence:** Классическая воронка sales funnel сверху вниз, каждый stage = blade с количеством звонков и breakdown по outcome (mini stacked bar внутри blade).

```
┌──────────────────────────────────────────────┐
│ Заявка               2 звонка   ▰▰            │  ← тонкий зелёный = real
├──────────────────────────────────────────────┤
│ Квалификация         3 звонка   ▰▰▱            │
├──────────────────────────────────────────────┤
│ Презентация          7 звонков  ▰▰▰▰▰▰▰   🔴4  │  ← алертный счётчик красных
├──────────────────────────────────────────────┤
│ Оплата               2 звонка   ▰▰            │
└──────────────────────────────────────────────┘
```

**Pros:**
- РОПам знакомая метафора (sales funnel).
- Tremor `<Tracker>` или `<BarList>` подходят почти как есть.
- Vertical = no horizontal scroll.

**Cons:**
- **Tufte-violation:** теряется ось времени. РОП не видит «3 звонка на этапе квалификации в один день, потом 2 недели тишины» — ключевая интуиция о темпе сделки пропадает.
- Funnel-shape (треугольная блейда) — chartjunk, ширина не несёт информации.
- Stacked bar внутри blade = double-encoding, плохо читается на маленьких ширинах.

**Когда подходит:** если у нас был бы конверсионный анализ (% переходящий со стадии на стадию). Но у нас другая задача — диагностика конкретной сделки.

**Tufte verdict:** ❌ funnel-метафора визуально лишает нас времени; для одной сделки вообще не funnel — это journey.

**Krug verdict:** ⚠️ Знакомо, но РОП думает «и что? в каком звонке стряслось?» — приходится скроллить flat table снова.

---

### Option C: Sankey (stage-to-stage flow)

**Essence:** Узлы = этапы, ширина потоков между этапами ∝ количество звонков. Сloss-узлы по бокам показывают «затихшие» (no_answer / drop-off).

**Pros:**
- Один из самых выразительных приёмов Tufte для flow.
- Хорош для общей воронки (агрегат по 5000 сделок).

**Cons:**
- **Для одной сделки бессмысленен** — у нас не «многих ручьёв», а один линейный путь. Sankey degenerate в линию.
- Нет Recharts/Tremor `Sankey` из коробки — нужен `react-sankey` или D3 = +библиотека.
- РОП не понимает Sankey без обучения (Krug-fail).

**Когда подходит:** агрегат по всему отделу (Block 7 главной), не карточка одной сделки.

**Tufte verdict:** ❌ wrong tool for the question.

**Krug verdict:** ❌ требует объяснения = провал.

---

### Option D: Kanban (columns = stages, cards = calls)

**Essence:** Trello-style — 5-7 колонок (этапы), внутри каждой — карточки звонков (компактные, дата+duration+outcome chip).

**Pros:**
- РОПам знакомо по amoCRM/Trello.
- Drill-down встроен (card click → call detail).

**Cons:**
- **Dense, 1120px ширина не вмещает 7 колонок** комфортно (160px на колонку).
- Высокая вертикальная высота — скролл.
- Время теряется (карточки внутри колонки сортируются, но между колонками порядок не виден).
- Chartjunk: рамки колонок, тени карточек — много чернил, мало данных (anti-Tufte).

**Когда подходит:** если бы у клиента было ~5 звонков total. У нас на закрытие сделки — 12-30 звонков.

**Tufte verdict:** ❌ heavy ink, low information density.

**Krug verdict:** ⚠️ знакомо, но overwhelming.

---

### Option E: Hybrid — compact timeline + drill-down list (Option A + accordion)

**Essence:** Option A (horizontal timeline as "navigator") **+** под ним — accordion-секции по этапам с раскрывающимся списком звонков.

```
┌─ TIMELINE (sparkline-mode, 80px) ────────────────────┐
│ Заявка        ▓●─●▓                                    │
│ Квалификация    ▓●─●─●▓                               │
│ Презентация       ▓●─●─✕─✕─●▓▓▓     ← 4 calls 🔴      │
│ Оплата                       ▓●─●▓                    │
│ Завершён                          ▓●▓                 │
└────────────────────────────────────────────────────────┘
   Click any band → expands accordion below

┌─ Презентация (7 звонков · 4 без оффера · 2 объекций) ─┐
│  ▼ 18.04 14:23 · Иван Петров · objection_unresolved   │
│    talk 8:42 · scriptScore 45% · dealId #1234         │
│    "Клиент сорвался на цене, скрипт пройден на 6/12" │
│  ▼ 19.04 11:05 · Иван Петров · no_offer_made          │
│    ...                                                 │
└────────────────────────────────────────────────────────┘
```

**Pros:**
- Tufte: timeline как overview ("first see the forest").
- Krug: accordion как drill-down ("then the trees"). Клик = одна операция.
- Reuse: shadcn `<Accordion>` есть. Timeline — Recharts `<ScatterChart>` + custom Y. Не нужно тащить Sankey/D3.
- Graceful с NULL deal: для звонков без stageName — отдельный нижний band «Без сделки» (см. §4).
- Replaces existing flat table — РОП не теряет данные, только реструктурирует их.

**Cons:**
- Больше кода чем pure-A (timeline + accordion state).
- Accordion expand-state: персистить в URL `?stage=Презентация` или нет — лишний micro-decision.

**Когда подходит:** наша ситуация — РОП хочет overview + drill-down без перехода между экранами.

**Tufte verdict:** ✅ overview-first + zoom-on-demand = его «zoom and filter» паттерн.

**Krug verdict:** ✅ Если bands clickable, hover-state визуально чёткий, drill-down открывается без перезагрузки.

---

## 3. Decision (from Edward Tufte + Steve Krug)

### Choice: **Option E — Hybrid Timeline + Accordion drill-down**

**Reasoning:**

1. **Tufte:** Option A purely — это полная картина, но 50% времени РОП захочет «копнуть в Презентацию подробнее». Без drill-down → или возвращаемся к flat-table (текущий fail), или открываем модал (тяжело). Embedded accordion = zero-friction zoom.
2. **Krug:** «РОП не должен думать»: timeline отвечает на «где?», accordion — на «что именно?». Один экран, один клик.
3. **Реалии данных:** у diva в среднем 12-30 звонков на клиента, 5-7 этапов воронки — Option A читается отлично, accordion даёт детали без скролла «История звонков (38)».
4. **Reuse:** Recharts `<ScatterChart>` + shadcn `<Accordion>` уже в стеке. **Никаких новых либ** (Sankey/D3 отвергаем). 24h-budget feasible.

---

## 4. Concrete Wireframe — Option E (final)

### 4.1 Layout (replaces sections "Движение клиента по воронке" + "История звонков")

```
┌─ HEADER ─────────────────────────────────────────────────────────────┐
│ Иванов Иван Петрович                                                 │
│ gcContactId: 123 · МОП: Елена Сидорова · Без личных данных...       │
└──────────────────────────────────────────────────────────────────────┘

┌─ COUNTERS (existing 4-block) ───────────────────────────────────────┐
│ Звонков всего: 12 │ Дозвоны: 8 (67%) │ Минут: 47.3 │ Avg score: 62% │
└──────────────────────────────────────────────────────────────────────┘

┌─ DEEP LINKS (existing) ─────────────────────────────────────────────┐
│ [👤 Клиент в GC] [💼 Сделка в GC] [🎵 Последний звонок] [📞 ***1234] │
└──────────────────────────────────────────────────────────────────────┘

┌─ DEAL JOURNEY ──────────────────────────────────────────────────────┐
│ Сделка #4567 «Курс Топ-Закрытие»  ·  OPEN  ·  12 звонков · 47 мин  │
│                                                                      │
│  TIMELINE (clickable bands)                                          │
│  12.04          14.04        18.04         22.04         TODAY      │
│  │              │             │              │             │        │
│  Заявка        ●─●                                                   │  2 calls
│  Квалификация       ●─●─●                                            │  3 calls
│  Презентация               ●─●─✕─✕─●          ← 🔴 4 problem         │  7 calls
│  Оплата                              ●─●                              │  2 calls
│  ───────────────────────────────────────────────────────────────     │
│  Без сделки       ○                            ●                     │  2 orphan
│                                                                      │
│  Hover any dot → tooltip (date · МОП · outcome · talk · score)      │
│  Click any band → accordion below expands that stage                │
└──────────────────────────────────────────────────────────────────────┘

┌─ STAGE BREAKDOWN (Accordion, default: only "problem" stage open) ───┐
│  ▶ Заявка (2 звонка · 2 real)                                        │
│  ▶ Квалификация (3 звонка · 3 real · 1 объекция)                    │
│  ▼ Презентация (7 звонков · 5 real · 4 проблемных) 🔴                │
│      ┌──────────────────────────────────────────────────────┐       │
│      │ 18.04 14:23 · Елена · 🔴 objection_unresolved · 8:42 │       │
│      │   scriptScore 45% · «клиент сорвался на цене»        │       │
│      │   [→ открыть карточку звонка]                         │       │
│      ├──────────────────────────────────────────────────────┤       │
│      │ 19.04 11:05 · Елена · 🟡 no_offer_made · 4:12       │       │
│      │   scriptScore 55% · «не дошли до оффера»             │       │
│      │   [→ открыть]                                          │       │
│      └──────────────────────────────────────────────────────┘       │
│  ▶ Оплата (2 звонка · 2 real)                                        │
│  ▶ Без сделки (2 звонка · 1 voicemail) ⚠️                             │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.2 Header rules (deal title)

- Источник: `detail.calls[0].deal.title` через extension query (минимальный SELECT add — не новое поле, а уже existing `Deal.title`).
- Если `primaryDealCrmId === null` → header: «Сделок не привязано · 12 звонков · 47 мин» (см. §5 graceful).

### 4.3 Timeline visual encoding

| Кодирование | Семантика                                          |
|--------------|----------------------------------------------------|
| **X-axis**   | Дата звонка (`startStamp ?? createdAt`), линейная время  |
| **Y-axis (bands)** | Этап воронки (порядок из `funnel.stages.order`) |
| **Dot fill** | `outcome → cssVar`: <br> `closed_won` → `var(--status-green)` <br> `closed_lost` → `var(--status-red)` <br> `objection_unresolved` → `#E89B3C` (amber-stronger) <br> `no_offer_made` → `var(--status-amber)` <br> `scheduled_callback` → `var(--ai-2)` (синий) <br> null/`not_applicable` → `var(--text-muted)` |
| **Dot shape** | `callOutcome → marker`: <br> `real_conversation` → solid filled circle ● <br> `voicemail` / `ivr` → ring ○ (stroke only) <br> `no_answer` → small ring (4px) <br> `hung_up` → cross ✕ (red stroke) <br> `technical_issue` → triangle ▲ (alert) <br> `no_speech_or_silence` → tiny dot · (gray) |
| **Dot size** | `√(talkDuration seconds) * 0.6`, clamp 4-12px. Ring outcomes always 6px. |
| **Band fill** | `surface-2` базовый, problem-stage (any red dot OR ≥2 amber) — `surface-3` + 1px `status-red` left border. |
| **Band hover** | `surface-3`, cursor pointer. |
| **Band selected (accordion open)** | `surface-3` + 2px `ai-2` bottom-border. |

### 4.4 Tooltip on hover (Krug rule: "show me without clicking")

```
18.04 14:23  ·  8:42 talk  ·  duration 9:15
Елена Сидорова → Иван Петров
🔴 objection_unresolved · scriptScore 45%
"Клиент сорвался на цене" — managerWeakSpot
[click для разбора]
```

Реализация: shadcn `<Tooltip>` (есть), позиционирование auto. На mobile/touch — tap = открыть accordion.

### 4.5 Accordion behavior

- shadcn `<Accordion type="single" collapsible>` — одна секция открыта одновременно.
- **Default open:** этап с максимальным числом «проблемных» звонков (`closed_lost` OR `objection_unresolved`) — first-glance value.
- Если все этапы чистые — все свернуты, default closed.
- Внутри секции — список звонков отсортирован по дате DESC. Каждая запись:
  - Линк на `/calls/{pbxUuid}` (existing route).
  - Иконка outcome (`lucide-react`: `CheckCircle2` / `AlertTriangle` / `XCircle` / `PhoneMissed`).
  - 1-line summary: «managerWeakSpot» или fallback `summary` first 80 chars.

### 4.6 Header summary chips

Между timeline и accordion — одна строка-пилюли:
```
🔴 4 problem · 🟡 2 risk · 🟢 6 healthy · ⚠️ 2 orphan
```
Click any chip → filter visible bands/calls (toggle).

---

## 5. Color/icon coding rules (final canon)

### 5.1 Outcome → color (semantic, не decorative)

| `outcome`              | Color                | Why                                          |
|------------------------|----------------------|----------------------------------------------|
| `closed_won`           | `--status-green`     | Sale closed positively                       |
| `closed_lost`          | `--status-red`       | Hard fail                                    |
| `objection_unresolved` | `#E89B3C` (amber-fire) | Clearly bad but not final                  |
| `no_offer_made`        | `--status-amber`     | Skipped opportunity                          |
| `scheduled_callback`   | `--ai-2` (blue)      | Pending, not failed                          |
| `not_applicable`/null  | `--text-muted` gray  | Neutral                                      |

### 5.2 callOutcome → shape (not color, чтобы не двойного encoding)

| `callOutcome`           | Shape                | Lucide icon                |
|--------------------------|----------------------|----------------------------|
| `real_conversation`      | `●` filled circle    | `Phone` (filled)           |
| `voicemail`, `ivr`       | `○` ring             | `Voicemail`                |
| `no_answer`              | small `○`            | `PhoneOff`                 |
| `hung_up`                | `✕` cross (red stroke)| `PhoneMissed`              |
| `technical_issue`        | `▲` triangle (alert) | `AlertTriangle` red        |
| `no_speech_or_silence`   | `·` tiny dot gray    | `MicOff`                   |

### 5.3 Стрелочное правило (Tufte: simple is better)

Если для какого-то звонка outcome=null AND callOutcome!=real_conversation → используем shape, цвет `--text-muted`. Никаких magenta-ярких "unknown" артефактов.

---

## 6. Graceful degradation: NULL dealId / NULL stageName

### 6.1 Текущий bug

Memory: «only 1 distinct deal per 5038 calls». Большинство `dealId = NULL`, значит и stageName = NULL.

### 6.2 Стратегия отображения

**Сценарий A: deal привязана (есть `primaryDealCrmId`)**

- Timeline отрисовывается полным (5-7 bands).
- Звонки с `stageName = NULL` (orphan) → отдельный bottom band «**Без сделки**» (icon `⚠️`, fill `surface-1`).
- Tooltip на orphan: «Звонок не привязан к сделке — фоновый/повторный?»
- Accordion для «Без сделки» имеет subtitle «Возможные причины: callback из старой воронки, потерян dealId при импорте».

**Сценарий B: deal не привязана вообще (`primaryDealCrmId === null`)**

- Header заголовок: «Сделок не привязано — flat history».
- Timeline скрыт.
- Показываем только flat-list звонков (текущая table).
- Banner сверху таблицы (лёгкий, не алертный):
  ```
  ⓘ У клиента нет привязанных сделок. Если ожидаете сделку — проверьте,
     совпадает ли gcContactId с deal.clientCrmId в воронке GC.
  ```

**Сценарий C: dealId есть, но `currentStageCrmId` всех звонков NULL** (стало после backfill bug)

- Header показывает deal title и общий count.
- Вместо band-timeline — degraded-mode timeline: один band «Все звонки», dots в хронологии.
- Tooltip объясняет: «Этапы не зафиксированы — сделка #X в текущем состоянии Y».

### 6.3 Code sketch (где обрабатывать)

В `client-detail-gc.ts` уже есть `stageJourney`. Расширяем return:
```ts
hasDealLink: boolean        // primaryDealCrmId !== null
hasStageData: boolean       // stageJourney.length > 0
orphanCallsCount: number    // calls.filter(c => !c.stageName).length
```
В компоненте — switch по этим флагам, рендерим A / B / C.

---

## 7. Reuse vs custom (24h budget)

### 7.1 Что можно взять как есть

| Need                        | Solution                                           |
|------------------------------|----------------------------------------------------|
| Accordion drill-down         | shadcn `<Accordion>` ✅ (уже в `src/components/ui/`)|
| Tooltip on hover             | shadcn `<Tooltip>` ✅                               |
| Badge chips (filter pills)   | shadcn `<Badge>` ✅                                 |
| Color tokens                 | Tailwind v4 vars `status-green/amber/red`, `ai-2` ✅|
| Icons                        | `lucide-react` ✅                                   |

### 7.2 Что нужно собрать (Recharts)

`<ScatterChart>` отлично подходит:
- `<XAxis type="number" dataKey="time" domain={[firstStamp, lastStamp]} />` — дата как ms.
- `<YAxis type="category" dataKey="stageName" />` — этапы (или number 0..N с tickFormatter).
- `<Scatter data={...} shape={CustomDot} />` — кастомный dot per outcome.
- Bands за scatter — `<ReferenceArea y1={i-0.4} y2={i+0.4}>` per stage, fill='surface-2', cursor pointer through `onClick`.

**Custom code estimate:** ~150-200 LOC для timeline component (`stage-timeline.tsx`), ~80 LOC для drill-down (`stage-accordion.tsx`). Realistic в 24h.

### 7.3 Tremor — не подходит здесь

Tremor `<Tracker>` — bar-style, не scatter; `<BarList>` — не temporal. Можно использовать `<Tracker>` для **header chips** (4 problem · 2 risk · ...) если хочется готового. Optional — не критично.

### 7.4 Что точно НЕ делать

- ❌ Custom SVG с D3 force-layout (overkill, 24h не хватит на debug).
- ❌ Sankey-либа (`@nivo/sankey`, `react-sankey`) — добавляет 60kb, не используется больше нигде.
- ❌ Canvas/WebGL — overengineered для 12-50 точек.

---

## 8. Edge cases checklist

- [ ] `calls.length === 0` → existing return null, не рендерим карточку (already handled in query).
- [ ] `calls.length === 1` → timeline 1 band 1 dot; accordion одна секция auto-open.
- [ ] Все звонки в один день (boot calls test client) → X-axis squished. Mitigation: minimum domain = ±2 hours.
- [ ] Этап «Завершён/WON» (terminalKind=WON) → выделить green left-border, иконка флажок.
- [ ] Этап «Отменен/LOST» → red left-border, иконка крест.
- [ ] Звонок с `currentStageCrmId` но без `funnelStage.name` (FK rotted) → fallback `Этап #${crmId}` (already handled).
- [ ] `talkDuration === null` (не сматчился gcCallId) → dot size = 4px (min).
- [ ] dark mode → `status-*` vars уже dark-aware.
- [ ] mobile (max-width 1120px → portrait phone) → timeline horizontal scroll, accordion full-width.

---

## 9. Implementation skeleton (для следующего шага)

### Files to create

1. `src/app/(dashboard)/_components/gc/deal-stage-timeline.tsx` — Recharts ScatterChart + bands + tooltip.
2. `src/app/(dashboard)/_components/gc/deal-stage-accordion.tsx` — accordion с drill-down списком, фильтр по chips.
3. `src/app/(dashboard)/_components/gc/deal-stage-section.tsx` — composer (timeline + chips + accordion + degraded mode switch).

### Files to modify

1. `src/lib/queries/client-detail-gc.ts` — добавить `dealTitle`, `hasDealLink`, `orphanCallsCount`, `dealStatus` в return.
2. `src/app/(dashboard)/_components/gc/client-card.tsx` — заменить блоки «Движение клиента по воронке» + «История звонков» на `<DealStageSection />`.

### Что НЕ удаляем

- Counter-block (4 счётчика) — остаётся.
- Deep-links строка — остаётся.
- Header (имя + gcContactId) — остаётся.

---

## 10. Risks

1. **Recharts CategoryYAxis ordering** — может срендерить этапы alphabetically. Решение: явно передавать `funnel.stages` в порядке `order`, использовать `interval={0}` + explicit `tickFormatter` с порядковым индексом.
2. **Timeline scaling** — если first call 14.04 а last 22.04, между ними 2 недели тишины — пустота. Решение: optional «squish-time» toggle (по умолчанию OFF, off=линейное время Tufte-style).
3. **Accordion default-open evaluation** — нужно посчитать problem-stage до рендера. Делать в server query (`primaryProblemStage` field) — не в client.
4. **Color-blind users** (Tufte concern) — outcome имеет и shape (✕/●/○) и color — accessible. `lucide` иконки в accordion дублируют.
5. **Перформанс** — для клиента с 200+ звонков ScatterChart тормозит. Mitigation: clamp displayed dots на band до 30 + показать «+24 ещё» badge, остальные доступны через accordion.

---

## 11. Acceptance criteria (Krug-style: РОП 5-second test)

После открытия `/managers/X/clients/Y`, РОП за 5 секунд отвечает:
1. ✅ «Сделка идёт через 5 этапов».
2. ✅ «На этапе Презентация что-то сломалось — там 4 красных».
3. ✅ Кликнул на Презентацию → видит конкретные звонки и managerWeakSpot.
4. ✅ Кликнул на звонок → попал в карточку звонка `/calls/{pbxUuid}`.

Если хоть один шаг требует «думать» — Krug-fail, переделываем.
