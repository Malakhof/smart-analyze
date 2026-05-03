# UI Redesign — Premiere 2026-05-04 (косметика, не rebuild)

> **Status:** Research complete (9 экспертов параллельно)
> **Date:** 2026-05-03
> **Premiere:** 2026-05-04 днём (~24h budget)
> **Goal:** перевести UI из «structure ok, но cluttered/нечитабельно» в «logical, monolithic, readable, friendly» — БЕЗ потери ни одного полезного элемента и БЕЗ rebuild
> **Mission statement:** «how to present existing content better», не «что добавить/убрать»

Эксперты-источники:
- Q1 — `docs/plans/experts/01-conditional-show-hide-matrix.md` (Krug + Abramov)
- Q2 — `docs/plans/experts/02-parse-ui-reconcile.md` (Fowler)
- Q3 — `docs/plans/experts/03-anketa-diva-compliance.md` (domain/AJTBD)
- Q4 — `docs/plans/experts/04-charts-readability.md` (Tufte + Few + Cleveland)
- Q5 — `docs/plans/experts/05-main-page-reorganize.md` (Eyal + Krug)
- Q6 — `docs/plans/experts/06-deal-card-calls-by-stage.md` (Tufte + Few + Krug)
- Q7 — `docs/plans/experts/07-ama-getcourse-port.md` (Newman + Fowler)
- Q8 — `docs/plans/experts/08-gong-io-benchmark.md` (Eyal + Tufte + Krug)
- Q9 — `docs/plans/experts/09-per-category-etalons.md` + 5 файлов в `docs/canons/master-enrich-samples/sample-{A,B,C,D,E}-*.md`

---

## Table of Contents

1. [Overview](#overview)
2. [Q1 — Conditional show/hide matrix 7×17](#q1--conditional-showhide-matrix-7x17)
3. [Q2 — Parse↔UI reconcile gaps](#q2--parseui-reconcile-gaps)
4. [Q3 — Anketa diva compliance checklist](#q3--anketa-diva-compliance-checklist)
5. [Q4 — Charts readability redesign](#q4--charts-readability-redesign)
6. [Q5 — Главная страница reorganize](#q5--main-page-reorganize)
7. [Q6 — Карточка сделки calls-by-stage visualization](#q6--deal-card-calls-by-stage)
8. [Q7 — AMA → GETCOURSE quality page port](#q7--ama--getcourse-quality-page-port)
9. [Q8 — Gong.io presentation benchmark](#q8--gongio-presentation-benchmark)
10. [Q9 — Per-category etalons (Variant B executed)](#q9--per-category-etalons-variant-b-executed)
11. [Implementation Plan — P1 (24h) / P2 (post)](#implementation-plan)
12. [Riskiest decision needing user call](#riskiest-decision)

---

## Overview

### Goals
1. **Карточка звонка** перестаёт показывать пустые «—» блоки для no-action категорий (A/B/C/D/G).
2. **Главная** организуется в 3 семантические секции; Block 7 funnel перестаёт быть «cluttered/ненаглядный».
3. **/quality** для GETCOURSE перестаёт быть пустым (root cause: legacy queries читают пустую `CallScore`).
4. **Карточка сделки/клиента** показывает «где сделка застряла» за 3 секунды (timeline + drill-down).
5. **Skill v10 ready-to-write** — 5 эталонов A/B/C/D/E созданы (Variant B).

### Key Decisions

| Aspect | Decision |
|---|---|
| Q1 conditional render | Заменить `TypeSpecificContent` switch на декларативный `SHOW_FOR_CATEGORY` whitelist + `BLOCK_REGISTRY` map |
| Q2 reconcile | 9 P1 gaps (top: `enrichmentStatus`/`possibleDuplicate`/`isFirstLine` не отрендерены; KvRow рисует 5 «—» подряд) |
| Q3 anketa compliance | 79% общая (86.7% без неблокирующих дублей); top P1 = split «МОПы / Первая линия» в навигации |
| Q4 charts | Top-3 24h: Block 7 funnel (drop gradient + stage-order sort), QcDonut→ranked bars, heatmap chartjunk cleanup |
| Q5 main page | Option B: 3 секции «Сегодня — кто работает» / «Качество отдела» / «Тренды»; Block 7 редизайн (horiz stacked bar + leaderboard) |
| Q6 deal card | Hybrid: horizontal timeline (Recharts ScatterChart + ReferenceArea) + shadcn Accordion drill-down |
| Q7 quality port | **Opt 4** = parallel `quality-gc.ts` query, 11/13 components reused as-is, 1 adapter (CallSlideOver), 1 new (QcCallTypeFilter) |
| Q8 Gong patterns | Borrow per-call **Stats panel** (talk ratio, longest monologue, interactivity) + **traffic light** color ranges; reject 14-widget dashboard pattern |
| Q9 etalons | Variant B executed: 5 файлов sample-A/B/C/D/E.md созданы с anti-hallucination explicit-null sections |

---

## Q1 — Conditional Show/Hide Matrix 7×17

**Recommendation:** заменить процедурный `TypeSpecificContent({type})` early-return-switch в `call-card.tsx` на **декларативный whitelist** — `SHOW_FOR_CATEGORY: Record<CallType, BlockId[]>` + `BLOCK_REGISTRY: Record<BlockId, ComponentRef>`. Матрица из доки = объект в коде 1:1. Single source of truth + unit-testable + второй cordon против Opus-галлюцинации (HIDE-слой ловит то что NULL-контракт Q9 пропустил).

### Матрица (категория × блок)

| # | Блок | A NO_SPEECH | B VOICEMAIL | C HUNG_UP | D TECHNICAL | E SHORT_RESCH | F NORMAL | G GAP |
|---|---|---|---|---|---|---|---|---|
| 1 | Header (meta+links) | SHOW | SHOW | SHOW | SHOW | SHOW | SHOW | SHOW |
| 2 | TypeBadge | SHOW | SHOW | SHOW | SHOW | SHOW | SHOW | SHOW |
| 3 | Audio player | COND¹ | COND¹ | COND¹ | COND¹ | SHOW | SHOW | HIDE |
| 4 | **CategoryHero** (новый) | SHOW² | SHOW² | SHOW² | SHOW² | SHOW² | SHOW² | SHOW² |
| 5 | Transcript | COND³ | SHOW | COND⁴ | SHOW | SHOW | SHOW | HIDE |
| 6 | callSummary + weakSpot | HIDE | HIDE | HIDE | HIDE | SHOW (краткий) | SHOW | HIDE |
| 7 | PsychBlock | HIDE | HIDE | HIDE | HIDE | HIDE | SHOW | HIDE |
| 8 | ScriptBlock (11 этапов) | HIDE | HIDE | HIDE | HIDE | SHOW (упр.)⁶ | SHOW | HIDE |
| 9 | PhraseCompliance (12) | HIDE | HIDE | HIDE | HIDE | HIDE | SHOW | HIDE |
| 10 | CriticalErrors | HIDE | HIDE | HIDE | HIDE | HIDE⁷ | SHOW | HIDE |
| 11 | CriticalDialogMoments | HIDE | HIDE | HIDE | HIDE | HIDE | COND⁸ | HIDE |
| 12 | RopInsight | HIDE | SHOW (НДЗ) | SHOW (НДЗ) | SHOW (тех) | SHOW (callback) | SHOW | HIDE |
| 13 | NextStep | HIDE | HIDE | HIDE | HIDE | SHOW | SHOW | HIDE |
| 14 | Commitments | HIDE | COND¹¹ | HIDE | HIDE | SHOW | SHOW | HIDE |
| 15 | CategoryBlock (k-v dump) | SHOW (мин)¹² | SHOW (мин)¹² | SHOW (мин)¹² | SHOW (мин)¹² | SHOW | SHOW | SHOW (мин) |
| 16 | TagsBlock | COND | COND | COND | COND | COND | COND | SHOW |
| 17 | **DiagnosticBlock** (G) | HIDE | HIDE | HIDE | HIDE | HIDE | HIDE | SHOW |

Footnotes (см. полный файл `01-conditional-show-hide-matrix.md` для всех 13).

### CategoryHero messages (1 фраза per category)

| A | «Whisper не нашёл речь — звонок не оценивается. При сомнении послушать вручную.» 🤐 |
| B | «Автоответчик/IVR — НДЗ. Контролируй частоту повторных попыток.» 🎙 |
| C | «Клиент сбросил/не ответил. НДЗ. Если повторяется в одно время — оптимизируй расписание.» ☎️ |
| D | «🚨 Тех. сбой — алерт тех. отделу. Не оценка МОПа. >3/неделя — гарнитура.» 🚨 |
| E | «Короткий перенос. Callback назначен на «{deadline}» — проверь к {deadline+1д}.» 🕐 |
| F | «{outcome}. Главный инсайт: {managerWeakSpot \|\| первая фраза ropInsight}.» |
| G | «🛠 Pipeline gap: {reason}. Это инфра, не МОП.» 🛠 |

---

## Q2 — Parse↔UI Reconcile Gaps

**Найдено 49 разрывов** (полная разбивка в `02-parse-ui-reconcile.md`):
- **9 P1** (премьерные блокеры)
- **22 P2** (бэклог)
- **18 not-fix** (intentional / упоминаются повторно)

### Top-5 P1 концертные правки

| # | Поле | Файл / line | Action |
|---|---|---|---|
| 1 | `enrichmentStatus` (`enriched/in_progress/needs_rerun_v9/pipeline_gap`) | `dashboard-rop.tsx` Block 1 footer; `call-card.tsx` Header | Рендерить как badge — сейчас совсем не отображается |
| 2 | `possibleDuplicate` (Block 8 анкеты) | `call-card.tsx` Header или Tags | Badge «возможный дубль» — сейчас not rendered |
| 3 | `isFirstLine` | `managers-list.tsx` + nav | Split МОПы/Первая линия в навигации (анкета 2.1) |
| 4 | KvRow-ы CategoryBlock с 5 «—» подряд | `call-card.tsx:CategoryBlock` | Conditional skip rows where value=NULL/«—» (cross-ref Q1 footnote 12) |
| 5 | Колонка «Этап сделки» в client-card 30 «—» подряд | `client-card.tsx` flat-list | Скрыть колонку если `dealId === null` >50%; иначе fallback «—» только для отдельных строк |

### Refactor pattern (P2 — после премьеры)
```tsx
<Field value={x} fallback="skip" />     // вместо рендера «—»
<TypeGate showFor={[F, E]}>...</TypeGate>  // wrapper для conditional блоков
```

---

## Q3 — Anketa Diva Compliance Checklist

**Overall compliance: ~79% (86.7% без неблокирующего раздела «Дубли»)**

| Section | Coverage | Notes |
|---|---|---|
| §1 Телефония | 100% | onPBX status в Settings (P2 Stage 6 не начат) |
| §2 Менеджеры (МОПы / Первая линия / кураторы) | 60% | **P1: split МОПы↔Первая линия в навигации** — `isFirstLine` хранится но не используется |
| §3 Воронки | 80% | "Нет главной воронки" — наш UI не привязывается к funnel, OK |
| §4 Что считать продажей (`Deal.amount > 0 AND status=WON`) | 50% | **P1: счётчик WON-сделок за период на главной (без денег)** |
| §5 Категории звонков (7 enums) | 100% (7/7) | classifyCallType + DeepSeek classifier — все покрыты |
| §6 6 critical errors | 100% (6/6) | rendered в CriticalErrorsBlock |
| §7 CRM-поля | n/a | закрыто командой через HTML parsing |
| §8 Дубли | 25% | `possibleDuplicate` в схеме — не рендерится (повтор P1 Q2) |
| §9 Боли РОПа (наборы / НДЗ / АО / реальные / оценка МОП / отдел / разбивки) | 93% | **P1: AVG script score отдела single-number на главной** |

«Лишнего нет» — verified: revenue/AOV/выручка отсутствуют, alert-spam отсутствует.

### Top-5 P1 missing items (~5h комплекс)
1. Split «МОПы / Первая линия» на /managers (filter + tabs)
2. WON-сделок за период счётчик в Header главной
3. Verify substring conflict «Чернышова» (МОП) vs «Чернышева» (куратор) в `CURATOR_LASTNAMES`
4. Department-avg script score single-number widget
5. «Без аудио» → «Не дотянулось» с tooltip

---

## Q4 — Charts Readability Redesign

> Tufte + Few + Cleveland: position-on-axis > length > angle > area > color. Сортировка по убыванию + tabular-nums + 1 цветовой канал (semantic, не decorative).

### Top-3 24h fixes (~2h frontend, all JSX-level — no new queries/deps)

#### W1 — Block 7 Funnel (главная жалоба пользователя)

**Current:** градиент `linear-gradient(135deg, ai-1, ai-2)` на каждом баре, sort by count desc → ломает funnel mental model.

**Proposed (textual wireframe):**
```
┌─────────────────────────────────────────────────────────────────────┐
│ Куда движутся клиенты после наших звонков                          │
│ Сделки в порядке стадии воронки. % = от всех затронутых сделок.    │
├─────────────────────────────────────────────────────────────────────┤
│ 1. Новый                ▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆      47   18%        │
│ 2. Качественный         ▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆         39   15%        │
│ 3. Презентация          ▆▆▆▆▆▆▆▆▆▆▆▆▆▆            32   12%        │
│ 4. Оплата ожидается     ▆▆▆▆▆▆▆▆▆▆▆▆               28   11%        │
│ 5. Закрыта (выиграна)   ▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆   54   21%   ●green│
│ 6. Закрыта (проиграна)  ▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆   62   23%   ●red  │
└─────────────────────────────────────────────────────────────────────┘
```

Rules: (a) sort by **stage order**, не Pareto; (b) single-hue `surface-3` fill; (c) `status-green` ONLY на closed-won, `status-red` ONLY на closed-lost.

#### W2 — QcDonut → Ranked bar list (Контроль качества)

Drop the donut entirely. The "legend" already encodes everything; donut adds 0 info while costing 160px and 5 random colours.

```
Категории звонков
[████████████░░░░░░] квалификация_лида        128  42%
[████████░░░░░░░░░░] продажи_новый              81  27%
[████░░░░░░░░░░░░░░] поддержка_ученика          42  14%
[██░░░░░░░░░░░░░░░░] техвопрос                  21   7%
[██░░░░░░░░░░░░░░░░] прочее                     20   7%
[█░░░░░░░░░░░░░░░░░] win_back                    9   3%
```

#### W3 — Heatmap chartjunk cleanup (Block 6 + manager-detail)

- Remove per-cell border (use 1px gap as negative space)
- Drop `h % 3 === 0` label heuristic → fixed ticks `0/6/12/18/23` only
- Striped diagonal pattern for `total=0` cells (semantically ≠ "low success")
- Add right-side row totals + bottom column totals (Tufte marginals)
- Subtle background band 9-21 hours = "working hours"

### P2 (post-premiere)
- Block 2 dotplot (replace hand-rolled bars)
- QcCompliance AreaChart → LineChart with ghost prior period
- QcScoreDistribution → small multiples (current ‖ previous)
- Manager-detail callType/managerStyle bars: drop gradient, single fill

---

## Q5 — Main Page Reorganize

**Decision: Option B — three-section grouping** «Сегодня — кто работает» / «Качество отдела» / «Тренды и контекст».

### Wireframe (textual)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ TENANT: diva-school    PERIOD [today][week][MONTH]   ⏳ ожидают MEnrich N │
├══════════════════════════════════════════════════════════════════════════┤
│  СЕКЦИЯ I — «Сегодня — кто работает» (above the fold)                    │
│  ───────────────────────────────────────────────────────────             │
│  [Block 1 — Daily activity per МОП — full width table]                  │
│  [Block 3 — Top-10 проблемных звонков — full width list]                │
│  [Block 5 — Обещания требующие follow-up — full width list]             │
├══════════════════════════════════════════════════════════════════════════┤
│  СЕКЦИЯ II — «Качество отдела»                                           │
│  ───────────────────────────────────────────────────────────             │
│  [Block 2 — Оценка скрипта]    [Block 4 — Упущенные техники]   (2-col)  │
│  [Block 4b — Системные паттерны (weakSpot ‖ criticalErrors)]   (2-col)  │
├══════════════════════════════════════════════════════════════════════════┤
│  СЕКЦИЯ III — «Тренды и контекст»                                        │
│  ───────────────────────────────────────────────────────────             │
│  [Block 7 — Куда движутся клиенты — full width, РЕДИЗАЙН W1]            │
│  [Block 6 — Когда лучше звонить — full width heatmap]                   │
├══════════════════════════════════════════════════════════════════════════┤
│ FOOTER: last sync · pipeline gap badge                                   │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3 priority widgets (above the fold)
1. **Block 1 (activity table)** — habit trigger «есть ли проблемные МОПы?» (anketa §9)
2. **Block 3 (worst calls)** — action «куда зайти и послушать»
3. **Block 5 (commitments)** — variable reward (sometimes empty, sometimes 5 follow-ups)

### Block 7 redesign (per user complaint «funnel ненаглядны»)
Применяем W1 wireframe (Q4) — stage-order sort, single fill, semantic color на терминальных стадиях. БЕЗ Sankey/Pie/3D-funnel — это anti-pattern для канона #37.

### Алёрт-hero не делаем
Анкета §9: «Алёрты НЕ нужны». Soft anomaly (амбер цвет в Block 1 pipelineGap, красный в Block 2) — допустимо. Modal/banner/sticky alert — ЗАПРЕЩЕНО.

---

## Q6 — Deal Card Calls-by-Stage

**Recommendation: Option E — Hybrid Horizontal Timeline + shadcn Accordion drill-down.** Recharts `ScatterChart` + `ReferenceArea`, без новых либ.

### Wireframe

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Звонки по этапам сделки                                                  │
│ Цвет = outcome, форма = callOutcome, размер = talkDuration              │
├──────────────────────────────────────────────────────────────────────────┤
│  Заявка       ●  ○                                                       │
│  Квалифик.       ●  ●  ●●                                                │
│  Презентация            ▲▲▲▲ ◆       ← кластер тут = провал презентации │
│  Оплата                            ●                                     │
│  Закрыта-WON                              ★                              │
│                ───────────────────────────────────────────►              │
│                12.04   14.04   18.04   22.04   28.04                    │
├──────────────────────────────────────────────────────────────────────────┤
│ ▼ Презентация (4 звонка, 3 objection_unresolved)         [click row]   │
│   • 18.04 14:30  Наталья → 8:32   objection_unresolved   score 56%     │
│   • 19.04 11:15  Наталья → 12:11  objection_unresolved   score 48%     │
│   • 20.04 16:00  Наталья → 5:42   no_offer_made          score 43%     │
│   • 21.04 09:30  Наталья → 18:00  closed_lost            score 51%     │
└──────────────────────────────────────────────────────────────────────────┘
```

### Color/icon canon
- ● = real_conversation closed_won (status-green)
- ◆ = real_conversation objection_unresolved (status-amber)
- ▲ = real_conversation closed_lost (status-red)
- ○ = voicemail/IVR (text-muted ring)
- ✕ = hung_up/no_answer (text-tertiary X)
- ★ = closed_won terminal (filled gold)

### NULL dealId graceful degradation
**Stage 7.5b cron функционален.** Реальное покрытие на 2026-05-03:
- 5324 звонков с 24.04 → 1330 с dealId (25%) → 493 distinct deals
- 75% NULL = норма для cold-prospecting (сделка создаётся позже первого контакта)

UI behavior:
- Если у клиента/сделки часть звонков с dealId, часть NULL → отдельный band «Без сделки» внизу timeline'а
- Если все звонки `dealId=NULL` → показать **flat list** без timeline + ненавязчивый hint «Звонки до создания сделки»
- НЕ показывать пустой timeline без данных
- НЕ блокировать Hybrid Timeline cron-fix'ом — он не нужен

---

## Q7 — AMA → GETCOURSE Quality Page Port

**Decision: Opt 4 — Query-swap, UI reuse** (Newman + Fowler «extract pattern, preserve behavior»).

### Root cause of «пусто»
Legacy `getQualityDashboard / getQcChartData / getQcGraphData` читают `CallScore` table — для diva (GC) Master Enrich пишет НЕ туда, а в плоские поля `CallRecord.scriptScorePct/scriptDetails/phraseCompliance/enrichedTags`. → `CallScore.findMany`=0 → render "За выбранный период звонков не найдено".

### Component port plan (13 components + 2 page-level)

| Component | Status | Action |
|---|---|---|
| QcSummary (4 KPI cards) | ✅ Reuse + swap source | use `scriptScorePct` |
| QcDonutCharts | ✅ Reuse + swap source (или редизайн W2) | tags = `enrichedTags`, не `CallTag` |
| QcComplianceChart | ⚠️ Need new shape | aggregate `scriptDetails.stages[]` by name |
| QcScoreDistribution | ✅ Reuse + swap source | bucket on `scriptScorePct` (0..100) |
| QcManagerTable | ✅ Reuse + swap source | avg `scriptScorePct`; criticalMisses = count `criticalErrors` |
| QcRecentCalls | ✅ Reuse | `totalScore=scriptScorePct`, `recommendation=nextStepRecommendation` |
| QcFilters | ✅ Reuse | step list = `SCRIPT_STAGE_LABELS` constant |
| QcVoicemailFilter | ✅ Reuse | filter on `callOutcome IN (real_conversation)` |
| QcScriptScoreBadge | ✅ As-is | already param `maxScore=11` |
| QcTranscriptToggle | ✅ As-is | UI-only |
| ScriptChecklist | ⚠️ Need new shape | render `scriptDetails.stages[]` |
| AudioPlayer | ✅ As-is | URL-only |
| CallSlideOver | ⚠️ Adapter needed | switch to `getCallDetailByPbxUuid` for GC; or link to `/calls/[pbxUuid]` |
| `quality/page.tsx` | 🆕 Switch | by `getCrmProvider()` |
| `lib/queries/quality.ts` | 🆕 Parallel `quality-gc.ts` | reexport same interfaces |

### New components (1)
**`QcCallTypeFilter`** — chip-row из 7 кнопок (А-G). Использует `classifyCallType()`. URL param `?ctype=NORMAL,VOICEMAIL_IVR,...`.

### File paths to modify
```
src/app/(dashboard)/quality/page.tsx:30   // switch by getCrmProvider()
src/lib/queries/quality-gc.ts (NEW)       // parallel implementation
src/app/(dashboard)/quality/_components/qc-call-type-filter.tsx (NEW)
src/app/(dashboard)/quality/_components/call-slide-over.tsx     // adapter for GC fetch
src/app/(dashboard)/quality/_components/script-checklist.tsx    // render scriptDetails for GC
```

ETA: 4-5h.

---

## Q8 — Gong.io Presentation Benchmark

### Top-3 24h adopts

| # | Pattern | Where to apply | Effort |
|---|---|---|---|
| 1 | **Traffic-light color ranges** (green/amber/red) на performance widget | Block 2 (script score per МОП) — уже есть, но threshold не идеален | ~1h |
| 2 | **Compact Stats panel** (talk ratio, longest monologue, interactivity, phase coverage) | Карточка звонка `call-card.tsx` — 4 числа справа от Header | ~2-3h |
| 3 | **Horizontal speaker timeline bar** | Карточка звонка — над транскриптом, видно монологи МОПа глазом | ~2h |

### Reject list

- **Deal Health Score percentile** — наша edu vertical не считает deal warmth тем же способом
- **14-widget dashboard** — главный pain point Gong по G2 reviews; наш канон #37 (5+4+3) уже сильнее
- **Topics/trackers** — у нас anketa-категории, не general NLP topic detection
- **Forecast/quota widgets** — анкета diva явно «нет revenue, нет конверсий между этапами»

### Главный insight
Gong даёт хорошие per-call patterns, но плохой dashboard pattern (14 widgets). Adopt presentation patterns на уровне **карточки звонка**, НЕ dashboard widgets.

### P2 backlog (Gong-style, post-premiere)
- Per-call AI brief в стиле Spotlight (1 параграф recap)
- "Ask Anything" свободный ввод РОПа поверх carteчек звонка (Канон #37 Block 4 уже про это)
- Smart deal-health badges на карточке клиента

---

## Q9 — Per-Category Etalons (Variant B Executed)

**Status: ✅ DONE — 5 файлов созданы.**

### Files created
1. `docs/canons/master-enrich-samples/sample-A-no-speech.md`
2. `docs/canons/master-enrich-samples/sample-B-voicemail-ivr.md`
3. `docs/canons/master-enrich-samples/sample-C-hung-up-no-answer.md`
4. `docs/canons/master-enrich-samples/sample-D-technical-issue.md`
5. `docs/canons/master-enrich-samples/sample-E-short-reschedule.md` ⚠️ priority (47-сек реалистичный пример с cleanup, 11-stage scriptDetails, callback commitment)

### Universal invariant
Каждый эталон содержит секцию «Какие поля null / [] / {} / not_applicable + WHY» где для каждого пустого поля объяснено что Opus МОГ БЫ сгаллюцинировать (e.g., «не записывать "Алло" как keyClientPhrase», «не ставить scriptScore=1/11 за приветствие в пустоту»).

### Closes Skill v10 design
60% pre-flight (CATEGORIES.md / EDGE-CASES.md / CATALOG.md / sample-3 / sample-4) + 40% (5 новых эталонов) = 100%. Skill v10 готов к написанию.

### Notes for skill v10 author
1. Pre-classification ОБЯЗАТЕЛЬНА: A/B/C/D → no Opus (template fill), E → simplified Opus (~30-60s), F → full Opus (~90-120s). Economy: ~70% calls без Opus.
2. Validator runtime — independent code, не Opus
3. Backfill `--limit=10` в одном окне с свежими carteчками
4. G PIPELINE_GAP — sample skipped (optional)

---

## Implementation Plan

### ВСЁ — P1 (нет P2, всё делаем сейчас) ≈ 32-40h

**P1.1 Conditional show/hide refactor (Q1) — ~3h**
- [ ] Создать `BLOCK_REGISTRY` map + `SHOW_FOR_CATEGORY` whitelist в `call-card.tsx`
- [ ] Добавить `CategoryHero` компонент (1 фраза per A-G)
- [ ] Добавить `DiagnosticBlock` для G PIPELINE_GAP

**P1.2 Q2 точечные правки (Top-5 gaps) — ~2h**
- [ ] `enrichmentStatus` badge в Header
- [ ] `possibleDuplicate` badge в Header/Tags
- [ ] `isFirstLine` split в /managers (P1 пересечение с Q3)
- [ ] CategoryBlock conditional skip rows
- [ ] client-card flat-list колонка «Этап сделки» conditional hide

**P1.3 Charts top-3 (Q4) — ~2h**
- [ ] Block 7 funnel: drop gradient, stage-order sort, semantic color
- [ ] QcDonut → ranked bars (drop pie)
- [ ] Heatmap chartjunk cleanup

**P1.4 Главная full reorganize (Q5 Option B полный) — ~3h**
- [ ] Add 3 section headers (`<h2>` с ai-gradient underline)
- [ ] **Reorder blocks: I={1,3,5} / II={2,4,4b} / III={7,6}** — полная перестановка
- [ ] Smoke test после reorder: pipelineGap badge на месте, heatmap позиция OK

**P1.5 Quality page port (Q7) — ~3-4h**
- [ ] Create `src/lib/queries/quality-gc.ts` parallel implementation
- [ ] Switch `quality/page.tsx:30` by `getCrmProvider()`
- [ ] Adapter для `CallSlideOver` (link to `/calls/[pbxUuid]`)
- [ ] New `QcCallTypeFilter` chip-row

**P1.6 Q3 anketa P1 fixes — ~1h**
- [ ] WON-сделок счётчик в Header
- [ ] Department-avg script score widget
- [ ] Verify «Чернышова» vs «Чернышева» в `CURATOR_LASTNAMES`

**P1.7 REMOVED — cron Stage 7.5b функционален**
~~Cron Stage 3.5 phone resolve fix~~ — отменено 2026-05-03 после verify в БД:
- Реальное покрытие: 1330/5324 (25%) звонков с dealId, 493 distinct deals
- 75% NULL = норма для cold-prospecting, не bug
- Hybrid Timeline (P1.8) идёт **standalone**, без блокера
- Освобождается ~3-4h budget'а

**P1.8 Карточка сделки — Hybrid Timeline (Q6) — ~4-5h** (standalone, без зависимости)
- [ ] Recharts ScatterChart + ReferenceArea для timeline по этапам
- [ ] Color/icon canon (●/◆/▲/○/✕/★ per outcome × callOutcome)
- [ ] shadcn Accordion drill-down per stage
- [ ] Graceful degradation для NULL dealId (fallback flat list + banner)

**P1.9 Settings страница (Stage 6) — ~4-5h**
- [ ] Tab Telephony: onPBX status + last-sync + masked apiKey + stereo flag
- [ ] Tab Health: cron last-sync + GC cookie expires_at + ReconciliationCheck via `db.$queryRaw`
- [ ] Tab integration с existing nav (`NAV_ITEMS_GC` 4 пункт «Настройки» уже есть)
- [ ] Reuse existing «Скрипт продаж» + «Связки» tabs

**P1.10 Q1 hybrid-WARN dev-mode — ~1h**
- [ ] Dev-mode badge для unexpected populated blocks (HIDE-категория получила данные)

**P1.11 Q2 refactor helpers — ~2h**
- [ ] `<Field fallback="skip|dash|loading">` helper
- [ ] `<TypeGate showFor={[...]}>` wrapper

**P1.12 Q4 остальные charts — ~3h**
- [ ] Block 2 dotplot replace hand-rolled bars
- [ ] QcCompliance AreaChart → LineChart с ghost prior period
- [ ] QcScoreDistribution → small multiples (current ‖ previous)
- [ ] manager-detail callType/managerStyle bars без gradient

**P1.13 Q5 hero card mini-summary (Option C) — ~3h**
- [ ] Above-the-fold compact hero «Сегодня: N наборов · M разговоров · средний скрипт X% · K МОПов в красной зоне»
- [ ] Consistency check с Block 1 цифрами

**P1.14 Q5 sparklines + collapsible — ~2h**
- [ ] Inline sparkline на Block 1 «Дозвоны» колонке
- [ ] Collapsible Block 6 (heatmap) и Block 4b (паттерны)

**P1.15 Q7 ScriptChecklist new shape для GC — ~2h**
- [ ] Render `scriptDetails.stages[]` для GC mode
- [ ] Reuse существующий ✅/❌ паттерн

**P1.16 Q8 Gong-style панели в карточке звонка — ~4-5h**
- [ ] Stats panel (talk ratio, longest monologue, interactivity, phase coverage) — 4 числа справа от Header
- [ ] Horizontal speaker timeline bar над транскриптом
- [ ] Traffic-light color ranges threshold tuning на Block 2

**P1.17 Skill v10 написание — ~4-6h**
- [ ] Переписать SKILL.md под `ui-enrichment-contract.md` + per-category из `EDGE-CASES.md`
- [ ] Runtime validator `scripts/validate-enrich-sql.ts`
- [ ] Тест 10 свежих звонков → если ≥9/10 pass → разрешить backfill `--limit=10`

**Total ETA: ~32-40h.** Это НЕ помещается в 24h одной сессии. Варианты:
1. **Параллельная работа** — 2-3 фронтенд-сессии одновременно (UI редизайн + skill v10)
2. **Подвинуть премьеру** на 5-6.05 для безопасной реализации всех 17 пунктов
3. **Срочный triage** — критические для премьеры (P1.1-P1.5 + P1.7-P1.8 ≈ 18-22h) делать первыми, остальное (P1.9 Settings, P1.13-P1.17 polish) — догнать к утру 4.05 в режиме нон-стоп

Рекомендация: запросить у пользователя подтверждение реалистичного scope для 24h ИЛИ согласие на параллельную работу нескольких сессий.

---

## Success Metrics

| Metric | Baseline | Target (24h) |
|---|---|---|
| Card empty «—» blocks for A/B/C/D | 5-7 visible per card | 0 (HIDE matrix) |
| Block 7 funnel readability (РОП test) | "ненаглядно" | "читается за 3 сек" (stage order + semantic color) |
| /quality для GETCOURSE | "пусто" | charts populated |
| Anketa diva compliance | 79% | ≥85% (top-5 P1 fixes) |
| Skill v10 etalons | 2/7 (только F) | 7/7 (5 новых + sample-3/4) |
| Reviewer 4.05 verdict | TBD | "ready for client demo" |

---

## Riskiest Decision

**Самый рискованный аспект который требует решения user'а:**

**Q5 reorder vs only-section-headers tradeoff.** Полный Option B (3 секции + перестановка блоков) даёт лучший UX но рискует регрессией: pipelineGap badge может оказаться не там где привык РОП, heatmap уезжает ниже скролла. Альтернатива — добавить только 3 section header'а БЕЗ перестановки порядка blocks в `dashboard-rop.tsx`. Это 30 минут вместо 2 часов и **0 риска регрессии**.

**Вопрос user'у:** соглашаемся ли на полный reorder (Option B как описано) или ограничиваемся «section headers only» (мини-вариант B') ради безопасности 24h до reviewer? Default: **section headers only для P1**, полный reorder в P2 после фидбэка reviewer.

Второй риск — **Q7 ETA 4-5h.** Это самый дорогой пункт P1. Если quality page port пожирает день, выкидываем P1.4 + P1.6 ради него. Quality «пусто» — главная видимая жалоба.

---

**Last updated: 2026-05-03**
