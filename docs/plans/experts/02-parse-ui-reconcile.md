# Q2: Parse ↔ UI Reconcile — Gap Analysis

**Author:** Martin Fowler (refactoring + data flow), 2026-05-03
**Scope:** premiere 2026-05-04 (diva, GC-only).
**Sources verified by Read:**
- `prisma/schema.prisma` (lines 383-481 — CallRecord)
- `src/lib/queries/{dashboard-gc, call-detail-gc, managers-gc, client-detail-gc}.ts`
- `src/app/(dashboard)/_components/gc/{dashboard-rop, call-card, manager-detail, client-card}.tsx`
- `docs/canons/canon-master-enrich-card.md`, `ui-enrichment-contract.md`, `ui-inventory-2026-05-03.md`
- `docs/demo/2026-04-22-diva-anketa-answers.md`

---

## Project Context (verified)

**Schema-of-truth** = `CallRecord` (~70 columns). Master Enrich populates 6 blocks; UI reads via 4 query files; renders in 4 GC components.

**Render priorities:**
- Premiere requires CallCard (NORMAL) and DashboardRop (8 blocks) to be «inspector-readable» — РОП должен видеть либо данные, либо честный «обогащается» badge, не молчаливый «—».
- 7-type render switch (`classifyCallType`) means many fields are rendered conditionally by type — gap analysis must be type-aware.

**Existing patterns:**
- `NullBadge` component (`call-card.tsx:482-488`) — "⏳ X обогащается" — единственный явный helper для NULL.
- Локальные `?? "—"` разбросаны: ScriptBlock comments, Header MetaRow, KvRow CategoryBlock, client-card stage, dashboard fmtSeconds, manager-detail counters.
- Conditional hide через `if (!x) return null` в `SummaryBlock`, `RopInsightBlock`, `NextStepBlock`, `CommitmentsBlock`, `TagsBlock`, `CriticalDialogMomentsBlock` — но НЕ единообразно.

---

## Expert Analysis

> "Analyzing as Martin Fowler because reconcile gap = data-flow refactoring problem: пайплайн пишет Х, UI рендерит Y; разрыв = duplicate logic / dead field / silent NULL — все три симптомы в книге Refactoring."
>
> **Principles from 3 experts:**
> 1. Martin Fowler (main): "Extract till you drop — три места рендерят `?? '—'` → один helper. Dead code (unused DB columns) — refactor by removing or wiring."
> 2. Dan Abramov: "Colocate render rules with data shape — если поле всегда NULL для типа звонка X, conditional render должен быть в `TypeSpecificContent`, не в каждом блоке."
> 3. Theo Browne: "Type-safe contracts: schema fields without UI consumers = silent dead code. Either use them or delete them — middle ground breeds rot."

---

## Gap A — Stored in DB, NOT shown in UI (waste / dead code)

| # | Field | Location (schema.prisma) | Where it could be used | Priority | Proposed action |
|---|---|---|---|---|---|
| A1 | `cleanupNotes` (Json?) | line 442 | call-card → already passed but only rendered inside `<details>` (call-card.tsx:521-528) — это **есть**, но уже есть. *(Re-verified — НЕ gap, отбрасываем)* | — | Already wired |
| A2 | `enrichedAt` (DateTime?) | line 426 | Call-card header: badge «обогащено N мин назад» → даёт РОПу confidence что разбор актуален. Также footer dashboard. | **P1** | Add MetaRow to CallCard.Header + footer agg «MAX(enrichedAt)» в DashboardRop FooterStatus рядом с lastSync |
| A3 | `enrichedBy` (String?) | line 427 | Тут хранится pipeline version (e.g. v9.4). Никогда не показано → невозможно отличить старую версию. | **P2** | Footer DashboardRop badge «pipeline v9.4 (87% calls)» |
| A4 | `enrichmentLockedAt`/`LockedBy` | lines 460-462 | Selected в call-detail-gc.ts:58, 145 но **не рендерится**. Полезно если cron в процессе — UI мог бы показать «обогащение в процессе с N сек». | **P2** | Conditional badge в Header если `enrichmentLockedAt` < 5min ago |
| A5 | `gcCallCardUrl` (String?) | line 449 | Сейчас UI строит deeplink сам (`call-card.tsx:158-169`). Если cron уже хранит готовый URL → дубликация / возможен desync. | **P2** | Удалить колонку ИЛИ переключить UI на её использование (single source of truth, Fowler `Replace Magic Literal`). |
| A6 | `gcDeepLinkType` (String?) | line 450 | Никем не читается. Похоже на legacy. | **P2** | Verify via `git log -S` → если dead, drop column. |
| A7 | `gcOutcomeLabel` / `gcEndCause` | lines 472-473 | Ни в одной query/component не используется. Но на анкете diva (раздел 9) — РОП хочет «АО / НДЗ / реальный разговор» — мы используем `callOutcome`, а labels из GC (gcOutcomeLabel) могли бы стать independent ground truth для проверки enrichment. | **P2** | Display in CallCard CategoryBlock как cross-check столбец «GC label vs наш callOutcome». |
| A8 | `hangupCause`, `gateway`, `managerExt` (PBX meta) | lines 412-415 | НЕ показано в UI. Полезно для тех. диагностики (TECHNICAL_ISSUE / PIPELINE_GAP type). | **P2** | Добавить в CallCard как `<details>` collapsible "Tech meta" в типах TECHNICAL_ISSUE/PIPELINE_GAP. |
| A9 | `qualityScore` (Int?) | line 416 | Legacy от старого pipeline — не используется. | **P2** | Drop column or document as legacy. |
| A10 | `pbxMeta` (Json?) | line 417 | Sometimes contains raw onPBX payload (debug). Не нужно в UI продакшна. | — | Don't fix (intentional). |
| A11 | `sentiment` (String?) | line 418 | Legacy. Никем не читается. | **P2** | Drop column. |
| A12 | `objections` (Json?) | line 419 | Legacy. Заменён на `criticalErrors[no_objection_handling]` + `psychTriggers.missed`. | **P2** | Drop column. |
| A13 | `hotLead`, `hotLeadReason` | lines 420-421 | Legacy. Заменены на `purchaseProbability` + `outcome`. Не показано. | **P2** | Drop columns. |
| A14 | `commitmentsCount` (Int?) | line 454 | Используется в WHERE clause `getUnfulfilledCommitments` — НЕ в render. UI показывает `commitments.length` (computed). Возможный desync если count !== length. | **P2** | Либо отображать в badge, либо удалить — single source of truth. |
| A15 | `criticalDialogMoments[].time_range` | per Master Enrich | UI рендерит `.time_range || .time` (call-card.tsx:968) — обе version. Контракт говорит обе. ✅ Wired. | — | OK |
| A16 | `clientEmotionPeaks` | line 439 | Рендерится только внутри PsychBlock (call-card.tsx:674-695) — но `peaks.length > 0` гейт. Часто отсутствует — но это OK. | — | OK |
| A17 | `keyClientPhrases` | line 440 | Рендерится PsychBlock (call-card.tsx:661-672). ✅ | — | OK |
| A18 | `purchaseProbability` (Int?) | line 448 | Header CallCard (`call-card.tsx:209-214`). ✅ | — | OK |
| A19 | `enrichmentStatus` (String?) | line 425 | Selected (call-detail-gc.ts:57, 145) **но не отрендерен** в CallCard. UI не показывает «in_progress / needs_rerun_v9 / pipeline_gap». | **P1** | Header CallCard — badge со статусом, цветной (green/amber/red). |
| A20 | `Tenant.dealsUsed`/`dealsLimit` | schema.prisma:18-19 | Не относится к call enrichment, но ниже в footer / settings — pricing display. | — | Out of scope для Q2. |
| A21 | `isFirstLine` (Boolean?) | line 433 | Рендерится в `KvRow` CategoryBlock (call-card.tsx:1115-1118) **но без фильтра** — для всех типов звонков, и значение `null` показывается как `"—"`. **НЕ используется** для скрипта первой линии (Жихарев+Чернышова). Анкета (раздел 2) говорит у первой линии — другой скрипт. | **P1** | Сейчас value=`true` ничего не меняет в render. Должен флажком влиять на ScriptBlock (другой набор stages для первой линии) ИЛИ скрывать ScriptBlock с пометкой «первая линия — другой скрипт, не оценивается». |

---

## Gap B — Shown in UI as «—» / silent NULL (clutter)

| # | Block / file:line | Field rendered as `—` | Priority | Proposed action |
|---|---|---|---|---|
| B1 | `dashboard-rop.tsx:202` "Минут разговора" | `r.talkMinutes ?? "—"` — корректно для NULL, но если `talkMinutes === 0` тоже "—" из-за ranger fmtSeconds | **P2** | Сейчас `r.talkMinutes ? ... : "—"` — `0` отображается как "—" что вводит в заблуждение (есть звонок но нет разговора). Распарсить «0 мин» отдельно от «—». |
| B2 | `dashboard-rop.tsx:332` (Block 3 worst calls) | `c.managerName ?? "—"` AND `c.clientName ?? "—"` — если оба null, рендерится "— → —". | **P1** | Условный hide: если managerName null → fallback на phone tail (как в call-card Header). Если clientName null → `"тел. ***NNNN"`. |
| B3 | `call-card.tsx:178` Header subtitle | `call.managerName ?? "—"` → если NULL, показывает "— → клиент". | **P1** | Use phoneTail fallback или skip всю строку. |
| B4 | `call-card.tsx:606,617,640,652` PsychBlock | Любая позитив/missed строка с пустым полем рендерит `"—"` в ячейке. Если объект кривой ({time только}) — три "—" в строке. | **P2** | Hide cell ячейку если все три (`time/трюк/effect`) пустые. Filter array до .map. |
| B5 | `call-card.tsx:783,808` ScriptBlock comments | `v.comment ?? "—"` — для каждой stage row если comment пуст. У 11 stages → 11 строк `"—"` если Master Enrich не написал comments. | **P2** | Если все 11 comments пустые → скрыть колонку Comment (`<TableHead>` conditional). Если только некоторые — оставить "—" (uneven data). |
| B6 | `call-card.tsx:884` PhraseComplianceBlock missing | `v` undefined для тех 12 техник где Master Enrich не покрыл — рендерится `"—" / "не оценено"`. | **P2** | Уже корректно (показ «не оценено» лучше чем "—"). Менять не надо. |
| B7 | `call-card.tsx:900` PhraseComplianceBlock evidence | `v.evidence ?? v.note ?? "—"` — если used:true но нет evidence (некомплект enrichment), один dash. | **P2** | Заменить на `'(нет цитаты)'` italic — честнее чем "—". |
| B8 | `call-card.tsx:1142` CategoryBlock KvRow | `value ?? "—"` для **всех** 8 полей. Если 5 из 8 NULL → пять "—" подряд. (Q1 conditional matrix скажет: для VOICEMAIL_IVR `outcome/isCurator/possibleDuplicate` ВСЕГДА NULL). | **P1** | Заменить на `<KvRow>` с conditional skip: если `value === null` → не рендерить TableRow вообще. Сразу убирает 5 пустых строк для типов B-G. |
| B9 | `manager-detail.tsx:264` "Топ-3 critical errors" | `pct(e.pct)` returns "—" if `null` → но check уже idmone сверху. ✅ | — | OK |
| B10 | `client-card.tsx:218,231,245` table cells | `c.talkDuration ?? c.userTalkTime` → fmtSeconds → "—". `c.scriptScorePct ?? "—"`. `c.dealCrmId ?? "—"`. — все три приемлемы для табличного формата (выравнивание колонок). | — | Don't fix — table column alignment justifies "—". |
| B11 | `call-card.tsx:606,640` PsychBlock time cell | `p.time ?? "—"` — Master Enrich НЕ всегда указывает time. | **P2** | Replace with empty cell (no dash). |
| B12 | `client-card.tsx:194-195` stageLabel | `c.stageName ?? (c.currentStageCrmId ? \`Этап #\${...}\` : "—")` — если оба NULL → "—". У 99% звонков dealId NULL (broken Stage 3.5 attribution per ui-enrichment-contract.md). → весь столбец "—". | **P1** | Hide entire "Этап сделки" column когда у ВСЕХ строк stageName/currentStageCrmId NULL. (Currently рендерится колонка из 30 "—".) |
| B13 | `call-card.tsx:218-223` Header «Этап сделки» | conditional: показ с fallback `Этап #N`. ✅ | — | OK |
| B14 | `dashboard-rop.tsx:733-735` FooterStatus pipeline_gap | `pct > 0` показ ⚠ — но если 0 показывается "0/N" (без ⚠). Acceptable. | — | OK |

---

## Gap C — Required by anketa diva, NOT parsed/stored OR not rendered

Cross-ref `docs/demo/2026-04-22-diva-anketa-answers.md`:

| # | Anketa requirement | Section | Status | UI location (or absence) | Priority | Action |
|---|---|---|---|---|---|---|
| C1 | «Один клиент = разные email/телефоны» (дубли по 8.1) | §8 | `possibleDuplicate` boolean exists in schema (line 434) AND parsed AND **rendered ONLY в CategoryBlock KvRow `null` → "—"**. Не показывается как **визуальный badge** в Header. Анкета (§8.4): «Можно тестить детект дублей, но не сливать автоматически». | call-card.tsx:1119-1122 KvRow | **P1** | Header CallCard badge if `possibleDuplicate === true` — красная плашка «🔀 возможный дубликат». |
| C2 | «Кандидаты на слияние» в UI | §8 | `possibleDuplicate=true` filter exists в DB but **НЕТ страницы** «Дубли» / нет блока на главной. | — | **P2** (post-premiere) | Settings tab «Кандидаты на слияние» — list `WHERE possibleDuplicate=true`. |
| C3 | «Первая линия — отдельный отдел с другим скриптом» (Жихарев+Чернышова) | §2 | `isFirstLine` boolean parsed AND stored (line 433). UI: рендерит value в KvRow без эффекта на скрипт-block (см. A21). | call-card.tsx CategoryBlock | **P1** | Conditional ScriptBlock skip + бейдж «Первая линия» в Header → если `isFirstLine=true`, ScriptBlock рендерит «Скрипт первой линии запрошен у клиента, не оценивается». |
| C4 | «Не контролировать кураторов» (9 фамилий) | §2 | `isCurator` парсится и **используется в `getCuratorManagerIds()`** (dashboard-gc.ts:32-50) для исключения из `/managers`. ✅ В call-card KvRow тоже видно. | OK | — | OK |
| C5 | «Сколько наборов / НДЗ / АО / реальных разговоров / минут / оценок МОПа» — РОП дашборд | §9 | All 6 counters live в DashboardRop Block 1 (`dashboard-rop.tsx:142-225`) и ManagerDetail Counters (`manager-detail.tsx:72-136`). ✅ | OK | — | OK |
| C6 | «Скрипт первой линии — запросить у клиента» | §6 | Не получен. UI не должен оценивать первую линию по основному скрипту — но сейчас оценивает (см. A21/C3). | — | **P1** (см. C3) | См. C3. |
| C7 | «Чек-лист оценки» — клиент готов сделать, не получено | §6 | Используем 11 stage scriptDetails как фактический чек-лист. ✅ Но клиент не утвердил → может потребовать переработки post-premiere. | OK | — | OK (premiere) |
| C8 | «Что считать продажей: любой платный заказ» | §4 | `outcome` поле enum + `Deal.amount > 0 AND Deal.status='WON'` — фильтр Block 7. | OK | — | OK |
| C9 | «Категории звонков по разговору МОПа (не метаданным)» — 7 категорий | §5 | `callType` enum в CallRecord + Master Enrich. ✅ Рендерится в Header MetaRow и manager-detail distribution. | OK | — | OK |
| C10 | «Алерты НЕ нужны» | §9 | UI алертов не делает. ✅ | OK | — | OK |
| C11 | «Раздел Кандидаты на слияние с ручным approve» | §8.4 | Нет UI. См. C2. | — | **P2** | См. C2. |
| C12 | «Стерео-разделение с 10 апреля» | §1.3 | Stored как факт inflow в pipeline. UI не показывает. Но это «как обработано аудио», не нужно РОПу. | — | Don't fix | Out of scope. |
| C13 | «Сильный звонок» — характеристики не уточнены | §6.3 | Не блокер. Используем `scriptScorePct >= 0.7` как «сильный». | OK | — | OK |
| C14 | «Дубли и тесты исключить из метрик» (§3.4) | §3 | `possibleDuplicate` есть, но aggregates dashboard-gc.ts его НЕ exclude в Block 1/2 (counts вообще не фильтрует возможные дубли). | — | **P2** | Add `WHERE possibleDuplicate IS NOT TRUE` в aggregate queries — но это требует валидации с клиентом (анкета говорит «не сливать автоматически»). |

---

## Top-5 P1 Fixes (concrete file edits)

### Fix #1 — `possibleDuplicate` badge в Header (Gap C1)

**File:** `src/app/(dashboard)/_components/gc/call-card.tsx:171-184`

Insert before/after `TypeBadge` в шапке:

```tsx
{call.possibleDuplicate === true && (
  <span className="inline-block rounded bg-status-amber-dim px-2 py-0.5 text-[11px] text-status-amber">
    🔀 возможный дубликат
  </span>
)}
```

Also ensure removed/marked from CategoryBlock to avoid дубликации.

### Fix #2 — Hide NULL rows in CategoryBlock KvRow (Gap B8)

**File:** `src/app/(dashboard)/_components/gc/call-card.tsx:1138-1145`

```tsx
function KvRow({ label, value }: { label: string; value: string | null }) {
  if (value === null) return null  // <-- new: skip NULL rows entirely
  return (
    <TableRow>
      <TableCell className="w-1/3 text-text-tertiary">{label}</TableCell>
      <TableCell className="font-medium">{value}</TableCell>
    </TableRow>
  )
}
```

Эффект: для VOICEMAIL_IVR/HUNG_UP типов где `outcome/possibleDuplicate/scriptScore` всегда NULL — три строки исчезают.

### Fix #3 — `enrichmentStatus` badge в Header (Gap A19)

**File:** `src/app/(dashboard)/_components/gc/call-card.tsx:181-184`

В шапке рядом с `<TypeBadge>`:

```tsx
{call.enrichmentStatus === "needs_rerun_v9" && (
  <span className="rounded bg-status-amber-dim px-2 py-0.5 text-[11px] text-status-amber">
    ⏳ нужен rerun v9
  </span>
)}
{call.enrichmentStatus === "in_progress" && (
  <span className="rounded bg-surface-3 px-2 py-0.5 text-[11px] text-text-tertiary">
    обогащается…
  </span>
)}
```

### Fix #4 — Hide "Этап сделки" column когда все NULL (Gap B12)

**File:** `src/app/(dashboard)/_components/gc/client-card.tsx:177-253`

Pre-compute перед рендером таблицы:

```tsx
const anyStageVisible = detail.calls.some(c => c.stageName || c.currentStageCrmId)
```

Conditional render `<TableHead>Этап сделки</TableHead>` и `<TableCell>{stageLabel}</TableCell>` только если `anyStageVisible`. Сейчас 99% звонков — `dealId=NULL` (Stage 3.5 broken per `ui-enrichment-contract.md:139`) → колонка из 30 «—» исчезнет.

### Fix #5 — `isFirstLine` conditional ScriptBlock (Gap A21/C3/C6)

**File:** `src/app/(dashboard)/_components/gc/call-card.tsx:701-821`

В начале `ScriptBlock`:

```tsx
function ScriptBlock({ call }: { call: CallDetail }) {
  if (call.isFirstLine === true) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>📊 Скрипт первой линии</CardTitle>
          <CardDescription>
            Этот МОП работает по скрипту первой линии (Жихарев / Чернышова — анкета §2). Чек-лист первой линии запрошен у клиента и пока не получен — стандартный 11-этапный скрипт МОПа НЕ применяется.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }
  // … existing render
```

Также Header MetaRow добавить `🥇 Первая линия` если `isFirstLine`.

---

## Don't-fix list (intentional, document why)

| Field | Reason not shown |
|---|---|
| `pbxMeta` (raw PBX payload) | Debug-level, не для РОПа. |
| `qualityScore` (legacy) | Заменён `scriptScorePct`. Schema rot — drop after premiere (P2). |
| `sentiment`, `hotLead`, `hotLeadReason`, `objections` | Legacy old-pipeline fields. Заменены `clientReaction`, `purchaseProbability`, `criticalErrors`. |
| `cleanedTranscript` (если NULL) | Корректно: fallback chain `cleanedTranscript → transcriptRepaired → transcript` уже есть в `TranscriptBlock`. |
| `Tenant.dealsUsed/Limit` | Pricing — out of scope premiere. |
| `pbxMeta`, raw audio metadata | Технический контекст не нужен РОПу. |
| `gcCookie` / `gcPassword` | Security — никогда не в UI. |
| `clientPhone` (полный) | PII — рендер только last 4 (`***NNNN`). |
| `clientEmotionPeaks` empty array | Master Enrich иногда не находит peaks — отсутствие НЕ ошибка. |
| `gateway`, `hangupCause` | Полезно tech support, не РОПу. Можно показать в `<details>` collapsible (P2). |
| `Stage 7.5b backfill talkDuration` для legacy NULL | UI fallback на `userTalkTime` уже есть, label `(fallback userTalkTime)` показан. |

---

## Refactor pattern recommendation

**Recommendation:** Two-tier helper system, не один универсальный «Empty» component.

### Tier 1 — `<Field>` component (Fowler: «Replace Magic Literal»)

Replace inline `{value ?? "—"}` patterns с явным компонентом который имеет три mode:

```tsx
// src/app/(dashboard)/_components/gc/_helpers/field.tsx
export function Field({
  value,
  fallback = "skip",  // "skip" | "dash" | "loading" | string
  pending,
}: {
  value: string | number | null | undefined
  fallback?: "skip" | "dash" | "loading" | string
  pending?: boolean  // master enrich in flight
}) {
  if (value === null || value === undefined) {
    if (fallback === "skip") return null
    if (fallback === "dash") return <span className="text-text-muted">—</span>
    if (fallback === "loading") return <NullBadge what="" />
    return <span className="text-text-tertiary italic">{fallback}</span>
  }
  return <>{value}</>
}
```

**Когда использовать какой fallback:**
- `skip` — для опциональных KvRow (CategoryBlock), `criticalDialogMoments` time, ScriptBlock comment column when ALL empty.
- `dash` — для **табличных** колонок с выравниванием (worstCalls table, client-card stageLabel, daily activity «Минут»).
- `loading` — для полей где Master Enrich В ПРОЦЕССЕ заполнения (NORMAL type, < 24h after sync).
- `string` — кастомное «(нет цитаты)», «не оценено», «первая линия — не оценивается».

### Tier 2 — `<TypeGate>` component (Dan Abramov: colocate)

Conditional render целых блоков по `CallType`, заменив 7 вложенных `if`'ов в `TypeSpecificContent`:

```tsx
// src/app/(dashboard)/_components/gc/_helpers/type-gate.tsx
export function TypeGate({
  showFor,
  type,
  children,
}: {
  showFor: CallType[]
  type: CallType
  children: ReactNode
}) {
  if (!showFor.includes(type)) return null
  return <>{children}</>
}

// usage:
<TypeGate showFor={["NORMAL"]} type={type}>
  <PsychBlock call={call} />
  <ScriptBlock call={call} />
  …
</TypeGate>
```

**Why two tiers, not one:**
- `Field` отвечает за **внутри блока** (cell, label).
- `TypeGate` — за **уровень блока** (cards).
- Один универсальный `<Empty>` сложил бы оба контекста — нарушает Single Responsibility.

**Не делать:** не вводить runtime mapping table «по типу — какие поля показывать». Это усложнит чтение. Явные `<TypeGate showFor={[…]}>` грамотнее.

---

## Risks during implementation

1. **Hide NULL rows risk (Fix #2):** РОП при demo может спросить «а где outcome?» — добавить subtle гид-line в CardDescription: «Поля, неприменимые к типу звонка, скрыты.»
2. **`possibleDuplicate` badge (Fix #1):** parser sometimes false-positives (см. memory: open issue #5 reconcile false-positive). Перед premiere проверить % positives — если > 5%, отложить badge на post-premiere.
3. **`isFirstLine` block hide (Fix #5):** clientele Жихарев+Чернышова — у нас НЕТ их manager IDs verified, parser определяет по транскрипту/имени. Если false-positive `isFirstLine=true` для обычного МОПа — РОП не увидит scriptScore. **Mitigation:** показать manager.name в alert message, чтобы РОП мог сразу заметить ошибку и сообщить.
4. **Legacy column drops (A6/A9/A11/A12/A13):** требуют migration — оставить на post-premiere (P2). Сейчас просто `// @deprecated` комментарии.
5. **Refactor scope creep:** Tier 1+2 helpers — большой рефактор. **Не делать перед premiere 4.05.** Только Top-5 P1 fixes (точечные edits) → premiere стабильна. Helpers — после, отдельным PR.

---

## Summary table

| Gap class | Total | P1 (premiere blocker) | P2 (backlog) |
|---|---|---|---|
| A (DB→no UI) | 21 | 2 (A19 enrichmentStatus, A21 isFirstLine) | 12 |
| B (UI→silent —) | 14 | 4 (B2, B3, B8, B12) | 6 |
| C (anketa→missing) | 14 | 3 (C1, C3, C6) | 4 |
| **Total** | 49 | **9 P1** | **22 P2** |

Top-5 P1 fixes (выше) покрывают 6 из 9 P1 (B2/B3 решены через Fix #2 единым KvRow-skip + phoneTail fallback в Header — B3 одним патчем; B12 — Fix #4).

Не покрыты Top-5: B2 (managerName "—" в worstCalls list — оставить на post-premiere если % low), C14 (exclude possibleDuplicate из агрегатов — risky, требует client confirmation).
