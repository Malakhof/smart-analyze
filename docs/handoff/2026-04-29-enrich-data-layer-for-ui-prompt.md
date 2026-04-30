# Handoff: data layer для UI-промпта (29.04.2026)

**Контекст:** после 4 итераций `/loop /enrich-calls --tenant=diva-school` весь backfill diva 24-27.04 обогащён (812 enriched + 45 pipeline_gap из 857). Ниже — дамп того что лежит в БД и как это должно ложиться на UI. Использовать как вкладной материал к установочному промпту по UI-сервису + cron/автообновление.

**Важно для UI-промпта:** этот документ описывает что РОП **видит** про звонок/МОПа — НЕ архитектуру компонентов. Структура UI остаётся за дизайн-перспективой.

---

## Блок 1 — Сущности после Master Enrich (что лежит в БД)

### CallRecord — 64 колонки (см. полный список в конце)

**Группы полей по семантике:**

| Группа | Поля | Источник | Назначение |
|---|---|---|---|
| **Идентификация** | `id`, `tenantId`, `managerId`, `dealId`, `crmId`, `pbxUuid`, `clientPhone`, `clientName` | sync-pipeline (PBX + GC) | join с менеджером, сделкой, контактом |
| **Метаданные** | `direction`, `duration`, `userTalkTime`, `gateway`, `hangupCause`, `pbxMeta`, `startStamp`, `createdAt` | onPBX | таймлайн, длительность разговора |
| **Аудио/текст** | `audioUrl`, `transcript`, `transcriptRepaired`, `cleanedTranscript`, `cleanupNotes` | Whisper + Master Enrich cleanup | плеер, текстовый разбор |
| **Классификация** | `callType`, `callOutcome`, `hadRealConversation`, `outcome`, `isCurator`, `isFirstLine`, `possibleDuplicate` | Master Enrich | фильтрация в дашборде |
| **Скоринг** | `scriptScore`, `scriptScorePct`, `scriptDetails`, `criticalErrors`, `qualityScore` | scoring + Master Enrich | оценка МОПа |
| **Психология** | `psychTriggers`, `clientReaction`, `managerStyle`, `clientEmotionPeaks`, `keyClientPhrases`, `criticalDialogMoments`, `managerWeakSpot` | Master Enrich | разбор для коучинга |
| **Резюме/инсайт** | `callSummary`, `ropInsight`, `nextStepRecommendation`, `enrichedTags`, `purchaseProbability`, `sentiment`, `hotLead`, `hotLeadReason` | Master Enrich + classifier | карточка для РОПа |
| **Block 7 (commitments)** | `extractedCommitments`, `commitmentsCount`, `commitmentsTracked` | Master Enrich | автотреккинг обещаний |
| **🆕 v8 phraseCompliance** | `phraseCompliance` (jsonb) | Master Enrich | агрегация 12 техник скрипта |
| **GC links** | `gcContactId`, `gcCallCardUrl`, `gcDeepLinkType` | sync-pipeline (Stage 3.5) | deep-link в GetCourse |
| **Pipeline state** | `enrichmentStatus`, `enrichedAt`, `enrichedBy`, `enrichmentLockedAt`, `enrichmentLockedBy` | Master Enrich + cron | concurrent-safe processing |

### `phraseCompliance` jsonb — 12 техник скрипта diva (для агрегации)

Каждая техника = `{used: bool, evidence?: string, missed?: string, expected_count?: string, actual_count?: int, examples?: string[]}`:

```
программирование_звонка | искренние_комплименты | эмоциональный_подхват | юмор_забота
крюк_к_боли | презентация_под_боль | попытка_сделки_без_паузы | выбор_без_выбора
бонусы_с_дедлайном | повторная_попытка_после_возражения | маленькая_просьба | следующий_шаг_с_временем
```

**SQL для дашборда «топ-3 фразы которые НЕ используют»:**

```sql
SELECT
  COUNT(*) FILTER (WHERE "phraseCompliance"->'выбор_без_выбора'->>'used'='false') AS missing_choice,
  COUNT(*) FILTER (WHERE "phraseCompliance"->'искренние_комплименты'->>'used'='false') AS missing_compliments,
  COUNT(*) FILTER (WHERE "phraseCompliance"->'попытка_сделки_без_паузы'->>'used'='false') AS missing_close_attempt,
  -- ...12 техник
FROM "CallRecord"
WHERE "tenantId"='cmo4qkb1000000jo432rh0l3u'
  AND "callOutcome"='real_conversation' AND duration >= 60;
```

### enrichmentStatus — состояния pipeline

| Status | Что значит | UI |
|---|---|---|
| `enriched` | полная карточка готова | показываем 6 блоков |
| `in_progress` | в работе у сессии (`enrichmentLockedBy`) | spinner |
| `needs_rerun_v9` | помечен для re-enrich (после bug-fix) | бейдж «обновляется» |
| `NULL` | ещё не обогащён | очередь |
| **🆕 (предлагается)** `pipeline_gap` | transcript=NULL + audioUrl=NULL | «нет аудио — тех. отдел» |

---

## Блок 2 — 6 типов «звонок» для дашборда РОП

Это **ключевая сегментация** которую анкета diva не выписала явно (она просила 4 категории — наборы/НДЗ/АО/реальные), но РОПу нужны 6 — разный объём данных, разная глубина AI-карточки.

| # | Тип | Признак | hadRealConversation | callOutcome | UI карточка |
|---|---|---|---|---|---|
| 1 | **NORMAL** | duration ≥ 60 + есть диалог | true | `real_conversation` | **полная 6-блочная** (psych + script + commitments + insight) |
| 2 | **SHORT_RESCHEDULE** | 30-60s, перенос или быстрый отказ | true | `real_conversation` | **упрощённая** (только outcome + nextStep) |
| 3 | **VOICEMAIL/IVR** | репликам только МОП + автоответчик | false | `voicemail` или `ivr` | **бейдж + commitment** (если МОП оставила message) |
| 4 | **NO_SPEECH** | transcript ≤ 100 chars (Whisper-галлюцинация / шум) | false | `no_speech_or_silence` | **бейдж + причина** |
| 5 | **HUNG_UP** | <30s, "Алло"-сброс | false | `hung_up` или `no_answer` | **бейдж + НДЗ-счётчик** |
| 6 | **TECHNICAL_ISSUE** | повторяющиеся "вы меня слышите?" | false | `technical_issue` | **бейдж + флаг тех. отделу** |
| **🆕 7** | **PIPELINE_GAP** | `transcript IS NULL` + `audioUrl IS NULL` | NULL (не обогащается) | NULL | **НЕ AI-карточка — счётчик в карточке МОП** |

**Найдено 29.04.2026:** 45 звонков diva типа 7 (PIPELINE_GAP), распределены по 14 МОПам. Это новая категория которой нет в анкете, но РОП должен её видеть **как индикатор тех. инфраструктуры**, не как качество МОПа.

### Где применяется фильтр `transcript IS NOT NULL` (выявлено grep'ом)

Все AI-метрики уже корректно отсеивают type 7:
- `src/lib/queries/dashboard.ts:420`
- `src/lib/queries/manager-detail.ts:127,159`
- `src/lib/queries/quality.ts:108`
- `src/lib/queries/retro.ts:112`
- `src/lib/queries/deal-detail.ts:87`
- `src/lib/ai/analyze-deal.ts:104,242`
- `src/lib/ai/score-call.ts:193`

**НЕ нужно** трогать эти queries — они правильно работают. **Нужно** добавить отдельный счётчик `calls_no_audio` в карточку МОПа.

---

## Блок 3 — Открытые вопросы под UI-промпт

### 3.1 Карточка МОП — какие счётчики

Анкета diva п.9.1-9.4 просит 4 счётчика. После работы с типами я добавил бы 2:

| # | Счётчик | SQL | Источник |
|---|---|---|---|
| 1 | Наборов всего | `COUNT(*) WHERE managerId=X` | анкета п.9.1 |
| 2 | Дозвонов (real_conversation) | `COUNT(*) FILTER (WHERE callOutcome='real_conversation')` | анкета п.9.4 |
| 3 | НДЗ (voicemail+hung_up+no_answer) | `COUNT(*) FILTER (WHERE callOutcome IN (...))` | анкета п.9.2 |
| 4 | Минут в разговоре | `SUM(userTalkTime) WHERE callOutcome='real_conversation'` | анкета (запрос РОПа выше) |
| 5 | **🆕 Без аудио** | `COUNT(*) FILTER (WHERE transcript IS NULL AND audioUrl IS NULL)` | **новая метрика — индикатор тех. инфры** |
| 6 | **🆕 Средний scriptScorePct** | `AVG(scriptScorePct) FILTER (WHERE callOutcome='real_conversation' AND duration ≥ 60)` | анкета п.9.5 |

**В UI карточки МОПа:** 9/67 без аудио = бейдж «13% без аудио ⚠️ — проверить тех. отдел».

### 3.2 Карточка звонка — что показывать для каждого типа

| Тип | Блок: Шапка | Блок: Транскрипт | Блок: AI-разбор |
|---|---|---|---|
| 1 NORMAL | время+МОП+клиент+gcLink+бейджи | cleanedTranscript полный | **все 6 блоков** (psych/script/critical/insight/nextStep/commitments) |
| 2 SHORT_RESCHEDULE | то же | cleanedTranscript | только **3 блока**: outcome + nextStep + commitments |
| 3 VOICEMAIL | то же + бейдж voicemail | cleanedTranscript короткий | только **commitment** (что МОП оставила в сообщении) |
| 4 NO_SPEECH | то же + бейдж no_speech | placeholder «без речи» | **disclaimer**: «не оценивается, проверить аудио» |
| 5 HUNG_UP | то же + бейдж hung_up | <30s text | **disclaimer**: «звонок не состоялся как разговор» |
| 6 TECHNICAL_ISSUE | то же + 🚨 alert «тех. отдел» | cleanedTranscript | **disclaimer**: «проверить SIP/гарнитуру» |
| 7 PIPELINE_GAP | то же + 🛠️ «Аудио не получено из onPBX» | **НЕТ** | **НЕТ** — только «нечего показать» |

### 3.3 Дашборд РОП — агрегаты которые нужны

1. **Топ-3 фразы которые МОПы НЕ используют** — агрегация `phraseCompliance` через jsonb operators (см. SQL выше)
2. **Топ-3 проблемных МОПов** по среднему `scriptScorePct < 60%`
3. **Block 7 алерты:** commitments с `commitmentsTracked=false` старше 24ч (МОП обещала перезвонить — не выполнила)
4. **Pipeline gap %** по МОПам — outliers > 10% обозначить как «технический сигнал»
5. **6 critical errors heatmap** (анкета п.6) — какая ошибка чаще всего у какого МОПа

### 3.4 Cross-cut с cron / автообновлением

- Дашборд должен показывать **прогресс enrichment**: «обогащено X/Y за сегодня, в очереди Z». SQL — count по `enrichmentStatus`.
- При live-обновлении карточки звонка — **читать `enrichmentLockedAt`** чтобы показать «обогащается прямо сейчас» (если < 30 мин назад locked).
- `pbxMeta` jsonb содержит метаданные звонка от PBX — может пригодиться для индикатора latency sync.
- Cron `master-enrich` запускается через `/loop /enrich-calls --tenant=X --limit=40` — UI должен иметь кнопку **«Обогатить сейчас»** (триггерит немедленный run, не ждёт расписания).

### 3.5 Эталоны для дизайнера / промпт-инженера

Для калибровки **глубины 6-блочной карточки** (тип 1 NORMAL) показать дизайнеру 2 эталона:

- `docs/canons/master-enrich-samples/sample-3-proper-cleanup-lara.md` — `empathic_seller`, `closed_lost`, **2/12 phraseCompliance** used (учит как выглядит «слабый» звонок)
- `docs/canons/master-enrich-samples/sample-4-strong-closer-tech-block.md` — `strong_closer + tech_naive`, `objection_unresolved`, **8/12 phraseCompliance** used (учит как выглядит «сильный» звонок с тех. блокером)

Каждый эталон содержит markdown-таблицы для каждой секции — дизайнер должен повторить такую же **визуальную плотность** в UI карточки звонка.

---

## Полный список колонок CallRecord (64)

```
id, tenantId, managerId, dealId, crmId, clientName, clientPhone,
direction, category, audioUrl, transcript, duration, createdAt,
type, callType, transcriptRepaired, scriptScore, scriptDetails,
pbxUuid, managerExt, startStamp, userTalkTime, hangupCause, gateway,
qualityScore, pbxMeta, callSummary, sentiment, objections, hotLead,
hotLeadReason, gcContactId, enrichmentStatus, enrichedAt, enrichedBy,
callOutcome, hadRealConversation, outcome, isCurator, isFirstLine,
possibleDuplicate, scriptScorePct, criticalErrors, psychTriggers,
clientReaction, managerStyle, clientEmotionPeaks, keyClientPhrases,
cleanedTranscript, cleanupNotes, managerWeakSpot, criticalDialogMoments,
ropInsight, enrichedTags, nextStepRecommendation, purchaseProbability,
gcCallCardUrl, gcDeepLinkType, extractedCommitments, commitmentsCount,
commitmentsTracked, phraseCompliance, enrichmentLockedAt, enrichmentLockedBy
```

---

## Связанные документы

- `docs/canons/master-enrich-samples/sample-3-proper-cleanup-lara.md` — эталон closed_lost
- `docs/canons/master-enrich-samples/sample-4-strong-closer-tech-block.md` — эталон strong_closer
- `docs/demo/2026-04-22-diva-anketa-answers.md` — анкета клиента (раздел 9 — РОП-боли)
- `docs/demo/2026-04-22-diva-sales-script.md` — 11 этапов скрипта diva (для scriptDetails)
- `~/.claude/skills/enrich-calls/SKILL.md` — текущий skill Master Enrich (v9)
- `src/lib/queries/{dashboard,manager-detail,quality,retro}.ts` — существующие queries (использовать как basis, не переписывать с нуля)

---

## Что НЕ делать в UI-промпте

1. **НЕ** менять фильтры `transcript IS NOT NULL` в существующих queries — они корректно отсекают type 7
2. **НЕ** добавлять AI-карточку для type 7 (PIPELINE_GAP) — нечего показать без транскрипта
3. **НЕ** мерять качество МОПа по type 7 — это инфраструктура, не звонок-перформанс
4. **НЕ** копировать sample-1/sample-2 эталоны — они архивированы (compression bug). Только sample-3 и sample-4

---

**Использование документа:** скормить целиком в общий установочный промпт UI-сервиса + промпт cron/автообновление. После прочтения дизайнер/промпт-инженер должен ответить на 5 вопросов из 3.1-3.5, и тогда писать промпт интерфейса.
