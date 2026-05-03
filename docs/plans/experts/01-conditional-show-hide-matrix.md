# Q1: Conditional Show/Hide Matrix per Category (Steve Krug + Dan Abramov)

**Date:** 2026-05-03
**Author hat:** Steve Krug (don't make me think) + Dan Abramov (React conditional rendering)
**Premiere context:** редизайн карточки звонка к 2026-05-04 reviewer demo
**Source files reviewed:**
- `docs/canons/master-enrich-samples/CATEGORIES.md` (7 категорий A-G + правила декларативно)
- `docs/canons/canon-master-enrich-card.md` (6+1 блоков enrichment)
- `docs/canons/ui-enrichment-contract.md` (UI ↔ data contract)
- `src/app/(dashboard)/_components/gc/call-card.tsx` (~1170 строк, текущий рендер)
- `src/lib/queries/call-detail-gc.ts` (`classifyCallType` server-side)
- `docs/canons/master-enrich-samples/sample-3-proper-cleanup-lara.md` (NORMAL F эталон)
- `docs/canons/master-enrich-samples/sample-4-strong-closer-tech-block.md` (NORMAL F эталон)

---

## 0. Зачем матрица существует

Сегодня в `call-card.tsx` есть `TypeSpecificContent({type})` который ветвится через раннюю серию `if (type === "PIPELINE_GAP") ...`. **Это близко к правильному решению**, но в нём **три скрытых дефекта**:

1. **Нет единого источника правды.** Какие блоки видны для категории E? Чтобы ответить — надо читать функцию TypeSpecificContent + смотреть default-case (NORMAL) + помнить что VOICEMAIL_IVR отличается от HUNG_UP только наличием CommitmentsBlock. Это **«make me think»** в чистом виде.
2. **NULL-fallbacks внутри блоков повторяют ту же логику.** `SummaryBlock` сам делает `if (!call.callSummary) return null`, `RopInsightBlock` тоже, `PsychBlock` тоже. Это означает что для **A NO_SPEECH** теоретически можно было бы вернуть весь NORMAL set и блоки сами бы скрылись — НО тогда категория D (TECHNICAL_ISSUE) с пустым callSummary всё равно показала бы пустой PsychBlock если БД случайно его получит. Анти-галлюцинация требует **explicit hide-by-category**, не «hide-if-null».
3. **Per-category «brief / hero message»** не выделен в отдельный блок. Сейчас category A/B/C/D/G используют CardHeader+CardDescription как hero, но это hard-coded прямо в TypeSpecificContent. Рейзинг этого в первоклассный блок «CategoryHero» позволяет:
   - писать единое сообщение «что РОПу делать с этим звонком» (Krug §Don't Make Me Think Ch.6 «Designing for usability»)
   - тестировать его независимо
   - переиспользовать логику для счётчиков в карточке МОПа

---

## 1. Matrix 7 × 17 (категория × блок)

**Легенда:**
- `SHOW` — блок гарантированно рендерится (со своим внутренним fallback на «обогащается» если NULL).
- `HIDE` — блок **никогда не рендерится** для этой категории, даже если в БД случайно появились данные. Защита от галлюцинации Opus.
- `COND` — рендерится только если значимое условие выполнено. Ниже в таблице — какое.
- `WARN` — особый сlaучай: для категории-где-HIDE данные пришли непустые. Отрисовать в `dev` режиме как warning-badge, в `prod` — silent skip + лог в Sentry / DB-counter (см. §5).

### Блоки (N=17)

Я расширил твой счёт ~14 до 17 для аккуратности (выделил то что в текущем коде «слипшееся в один блок»):

| #  | Блок (UI section)                          | Текущее имя в call-card.tsx                                | Источник (canon §)                |
|----|--------------------------------------------|------------------------------------------------------------|-----------------------------------|
| 1  | Header — meta (duration, talk, links)      | `Header`                                                   | Block 1 metadata + Block 2 links  |
| 2  | TypeBadge (категория)                      | `TypeBadge`                                                | classifyCallType output           |
| 3  | Audio player                               | `Player`                                                   | Block 1 audioUrl                  |
| 4  | **CategoryHero** (новый — 1-фразный совет) | (сейчас inlined в TypeSpecificContent CardHeader)          | _Краткое hero для каждой A-G_     |
| 5  | Transcript (cleanedTranscript fallback)    | `TranscriptBlock`                                          | Block 5 cleanedTranscript         |
| 6  | callSummary + managerWeakSpot              | `SummaryBlock`                                             | Block 5 summary                   |
| 7  | psychTriggers + clientReaction + managerStyle + emotionPeaks + keyPhrases | `PsychBlock` (большой) | Block 4                          |
| 8  | scriptScore + scriptDetails (11 этапов)    | `ScriptBlock`                                              | Block 3                          |
| 9  | phraseCompliance (12 техник)               | `PhraseComplianceBlock`                                    | Block 3 расширение                |
| 10 | criticalErrors                             | `CriticalErrorsBlock`                                      | Block 3 enum                      |
| 11 | criticalDialogMoments                      | `CriticalDialogMomentsBlock`                               | Block 4/5                         |
| 12 | ropInsight                                 | `RopInsightBlock`                                          | Block 5                          |
| 13 | nextStepRecommendation                     | `NextStepBlock`                                            | Block 5                          |
| 14 | extractedCommitments (Block 7)             | `CommitmentsBlock`                                         | Block 7 (killer feature)          |
| 15 | category / outcome k-v table               | `CategoryBlock`                                            | Block 2 enum dump                 |
| 16 | enrichedTags                               | `TagsBlock`                                                | Block 5 tags                     |
| 17 | **Diagnostic** (G only — что сломалось)    | (сейчас один CardDescription)                              | новый — `pipeline_gap` reason     |

### Полная матрица 7 × 17

| # | Блок                         | A NO_SPEECH | B VOICEMAIL/IVR | C HUNG_UP/NO_ANSWER | D TECHNICAL | E SHORT_RESCHEDULE | F NORMAL  | G PIPELINE_GAP |
|---|------------------------------|-------------|-----------------|----------------------|-------------|---------------------|-----------|-----------------|
| 1 | Header (meta + deep-links)   | SHOW        | SHOW            | SHOW                 | SHOW        | SHOW                | SHOW      | SHOW (limited)  |
| 2 | TypeBadge                    | SHOW        | SHOW            | SHOW                 | SHOW        | SHOW                | SHOW      | SHOW            |
| 3 | Audio player                 | COND¹       | COND¹           | COND¹                | COND¹       | SHOW                | SHOW      | HIDE (no audio) |
| 4 | **CategoryHero** (1 phrase)  | SHOW²       | SHOW²           | SHOW²                | SHOW²       | SHOW²               | SHOW²     | SHOW²           |
| 5 | Transcript (cleanedTr/raw)   | COND³       | SHOW            | COND⁴                | SHOW        | SHOW                | SHOW      | HIDE            |
| 6 | callSummary + managerWeakSpot| HIDE        | HIDE            | HIDE                 | HIDE        | SHOW (краткий)      | SHOW      | HIDE            |
| 7 | PsychBlock                   | HIDE        | HIDE            | HIDE                 | HIDE        | HIDE⁵               | SHOW      | HIDE            |
| 8 | ScriptBlock (11 этапов)      | HIDE        | HIDE            | HIDE                 | HIDE        | SHOW (упрощ.)⁶      | SHOW      | HIDE            |
| 9 | PhraseComplianceBlock        | HIDE        | HIDE            | HIDE                 | HIDE        | HIDE⁵               | SHOW      | HIDE            |
| 10| CriticalErrorsBlock          | HIDE        | HIDE            | HIDE                 | HIDE        | HIDE⁷               | SHOW      | HIDE            |
| 11| CriticalDialogMomentsBlock   | HIDE        | HIDE            | HIDE                 | HIDE        | HIDE                | COND⁸     | HIDE            |
| 12| RopInsightBlock              | HIDE⁹       | SHOW (норма НДЗ)| SHOW (норма НДЗ)     | SHOW (тех)  | SHOW (callback)     | SHOW      | HIDE⁹           |
| 13| NextStepBlock                | HIDE        | HIDE¹⁰          | HIDE¹⁰               | HIDE¹⁰      | SHOW                | SHOW      | HIDE            |
| 14| CommitmentsBlock             | HIDE        | COND¹¹          | HIDE                 | HIDE        | SHOW                | SHOW      | HIDE            |
| 15| CategoryBlock (k-v dump)     | SHOW (мин)¹²| SHOW (мин)¹²    | SHOW (мин)¹²         | SHOW (мин)¹²| SHOW                | SHOW      | SHOW (мин)      |
| 16| TagsBlock                    | COND¹³      | COND¹³          | COND¹³               | COND¹³      | COND¹³              | COND¹³    | SHOW (gap-tags) |
| 17| **DiagnosticBlock** (G only) | HIDE        | HIDE            | HIDE                 | HIDE        | HIDE                | HIDE      | SHOW            |

#### Условия

1. **Audio player COND¹** для A/B/C/D — `audioUrl !== null`. Если есть — показать (РОП может послушать 5 секунд тишины и сам убедиться что Whisper прав). Если нет — text fallback («Аудио недоступно»). Сейчас в коде уже так.
2. **CategoryHero SHOW²** — рендерится **всегда**, текст разный per-category. См. §2 ниже.
3. **Transcript A COND³** — `transcript.length > 0` (не больше 100 — у нас уже категория A только если ≤ 100). Показать — может быть 1 строка типа «Алло» или Whisper-галлюцинация — РОП хочет это видеть для верификации. **Не показывать NullBadge «обогащается»** — обогащения не будет.
4. **Transcript C COND⁴** — `transcript.length > 0`. Если есть — показать (Krug: РОП хочет один клик увидеть «было ли что-нибудь сказано»). Если NULL — рендерить «📵 разговора не было».
5. **PsychBlock / PhraseCompliance E HIDE⁵** — за 30-60 секунд психологии и 12 техник нет. Показ → шум.
6. **ScriptBlock E SHOW⁶ (упрощ.)** — рендерим **те же 11 этапов** но с акцентом на первые 3 (приветствие/причина/программирование) + 9 (следующий шаг) + 11 (прощание). Большинство будут `na: true` (легитимные пропуски).
7. **CriticalErrors E HIDE⁷** — за 30-60s МОП не должна была сделать выявление потребностей и т.д. — критика не применима. Сейчас Opus всё равно генерит `criticalErrors: []` — НО блок «✅ Критических ошибок не найдено» создаст ложное впечатление «звонок ок» при коротком переносе. HIDE.
8. **CriticalDialogMoments F COND⁸** — `criticalDialogMoments.length > 0`. В sample-3 / sample-4 этот блок не всегда есть — он опционален.
9. **RopInsight A/G HIDE⁹** — для NO_SPEECH нечего советовать (см. CATEGORIES.md «Не оценивать»). Для PIPELINE_GAP нечего советовать в плане МОПа — этот блок про МОПа, а тут проблема инфры.
10. **NextStepBlock B/C/D HIDE¹⁰** — нет «следующего шага по клиенту». Совет «перезвонить завтра» = норма НДЗ, она в RopInsight идёт.
11. **CommitmentsBlock B COND¹¹** — `extractedCommitments.length > 0` (в voicemail МОП могла сказать «перезвоню в 17:00» — это commitment). Уже так в коде.
12. **CategoryBlock мин-режим¹²** — для A-D и G рендерим только заполненные строки (callOutcome / hadRealConversation). callType / outcome / scriptScore = NULL — скрыть строки. Это `KvRow` уже умеет, но текущий код всегда рендерит все строки с «—». Для not-NORMAL — сжатый формат.
13. **TagsBlock COND¹³** — `enrichedTags.length > 0`. Уже так в коде.

---

## 2. Per-category brief: «ONE useful thing for the user»

Steve Krug Ch.6: пользователь не читает страницу, он сканирует. **Каждая категория должна иметь ОДНО предложение** — что РОПу делать с этим звонком. Hero-message для CategoryHero блока:

| Cat | Hero message (≤ 1 строка для CategoryHero)                                                        | Цвет / иконка             |
|-----|----------------------------------------------------------------------------------------------------|---------------------------|
| A   | «Whisper не нашёл речь — звонок не оценивается. При сомнении послушать запись вручную.»           | gray + 🤐                 |
| B   | «Автоответчик/IVR — НДЗ. Контролируй частоту повторных попыток у этого МОПа.»                      | gray + 🎙                |
| C   | «Клиент сбросил/не ответил. НДЗ. Если повторяется в одно время суток — оптимизируй расписание.»   | amber + ☎️                |
| D   | «🚨 Тех. сбой — алерт тех. отделу. Не оценка МОПа. Если у этого МОПа > 3 за неделю — гарнитура.» | red + 🚨                  |
| E   | «Короткий перенос. Главное: callback назначен на «{deadline}» — проверь выполнение к {deadline+1д}.» | gray-amber + 🕐         |
| F   | «{outcome}. Главный инсайт: {managerWeakSpot или первая фраза ropInsight}.»                       | green/red в зависимости   |
| G   | «🛠 Pipeline gap: {reason — нет audioUrl / нет transcript / нет gcCallId}. Это инфра, не МОП.»  | red + 🛠                  |

**Проектное обоснование:** РОП открывает карточку с одной из 4 целей:
1. «Этот МОП плохо работает — найди мне доказательство» (нужны F NORMAL).
2. «Этот клиент горячий — что обещали?» (нужны F + E commitments).
3. «Почему у этого МОПа дозвон 30%?» (нужны B/C counts + audio).
4. «Почему 200 карточек не enriched?» (нужны G diagnostic).

Карточка должна за **3 секунды** дать ответ на ту цель с которой пришёл РОП. Hero-message — это TLDR.

---

## 3. React conditional pattern recommendation

### Варианты, которые я рассматривал

#### A: Текущий early-return-by-category в TypeSpecificContent
```tsx
if (type === "PIPELINE_GAP") return <GapView />
if (type === "TECHNICAL_ISSUE") return <><TechHero /><TranscriptBlock /></>
// ...
```
**Pros:** простой, легко читать. **Cons:** дублирование (`TranscriptBlock` написан 5 раз), нет единого источника правды, очень легко забыть HIDE для нового поля.

#### B: Inline conditional `{shouldShow && <Block />}` per block
```tsx
{shouldShowSummary(type) && <SummaryBlock call={call} />}
{shouldShowPsych(type) && <PsychBlock call={call} />}
```
**Pros:** один render для всех. **Cons:** 17 helpers, нет групповой структуры, JSX становится свалкой.

#### C: Declarative matrix as data + map
```tsx
const VISIBILITY: Record<CallType, Record<BlockId, "show" | "hide" | "cond">> = { ... }
const BLOCKS: Array<{id, render(call)}> = [ ... ]

return BLOCKS.filter(b => VISIBILITY[type][b.id] !== "hide").map(b => b.render(call))
```
**Pros:** матрица из этого документа = объект в коде 1:1. Легко тестировать (`expect(VISIBILITY.A.psych).toBe("hide")`). **Cons:** «cond» всё равно требует проверок внутри блока. Меньше TypeScript-narrowing.

#### D: Hybrid — Krug «card layout» (this doc's hero) + B per-block conditional
Категория-shell (Header + TypeBadge + Player + CategoryHero) + список блоков отбирается через **per-category whitelist** в одном файле:

```tsx
// /lib/calls/visibility.ts — single source of truth
const SHOW_FOR_CATEGORY: Record<CallType, BlockId[]> = {
  NORMAL:           ["transcript", "summary", "psych", "script", "phraseCompliance",
                     "criticalErrors", "criticalDialogMoments", "ropInsight",
                     "nextStep", "commitments", "category", "tags"],
  SHORT_RESCHEDULE: ["transcript", "summary", "script", "ropInsight",
                     "nextStep", "commitments", "category", "tags"],
  VOICEMAIL_IVR:    ["transcript", "ropInsight", "commitments", "category", "tags"],
  HUNG_UP:          ["transcript", "ropInsight", "category", "tags"],
  TECHNICAL_ISSUE:  ["transcript", "ropInsight", "category", "tags"],
  NO_SPEECH:        ["transcript", "category", "tags"],
  PIPELINE_GAP:     ["diagnostic", "category"],
}

// In CallCard
return (
  <div className="space-y-6">
    <Header call={call} type={type} />
    <Player call={call} />
    <CategoryHero call={call} type={type} />
    {SHOW_FOR_CATEGORY[type].map(blockId => {
      const Block = BLOCK_REGISTRY[blockId]
      return <Block key={blockId} call={call} />
    })}
  </div>
)
```

### Рекомендация Dan Abramov: **Variant D**

> «Колоцируй знание о видимости с компонентом, но извлекай его в декларацию когда видимость становится политикой а не локальной деталью» — этот случай как раз политика (анти-галлюцинация Opus, Q9 контракт).

**Pros для нашего проекта:**
1. **Единый источник правды** — `SHOW_FOR_CATEGORY` совпадает с матрицей §1 столбец-в-столбец. Если правка в каноне CATEGORIES.md — правка в одном месте кода. Krug §«Don't Make Me Think» применяется и к разработчику.
2. **Тестируемо** — unit test «для категории A не должен вызываться PsychBlock» — это `expect(SHOW_FOR_CATEGORY.NO_SPEECH).not.toContain("psych")`.
3. **HIDE = жёстко** — блок не оказывается на странице **даже если в БД есть данные**. Это и есть анти-галлюцинация (см. §4).
4. **`COND` остаётся внутри блока** — когда вопрос «есть данные?» (например `extractedCommitments.length > 0`), это **деталь рендера блока**, а не политика категории. PsychBlock уже делает `if (psych === null && !managerStyle && !clientReaction) return null` — оставляем.
5. **Order matters** — массив сохраняет порядок. Сейчас в TypeSpecificContent порядок hard-coded и слегка отличается между категориями (в SHORT_RESCHEDULE Summary _до_ NextStep, в NORMAL — то же). С whitelist порядок одинаковый, но при необходимости можно сделать `Record<CallType, BlockId[]>` per-category свой.

**Cons / mitigation:**
- TypeScript-narrowing блоков теряется (Block принимает CallDetail, а не CallDetail-narrow-by-category). **Mitigation:** можно сделать `BLOCK_REGISTRY: Record<BlockId, FC<{call: CallDetail}>>` — `CallDetail` остаётся single shape, narrowing внутри блока через guard'ы (`if (!call.callSummary) return null`).
- Если хочется per-category props (например краткий vs полный ScriptBlock для E vs F) — нужно ввести вариант рендера. **Mitigation:** добавить опциональный `mode: "compact" | "full"` в блок, передавать через мини-tuple `[blockId, {mode: "compact"}]` если нужна вариация. Для премьеры — пока один режим, упростим.

---

## 4. Anti-hallucination: HIDE vs NULL (per Q9 Variant B контракт)

**Q9 контекст** (из памяти / handoffs): был выбран Variant B — explicit per-category etalons, чтобы Opus не «додумывал» поля для нерелевантных категорий. То есть для NO_SPEECH **в БД лежит** `psychTriggers: { positive: [], missed: [] }` (явный пустой объект), а не плотный объект с галлюцинированными триггерами.

**Различие HIDE vs NULL:**

| Концепт   | Где живёт                             | Что значит                                                                       |
|-----------|---------------------------------------|-----------------------------------------------------------------------------------|
| **NULL**  | БД (Postgres column) — semantic data  | Поле _легитимно_ отсутствует для этой категории по skill v10 contract. Например для NO_SPEECH `scriptScore=NULL`, `psychTriggers={positive:[], missed:[]}`. |
| **HIDE**  | UI (`SHOW_FOR_CATEGORY[type]`) — ren  | Блок _не рендерится_ для категории, даже если в БД случайно лежат данные.        |

**Зачем оба слоя — defense in depth:**

1. **NULL слой защищает от Opus-галлюцинации** при enrichment. Skill v10 enforces «для category=A заполни scriptScore=null, psychTriggers=пустые объекты». Это контролируется validator (см. memory `feedback-skill-v10-design.md` — validator runtime обязателен).

2. **HIDE слой защищает от** _**промахов validator'а**_. Если в каком-то edge-case Opus всё-таки родил `scriptScore=8` для NO_SPEECH (потому что transcript «Алло, продолжение следует...» зацепил какой-то промпт-trigger) — UI всё равно **не покажет** scriptBlock. Это второй кордон.

3. **Combined effect:**
   - NULL `+` HIDE = **invisible** (правильно, ничего не показано) ✅
   - NULL `+` SHOW (например NORMAL `phraseCompliance=NULL`) = **NullBadge «обогащается»** (правильно, ждём enrichment) ✅
   - **DATA `+` HIDE** = **WARN** (см. §5 ниже) — это анти-галлюцинационный сигнал
   - DATA `+` SHOW = **render блока** (нормальный путь) ✅

**Иными словами:** контракт Q9 определяет _что enrichment должен записать в БД_. Матрица §1 определяет _что UI согласен показать_. Эти два контракта **избыточны намеренно**: каждый ловит ошибки другого.

---

## 5. Edge case: HIDE-блок получил unexpected данные

**Сценарий:** для категории C (HUNG_UP) в БД случайно появился `psychTriggers: { positive: [{time: "00:05", приём: "приветствие"}] }`. Это галлюцинация Opus или мисс-classification звонка.

### Варианты обработки

#### Вариант 1: Silent skip
- HIDE = HIDE, не рендерим, ничего не логируем.
- **Pros:** простота, чистый UI. **Cons:** проблема невидима — Opus генерирует мусор и никто не узнаёт.

#### Вариант 2: Show with warning badge
- Рендерим блок с alert «⚠️ Этот блок не должен присутствовать для категории C — возможна галлюцинация. Проверь enrichment.»
- **Pros:** тех-долг видим, можно зайти в карточку и подсветить. **Cons:** для РОПа это шум, не его уровень. Для премьеры reviewer'а в такой карточке будет «warn» — плохое впечатление.

#### Вариант 3: Hybrid — log + dev-only render
- В **prod**: silent skip + инкремент counter в БД (`enrichmentAnomalies` table или новое поле в CallRecord типа `unexpectedFields: jsonb`). Раз в день / неделю — отчёт «Opus породил X unexpected blocks для category Y».
- В **dev** (NODE_ENV=development): **WARN-badge** прямо в карточке + `console.warn` с pbxUuid + список unexpected fields.
- **Pros:** РОП не видит шум, инженер видит проблему, статистика собирается. **Cons:** нужна инфра логирования (но мы её всё равно строим — Sentry уже подключён).

### Рекомендация Steve Krug: **Вариант 3**

**Reasoning:** Krug Ch.5 — «You don't need to make every option discoverable, you need to make the important options easy». РОП хочет видеть звонок, не enrichment-debugging. Но _инженер_ хочет видеть отклонения от контракта. Разделим аудитории.

**Concrete implementation:**
```tsx
// /lib/calls/visibility.ts
export function checkUnexpectedFields(call: CallDetail, type: CallType): string[] {
  const visible = new Set(SHOW_FOR_CATEGORY[type])
  const unexpected: string[] = []

  // Each block declares whether it has data
  if (!visible.has("psych") && (call.psychTriggers || call.managerStyle))
    unexpected.push("psychTriggers")
  if (!visible.has("script") && (call.scriptScore !== null || call.scriptDetails))
    unexpected.push("scriptDetails")
  // ... etc

  return unexpected
}

// In CallCard
const unexpected = checkUnexpectedFields(call, type)
if (unexpected.length > 0) {
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[anomaly] pbxUuid=${call.pbxUuid} category=${type} unexpected=${unexpected.join(",")}`)
  }
  // optionally: server action to log to DB / Sentry
}
```

**Бонус:** если PIPELINE_GAP-карточка вдруг получила `cleanedTranscript` — это сигнал «cron догнал, можно reclassify» — UI может показать кнопку «🔄 Reclassify».

---

## 6. Конкретные изменения в код для реализации

### 6.1 Новые файлы
1. **`src/lib/calls/visibility.ts`** — `SHOW_FOR_CATEGORY`, `BLOCK_REGISTRY`, `CategoryHero` config (per-cat hero text), `checkUnexpectedFields`.
2. **`src/lib/calls/visibility.test.ts`** — unit-tests матрицы.
3. **`src/app/(dashboard)/_components/gc/category-hero.tsx`** — новый блок (Hero с per-category message).
4. **`src/app/(dashboard)/_components/gc/diagnostic-block.tsx`** — для G PIPELINE_GAP (что сломано в pipeline).

### 6.2 Рефактор `call-card.tsx`
- Удалить `TypeSpecificContent` функцию (lines 341-478). Заменить на:
  ```tsx
  return (
    <div className="space-y-6">
      <Header call={call} type={type} />
      <Player call={call} />
      <CategoryHero call={call} type={type} />
      {SHOW_FOR_CATEGORY[type].map(id => {
        const Block = BLOCK_REGISTRY[id]
        return <Block key={id} call={call} />
      })}
    </div>
  )
  ```
- `BLOCK_REGISTRY` импортирует существующие `TranscriptBlock`, `SummaryBlock`, ... — **код блоков не меняется**, меняется только организация.

### 6.3 Анти-галлюцинация
- В `<CallCard>` после classify вызывать `checkUnexpectedFields`, в dev mode рендерить узкий `<UnexpectedFieldsBanner fields={unexpected} />` _над_ Header.

### 6.4 Server-side guard
Для NORMAL (F) убедиться что `enrichmentStatus !== "needs_rerun_v9"`. Если так — `CategoryHero` показывает «карточка ожидает повторного обогащения» вместо «{outcome}. Главный инсайт...».

---

## 7. Risks / что учесть при имплементации

1. **TypeScript narrow-types через CallDetail могут сломаться** при `BLOCK_REGISTRY: Record<BlockId, FC<{call: CallDetail}>>`. **Mitigation:** все блоки уже принимают `{call: CallDetail}` — типы стабильны.

2. **Регрессия рендера** — текущие категории (A-G) рендерят hero-card как «CardHeader + CardDescription». Новый CategoryHero должен **визуально** сохранить то же (для премьеры reviewer не должен заметить разницу в ABCD-карточках). Тест: открыть три tester-pbxUuids per category до/после рефактора, screenshot diff.

3. **Order of blocks** в SHORT_RESCHEDULE — текущий порядок Transcript → Summary → NextStep → Commitments. В NORMAL — Transcript → Summary → Psych → Script → ... Я предлагаю **выровнять SHORT_RESCHEDULE под NORMAL ordering** (Transcript → Summary → Script → ropInsight → NextStep → Commitments → Category → Tags) — тогда РОП-привычка работает на обе категории. Это **минимальное** UX-изменение, верифицировать с тобой.

4. **Категория D (TECHNICAL) сейчас показывает Transcript** (строки 357-372 текущего файла). В матрице у меня тоже SHOW. Согласовано.

5. **B VOICEMAIL_IVR — текущий код показывает CommitmentsBlock только если `commitments.length > 0`**. У меня в матрице тоже COND¹¹. Согласовано — оставляем как есть.

6. **G PIPELINE_GAP — в текущем коде нет `DiagnosticBlock`**, есть только CardDescription с фразой «Pipeline gap — аудио не получено из onPBX». Я предлагаю **новый блок Diagnostic** с явной таблицей:
   ```
   audioUrl:    NULL  (cron Stage 3.5b не прошёл)
   transcript:  NULL  (Whisper не запускался)
   gcCallId:    NULL  (PBX↔GC match failed)
   reason:      "audioUrl missing — onPBX retry pending"
   retryHint:   "Cron retry через 24ч (или manual /retry-whisper)"
   ```
   Это **прямой UX-выигрыш** — РОП видит что чинить, инженер видит куда смотреть.

7. **Skill v10 валидатор** должен enforce категорийные contracts (Q9 etalons). Если skill-v10 отстаёт — UI начнёт показывать `WARN` для всех not-NORMAL. Это **ок** (defence in depth), но в early days после v10 release следить за counter-rate в Sentry.

---

## 8. Связь с другими Q-вопросами премьеры

- **Q2** (визуальная иерархия / типографика): CategoryHero вводит первоклассный hero-paragraph — это место где Q2 будет применять color/size/font.
- **Q3** (compact vs detailed view): hint «mode: compact» в визибилити-tuple — расширение которое можно ввести позже без ломки матрицы.
- **Q9** (анти-галлюцинация): прямая связь — §4 этого документа.
- **Q12** (роли РОП vs инженер): §5 hybrid-warn разделяет аудитории — РОП видит чистоту, инженер видит anomalies.

---

## 9. TL;DR for the implementation PR

1. Создать `src/lib/calls/visibility.ts` с матрицей §1 как `SHOW_FOR_CATEGORY` Record.
2. Создать новые блоки `CategoryHero` и `DiagnosticBlock`.
3. Заменить `TypeSpecificContent` в `call-card.tsx` на `BLOCK_REGISTRY.map`.
4. Добавить `checkUnexpectedFields` + dev-mode banner.
5. Unit-тесты на матрицу (~20 строк).
6. Screenshot-diff на 7 канонических pbxUuids (один на каждую категорию).
7. Не трогать сами блоки (TranscriptBlock, PsychBlock и др.) — порефакторим позже.

**Estimated effort:** 4-6 часов (один UI-сеанс), включая screenshot-diffs.

**Reviewer demo value:** карточка работает одинаково для F (главный кейс), но PIPELINE_GAP и TECHNICAL имеют **диагностическую страницу** вместо «короткой одной строки» — это _видимая ценность_ для reviewer'а, который оценивает «вы умеете обрабатывать edge-cases».
