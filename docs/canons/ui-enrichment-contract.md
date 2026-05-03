# UI ↔ Enrichment Data Contract (2026-05-03)

**Цель:** зафиксировать форму данных которые UI ожидает от cron + Master Enrich. Каждое отклонение от контракта — баг enrichment, не UI.

---

## CallRecord — какие поля используются UI

### Identification + metadata (sync-pipeline)

| Поле | Тип | Notes |
|---|---|---|
| `id` | TEXT (cuid) | primary key |
| `tenantId` | TEXT | FK to Tenant |
| `managerId` | TEXT? | FK to Manager (для curator filter) |
| `dealId` | TEXT? | FK to Deal (для stageName resolve) |
| `pbxUuid` | TEXT? | URL parameter `/calls/[pbxUuid]`, primary match-key |
| `clientName` | TEXT? | может быть NULL — UI fallback на `***NNNN` |
| `clientPhone` | TEXT? | last 4 digits показываются (без личных данных) |
| `gcContactId` | TEXT? | URL parameter `/clients/[gcContactId]`, deep-link to GC |
| `gcCallId` | TEXT? | deep-link to GC карточка звонка |
| `direction`, `category`, `audioUrl` | enum / TEXT? | `<audio src={audioUrl}>` прямой URL |

### Тайминги — ВАЖНОЕ правило

| Поле | Что это | Где используется UI |
|---|---|---|
| `duration` | INT (sec) — длительность ЗАПИСИ (с гудками + IVR) | Шапка карточки звонка только |
| `talkDuration` | INT (sec) — живой разговор из GC «Продолжительность разговора» | **ВЕЗДЕ где «Минут разговора»**, fallback `userTalkTime` если NULL |
| `userTalkTime` | INT (sec) — fallback для talkDuration (старые карточки до Stage 7.5b) | fallback only, метка `(fallback userTalkTime)` |

⚠️ **Никогда не складывать.** Запись 1:12 / разговор 0:36 = 50% мёртвое время — РОП должен видеть оба числа отдельно.

### Master Enrich (Opus, 6 блоков)

| Поле | Тип | UI usage |
|---|---|---|
| `enrichmentStatus` | TEXT? | `enriched` / `in_progress` / `needs_rerun_v9` / `pipeline_gap` / NULL |
| `callType` | TEXT? | enum: `квалификация_лида / продажи_новый / поддержка_ученика / техвопрос / NPS / upsell / win_back / курьер / прочее` |
| `callOutcome` | TEXT? | enum: `real_conversation / no_answer / voicemail / hung_up / ivr / no_speech_or_silence / technical_issue / wrong_recipient` |
| `hadRealConversation` | BOOLEAN? | derived from callOutcome |
| `outcome` | TEXT? | enum: `closed_won / closed_lost / scheduled_callback / objection_unresolved / no_offer_made / not_applicable` |
| `isCurator` | BOOLEAN? | per-call flag → агрегат `bool_or` исключает МОПа из `/managers` |
| `isFirstLine` | BOOLEAN? | per-call flag |
| `possibleDuplicate` | BOOLEAN? | UI badge |
| `purchaseProbability` | INT (0-100) | шапка карточки |
| `scriptScore` | INT? (0-22) | шапка |
| `scriptScorePct` | FLOAT (0-1) | bar chart, color coding (top/bottom 30%) |
| `scriptDetails` | JSONB object | `{<key>: {score: 0|0.5|1, comment: TEXT, na?: bool}}`. Key prefix `1_..11_`. **Знаменатель ВСЕГДА 11** в UI. Sort через `^\d+` regex. |
| `criticalErrors` | JSONB array | **Mixed format**: `["string"]` OR `[{error, evidence, severity}]`. UI normalizes via `normalizeCriticalErrors()`. SQL via `jsonb_typeof CASE`. |
| `psychTriggers` | JSONB object | `{positive: [{time, приём?/technique?, эффект?/effect?, quote_manager?}], missed: [{time, trigger, quote_client?, что_должна_была?/what_to_do?}]}` |
| `clientReaction` | TEXT? | enum: `warm/cold/resistant/engaged/sarcastic/confused/...` |
| `managerStyle` | TEXT? | enum: `soft_seller/aggressive/empathic/neutral/technical/strong_closer/empathic_seller/tech_naive` |
| `clientEmotionPeaks` | JSONB array | `[{time, emotion?/peak?}]` |
| `keyClientPhrases` | JSONB array | strings |
| `cleanedTranscript` | TEXT? | **Содержит literal `\n`** (JSON-encoded escapes). UI применяет `unescapeNewlines()` перед `<pre>+whitespace-pre-wrap`. Fallback: `transcriptRepaired` → `transcript`. |
| `cleanupNotes` | JSONB object | details collapsible |
| `transcriptRepaired` | TEXT? | fallback для cleanedTranscript |
| `transcript` | TEXT? | fallback для transcriptRepaired |
| `callSummary` | TEXT? | 3-4 строки, literal `\n` тоже |
| `managerWeakSpot` | TEXT? | 1 строка, agregate в Block 4b |
| `criticalDialogMoments` | JSONB array | `[{time/time_range, what_happened, what_should_be}]` |
| `ropInsight` | TEXT? | markdown, literal `\n` |
| `nextStepRecommendation` | TEXT? | markdown, literal `\n` |
| `enrichedTags` | JSONB array | strings → chip badges |
| `extractedCommitments` | JSONB array | `[{speaker, quote, timestamp, action, deadline, target}]` |
| `commitmentsCount` | INT? | |
| `commitmentsTracked` | BOOLEAN | default `false` для всех — не показывать ❌ статус |
| `phraseCompliance` | JSONB object | `{<technique>: {used: bool, evidence?, missed?, examples?, expected_count?, actual_count?, note?}}`. 12 ключей diva. Aggregate: count `used:true` per call → avg per manager. |

### 7 типов скрипта diva (`phraseCompliance` ключи)

```
программирование_звонка | искренние_комплименты | эмоциональный_подхват
юмор_забота | крюк_к_боли | презентация_под_боль | попытка_сделки_без_паузы
выбор_без_выбора | бонусы_с_дедлайном | повторная_попытка_после_возражения
маленькая_просьба | следующий_шаг_с_временем
```

### 6 critical errors (анкета diva)

```
interrupted_client | no_needs_discovery | no_pain_discovery
no_objection_handling | no_close_attempt | no_next_step
monolog_not_pain_tied | no_compliments
```

(no_pain_discovery + no_compliments — расширения над 6 enum анкеты, появляются в свежих v9.x).

---

## Manager — UI usage

| Поле | UI |
|---|---|
| `id`, `tenantId`, `name` | базовое |
| `internalExtension` | PBX SIP attribution |
| `gcUserId` | cross-check атрибуции (опц.) |
| `isCurator` | ⚠️ **поля НЕТ в schema** — derive через `bool_or(CallRecord.isCurator)` + матчинг фамилий анкеты diva (Лукашенко, Чернышева, Марьяна, Чиркова, Добренькова, Романова, Довгалева, Николае). Helper `getCuratorManagerIds()` в `dashboard-gc.ts`. |

## Deal — UI usage (карточка звонка / клиента, Block 7)

| Поле | UI |
|---|---|
| `id`, `crmId` | `crmId` для GC deep-link `/sales/control/deal/update/id/{crmId}` |
| `currentStageCrmId` | match key для FunnelStage |
| `funnel` (relation) → `stages` (FunnelStage[]) | resolve `stageName` через `funnel.stages.find(s => s.crmId === d.currentStageCrmId)?.name`. Fallback name = `«Этап #{currentStageCrmId}»` |
| `status` | `OPEN / WON / LOST` (Block 7 не фильтрует по этому — все попадают) |

⚠️ `Deal.stageName` поля **НЕТ**. Нужен JOIN всегда.

## CrmConfig — для deep-links

| Поле | UI |
|---|---|
| `subdomain` | формирует deep-link domain `https://{subdomain}/...` (для diva = `web.diva.school`) |
| `provider` | enum `BITRIX24 / AMOCRM / GETCOURSE` — switch UI mode |
| `gcCookieAt` | для Health tab («expires_at + N days») |

## ReconciliationCheck — для Health tab

⚠️ Table **существует в БД** (создана для канона #38), но **НЕТ в Prisma schema**. Читать через `db.$queryRaw`. Если table пустая — skip section с пометкой «Reconciliation pending».

---

## Контракт API endpoint'ов (если будут)

Сейчас весь UI — Server Components с прямыми Prisma calls. API endpoints не делаем. Master Enrich пишет в БД через cron, UI читает.

Если нужен «Обогатить сейчас» button (упомянут в data-layer-handoff):
- POST `/api/calls/[pbxUuid]/enrich` → триггерит немедленный run
- но сейчас это **манусльный slash skill** `/enrich-calls`, API endpoint TBD.

---

## Какие фичи cron обязан поддерживать

1. **Stage 3.5b PBX↔GC link** — заполнить `gcCallId`, `audioUrl`, `talkDuration`, `gcOutcomeLabel`, `gcEndCause` в течение Nh после звонка. Без этого карточка звонка не имеет плеера + deep-link на GC.
2. **Master Enrich** — заполнить все 6 блоков. Если `phraseCompliance NULL` для real_conversation ≥ 60s → пометить `needs_rerun_v9`.
3. **Stage 7.5b talkDuration backfill** — для legacy NULL рядов.
4. **dealId attribution** — Stage 3.5 phone resolve. ⚠️ **Сейчас сломан** — за 30 дней только 1 distinct dealId среди 5038 CallRecord. Block 7 главной поэтому показывает 1 строку. UI верный, фикс — на стороне cron.

## Критерий «карточка готова к показу»

Для NORMAL (real_conversation ≥ 60s):
- [x] cleanedTranscript заполнен
- [x] callSummary заполнен
- [x] scriptDetails (11 ключей) + scriptScorePct
- [x] phraseCompliance (12 ключей)
- [x] psychTriggers.positive + .missed
- [x] criticalErrors (можно пустой [])
- [x] ropInsight + nextStepRecommendation
- [x] extractedCommitments
- [x] gcCallId + audioUrl (для плеера + GC link)
- [x] enrichmentStatus = `enriched`

Для других типов (B-G) — minimal subset (см. `classifyCallType` в `call-detail-gc.ts`).
