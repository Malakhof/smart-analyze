---
name: enrich-calls
description: "Master Enrich для звонков SalesGuru. Обогащает batch 40-50 звонков по 6-блочной схеме (callType, callOutcome, criticalErrors, psychology, ropInsight). Используется при подключении нового клиента (backfill) и для вечернего batch enrichment ежедневного потока. Работает через Claude Pro подписку — $0."
---

# /enrich-calls — Master Enrich

Обогащает звонки в БД SalesGuru до полной enriched-карточки. **100% покрытие анкеты клиента + наш слой нейропродаж.**

---

## 🔴 CRITICAL — ПРОЧИТАЙ ПЕРЕД ЛЮБЫМ ENRICH

### 1. ОБЯЗАТЕЛЬНО прочитать эталон ПОЛНОСТЬЮ
**`~/Desktop/v213-fix-samples/b8367ce9_enriched.md`** — это **точный benchmark глубины** обогащения. **НЕ сокращать**, **НЕ упрощать**. Каждая твоя карточка должна быть в той же глубине что эталон.

В эталоне:
- 🧼 Очищенный транскрипт (cleanedTranscript) с заметками cleanup
- 📝 Резюме звонка (summary) — 4 строки
- 🧠 Психология и нейропродажи — **table** удачных приёмов (time / приём / эффект) + **table** упущений + 4-5 missed triggers с цитатами + clientReaction + managerStyle + clientEmotionPeaks + 4-5 keyClientPhrases + criticalDialogMoments (отдельный анализ ключевых моментов с цитатами клиента и предложением "что должна была сказать МОП")
- 📊 Скрипт-скоринг — **table** all 11 stages с оценкой и комментарием
- 🚨 Критические ошибки — **table** all 6 ошибок (✅/⚠️/❌)
- 💡 Инсайт для РОПа — **5 пунктов** конкретных action items + паттерн (soft_seller / empathic / etc) + purchaseProbability с обоснованием
- 🛠️ nextStepRecommendation — **4 конкретных шага** с каналами и временами
- 🏷️ Tags
- 🎯 Категория и исход — **table**
- ✅ Соответствие требованиям — **table** анкета diva → покрыто

**Если ты делаешь карточку без таблиц / без 4+ missed triggers / без criticalDialogMoments — ты НЕ в эталоне. Переделывай.**

### 2. AUTO-MODE — НЕ спрашивать подтверждений
- Не спрашивать "продолжать?" после каждой карточки
- Не спрашивать "как форматировать?"
- Не спрашивать "сколько обрабатывать?"
- Не делать пробный 1 звонок и спрашивать "ок?"
- **Сразу делать batch согласно --limit и применять к БД**
- Только в случае **системной ошибки** (БД недоступна, schema колонок нет) — остановиться и сообщить
- `--dry-run` режим = показать batch без записи (тогда подтверждение не требуется, просто показ)

### 3. Глубина = эталон, не "пример краткого формата"
- Если выдаёшь карточку короче эталона — это ошибка
- Если пропускаешь criticalDialogMoments — ошибка
- Если выдаёшь ropInsight в 1-2 строки — ошибка (нужно 5 пунктов)
- Если в `psychTriggers.missed` менее 3 элементов — ошибка (норма 4-5)

---

## Использование

```
/enrich-calls --tenant=diva --limit=50
/enrich-calls --tenant=diva --since="2026-04-28T00:00"
/enrich-calls --tenant=diva --uuids="<u1>,<u2>,..."
/enrich-calls --tenant=diva --limit=50 --rescore
/enrich-calls --tenant=diva --limit=5 --dry-run
```

## Аргументы

- `--tenant` (обязательный): `diva-school | vastu | reklama | coral | shumoff`
- `--limit` (default 50): максимум звонков за batch
- `--since` (ISO timestamp): фильтр `startStamp >= since`
- `--uuids` (csv): явные UUIDs для обогащения
- `--rescore`: re-enrich уже обогащённые
- `--dry-run`: вывести результат, не писать в БД
- `--auto-continue`: после batch если pending>0 — recursive call (для /loop)

## Что я делаю при вызове skill

### Шаг 1: Auto-discover контекст клиента (один раз в начале сессии)

**Принцип:** skill полностью автономный — user только говорит `/enrich-calls --tenant=diva --limit=50`, всё остальное skill находит сам.

1. **Tenant ID:**
   ```sql
   SELECT id, "name", subdomain FROM "Tenant" WHERE name LIKE '<tenant>%' LIMIT 1
   ```

2. **Анкета:** `/Users/kirillmalahov/smart-analyze/docs/demo/<tenant>-anketa-answers.md`
   - Раздел 2: список МОПов / кураторов / первой линии
   - Раздел 4: что считать продажей
   - Раздел 5: категории звонков
   - Раздел 6: 6 критических ошибок
   - Раздел 8: правила дублей
   - Раздел 9: РОП-боли (callOutcome счётчики)

3. **Скрипт продаж:** `/Users/kirillmalahov/smart-analyze/docs/demo/<tenant>-sales-script.md`
   - 11 этапов (для diva), маппинг на критические ошибки

4. **Schema enriched card:** `~/.claude/projects/-Users-kirillmalahov/memory/feedback-master-enrich-canon.md`

5. **Pipeline canon:** `~/.claude/projects/-Users-kirillmalahov/memory/feedback-pipeline-canon-with-opus-enrich.md`

6. **Phone resolve (canon #8):** `~/.claude/projects/-Users-kirillmalahov/memory/feedback-upsert-call-canon8-mandatory.md`
   - 3-этапная цепочка: phone → GC `/pl/api/account/users?phone=X` → user_id → `Deal.clientCrmId` → `Deal.id`
   - НЕТ поля `phone` в нашей БД — bridge через GC API (per-tenant различия)

7. **🔥 Эталон enriched card (ОБЯЗАТЕЛЬНО прочитать ПОЛНОСТЬЮ):**
   `~/Desktop/v213-fix-samples/b8367ce9_enriched.md`
   - **Это benchmark глубины.** Каждая твоя карточка = эта структура с тем же уровнем детализации.
   - НЕ сокращать таблицы, НЕ упрощать формулировки, НЕ пропускать секции
   - Если skill грузит мало контекста → перечитать ПОЛНОСТЬЮ перед каждым batch (даже если думаешь "уже знаю")

8. **Список менеджеров tenant:**
   ```sql
   SELECT id, name, "internalExtension", role FROM "Manager" WHERE "tenantId" = '<tenantId>'
   ```
   - Кураторы = `role='curator'` OR fuzzy match по фамилиям из анкеты раздел 2
   - Первая линия = list из анкеты раздел 2

### Шаг 2: Получить batch звонков (с готовыми linker'ами)

```sql
SELECT
  cr.id, cr."pbxUuid", cr."clientPhone", cr."startStamp", cr.duration,
  cr."userTalkTime", cr.gateway, cr."hangupCause", cr.direction,
  cr."managerId", m.name as managerName, m."internalExtension",
  cr.transcript, cr."transcriptRepaired",
  cr."gcContactId", cr."dealId",      -- ← АВТОМАТИЧЕСКИ из Stage 3.5
  d."crmId" as dealCrmId,              -- ← для deep-link на сделку
  t.subdomain as gcSubdomain           -- ← для построения URL
FROM "CallRecord" cr
LEFT JOIN "Manager" m ON cr."managerId" = m.id
LEFT JOIN "Deal" d ON cr."dealId" = d.id
LEFT JOIN "Tenant" t ON cr."tenantId" = t.id
LEFT JOIN "CrmConfig" cc ON cc."tenantId" = cr."tenantId" AND cc.provider='GETCOURSE'
WHERE cr."tenantId" = '<tenantId>'
  AND cr.transcript IS NOT NULL
  AND (cr."enrichmentStatus" IS NULL OR cr."enrichmentStatus" != 'enriched' OR --rescore)
  AND (--since: cr."startStamp" >= --since)
  AND (--uuids: cr."pbxUuid" IN (--uuids))
ORDER BY cr."startStamp" DESC
LIMIT --limit
```

**Важно:** для diva subdomain храним из `CrmConfig.subdomain` (например `web.diva.school`). Использовать его для deep-link.

Применить через MCP soldout-db `execute_raw_query` или через ssh + docker exec.

### Шаг 3: Для каждого звонка — обогатить через Opus reasoning

Используй **полный контекст звонка** (transcript + transcriptRepaired + metadata + анкета + скрипт + список менеджеров) и сгенерируй 6-блочную карточку по schema `feedback-master-enrich-canon.md`.

**Принципы обогащения (КРИТИЧНО):**

1. **Cleanup transcript:**
   - Удалить эхо/гарбаж (фразы клиента в МОП-канале — "шейфилизировал", "ледяная подворота")
   - Объединить разорванные фразы одного спикера в логические блоки
   - Удалить одиночные галлюцинации Whisper ("Толок синий", "наква", "А где наква?")
   - Восстановить порядок реплик где Whisper ошибся
   - **НЕ выдумывать** контент — только cleanup существующего

2. **Классификация:**
   - `isCurator` — match по фамилиям из анкеты раздел 2 (для diva — список выше)
   - `isFirstLine` — match по фамилиям из анкеты (для diva — Жихарев, Чернышова)
   - `callType` — по содержимому transcript (анкета п.5)
   - `callOutcome` — по содержимому: real_conversation если есть полноценный диалог, voicemail если только автоинформер, no_answer если короткий разговор без слов клиента, hung_up если резкий обрыв, ivr если IVR-меню
   - `outcome` — по итогу разговора (анкета п.4)
   - `possible_duplicate` — `SELECT COUNT(*) FROM "CallRecord" WHERE "clientPhone"=X AND "tenantId"=Y AND id != current_id` — если есть другой звонок с тем же phone — true

3. **Script compliance** (анкета п.6):
   - 6 фиксированных criticalErrors enum
   - scriptScore по 11 этапам diva (или 9 для других tenants)
   - scriptDetails per-stage

4. **Психология (наш слой):**
   - psychTriggers.positive — приёмы которые МОП использовала (искренний_комплимент, выбор_без_выбора, эмоциональный_подхват, юмор_забота, эхо_ритуала, программирование, маленькая_просьба)
   - psychTriggers.missed — упущенные триггеры клиента (по словам клиента "бесит", "вечно борюсь", "не получается", возраст, обстоятельства типа "больничный")
   - clientReaction по тону клиента
   - managerStyle (soft_seller / aggressive / empathic / neutral / technical)
   - clientEmotionPeaks — когда клиент включился / закрылся
   - keyClientPhrases — цитаты-триггеры

5. **ropInsight для РОПа:**
   - 3-5 конкретных action items
   - Указать паттерн МОПа (soft_seller / robot_script / overselling / no_close / etc)
   - Конкретные тренинги или правила
   - purchaseProbability 0-100

6. **nextStepRecommendation:**
   - Что МОП должна сделать ДО следующего звонка
   - Конкретный канал (WhatsApp/Telegram/email/звонок)
   - Конкретное время

7. **🔗 GC Deep-link (АВТОМАТИЧЕСКИ из БД):**
   ```python
   subdomain = row['gcSubdomain']  # web.diva.school
   if row['dealId'] and row['dealCrmId']:
       gcCallCardUrl = f"https://{subdomain}/sales/control/deal/update/id/{row['dealCrmId']}"
       gcDeepLinkType = 'call_card'
   elif row['gcContactId']:
       gcCallCardUrl = f"https://{subdomain}/pl/user/contact/update/id/{row['gcContactId']}"
       gcDeepLinkType = 'contact_fallback'
   else:
       gcCallCardUrl = None
       gcDeepLinkType = None
   ```
   **Не нужно ничего "выдумывать"** — данные уже в БД (Stage 3.5 заполняет до enrich).
   Для **новых звонков** в production: cron sync-pipeline автоматически делает phone resolve + deal link → к моменту enrich оба поля готовы.

8. **🔥 extractedCommitments (Block 7 — KILLER FEATURE):**
   Вытаскиваешь ВСЕ обещания и договорённости из звонка — отдельно для МОПа и клиента.
   Каждое обещание — структурированный объект:
   ```yaml
   - speaker: МЕНЕДЖЕР | КЛИЕНТ
     quote: "Прислать формат курса"   # точная цитата из транскрипта
     timestamp: "03:49"
     action: send_whatsapp | send_email | callback | send_offer | meeting | task | bring_documents | other
     deadline: "end_of_day" | "+1_day" | "+7_days" | "2026-08-28" | "after_event:брекеты_4_мес" | "unspecified"
     target: "КП на Дива 5D"           # что отправить / сделать
     evidence: "Не касается рта. Прислать формат?"   # контекст
   ```
   **Что считать обещанием:**
   - "пришлю", "отправлю", "напишу", "перезвоню", "наберу"
   - "запишу", "поставлю в группу", "зарезервирую"
   - "проверю", "согласую", "уточню"
   - со стороны клиента: "напишу скрин", "пришлю документы", "посмотрю и решу"
   **НЕ считать:** общие фразы "будем на связи", "до свидания", "хорошо".
   **Deadline:** если не назван явно — выводить из контекста ("сегодня", "после брекетов 4 мес" → +4 мес).
   `commitmentsCount` = длина массива.
   `commitmentsTracked` = false (default — sync в CRM в отдельной фазе).

### Шаг 4: Записать в БД

Для каждой карточки сделать UPDATE:
```sql
UPDATE "CallRecord" SET
  "enrichmentStatus" = 'enriched',
  "enrichedAt" = NOW(),
  "enrichedBy" = 'claude-opus-4-7-v1',
  "callType" = '...',
  "callOutcome" = '...',
  "hadRealConversation" = ...,
  "outcome" = '...',
  "isCurator" = ...,
  "isFirstLine" = ...,
  "possible_duplicate" = ...,
  "scriptScore" = ...,
  "scriptScorePct" = ...,
  "criticalErrors" = '[...]'::jsonb,
  "scriptDetails" = '{...}'::jsonb,
  "psychTriggers" = '{...}'::jsonb,
  "clientReaction" = '...',
  "managerStyle" = '...',
  "clientEmotionPeaks" = '[...]'::jsonb,
  "keyClientPhrases" = '[...]'::jsonb,
  "cleanedTranscript" = '...',
  "summary" = '...',
  "managerWeakSpot" = '...',
  "ropInsight" = '...',
  "tags" = '[...]'::jsonb,
  "nextStepRecommendation" = '...',
  "purchaseProbability" = ...,
  "extractedCommitments" = '[...]'::jsonb,
  "commitmentsCount" = ...,
  "commitmentsTracked" = false
WHERE "pbxUuid" = '...'
```

**Если в БД нет нужных колонок** — сгенерировать миграцию:
```sql
ALTER TABLE "CallRecord" ADD COLUMN IF NOT EXISTS "enrichmentStatus" TEXT;
ALTER TABLE "CallRecord" ADD COLUMN IF NOT EXISTS "callType" TEXT;
-- ... и т.д.
```
И сначала применить миграцию, потом UPDATE'ы.

### Шаг 5: Отчёт + Auto-continue

После batch — короткий отчёт:
- Обогащено N/total в этом batch
- Cumulative прогресс: enriched/total для tenant (через SQL count)
- Распределение callType (квалификация_лида: 12, продажи_новый: 5, ...)
- Распределение outcome (no_offer_made: 8, scheduled_callback: 4, ...)
- Top managerStyle паттерны (soft_seller: 7, ...)
- Top critical errors (no_close_attempt: 9, monolog_not_pain_tied: 4, ...)

### Шаг 6 — Auto-loop (только если работаем с /loop или --auto-continue)

После отчёта SQL:
```sql
SELECT COUNT(*) FROM "CallRecord"
WHERE "tenantId" = '<tenantId>'
  AND transcript IS NOT NULL
  AND ("enrichmentStatus" IS NULL OR "enrichmentStatus" != 'enriched')
```

**Условия продолжения:**
- pending > 0 → следующий batch (recursive `/enrich-calls` с теми же args)
- pending = 0 → **EXIT с финальным отчётом** "✅ Backfill complete: N/N enriched"

**Exit signal для `/loop`:**
- pending > 0 → последняя строка ответа должна быть `[CONTINUE]` (skill `/loop` это видит → запускает снова)
- pending = 0 → последняя строка `[DONE]` (loop останавливается)

**Если без /loop, но с --auto-continue:**
- pending > 0 → сам внутри skill вызвать `/enrich-calls` снова (рекурсивно)

Это позволяет: один вызов `/loop /enrich-calls --tenant=diva-school --limit=40` обработает все 857 без остановки.

## 🛑 Edge-cases — звонки БЕЗ нормального разговора

Не все 857 звонков — настоящий диалог. Skill должен корректно классифицировать эти случаи:

### Тип A: Звонок без речи (NO_SPEECH placeholder)
**Признак:** transcript содержит ТОЛЬКО `[МЕНЕДЖЕР 00:00] (Приветствие. ПД. ФИО)` или близко к этому, < 100 chars total.

**Заполнить:**
```yaml
callOutcome: no_speech_or_silence
hadRealConversation: false
callType: not_applicable
outcome: not_applicable
scriptScore: null            # нечего оценивать
criticalErrors: []
psychTriggers: { positive: [], missed: [] }
clientReaction: silent
managerStyle: not_applicable
summary: "Whisper не нашёл речь — возможно соединения не было / автоответчик / IVR / технический сбой"
managerWeakSpot: null
ropInsight: "Не оценивать. Проверить запись вручную если важно."
purchaseProbability: null
extractedCommitments: []
tags: [no_speech, не_оценивается]
```

### Тип B: Автоответчик / IVR / голосовое меню
**Признак:** в transcript `callType=VOICEMAIL` (уже определено DeepSeek classifier ранее) ИЛИ репликам только МОПа, нет КЛИЕНТ-реплик, фразы типа "вызываемый абонент не отвечает", "оставайтесь на линии".

**Заполнить:**
```yaml
callOutcome: voicemail | ivr
hadRealConversation: false
callType: not_applicable
outcome: not_applicable
scriptScore: null
clientReaction: silent
managerStyle: not_applicable
summary: "Автоответчик/IVR. Менеджер не дозвонился до клиента."
ropInsight: "Засчитывается как НДЗ (попытка дозвона). Контролировать частоту повторных попыток."
purchaseProbability: null
extractedCommitments: []
tags: [voicemail, ндз]
```

### Тип C: Гудки / абонент сбросил (HUNG_UP)
**Признак:** очень короткий transcript (< 30 секунд), нет содержательного диалога — клиент сбросил после "Алло" или вообще не ответил.

**Заполнить:**
```yaml
callOutcome: hung_up | no_answer
hadRealConversation: false
callType: not_applicable
outcome: not_applicable
scriptScore: null
clientReaction: cold | not_engaged
managerStyle: not_applicable
summary: "Клиент сбросил / не ответил после короткого приветствия"
ropInsight: "НДЗ. Возможно неудачное время — проверить эффективность звонков в этот час."
purchaseProbability: null
extractedCommitments: []
tags: [hung_up | no_answer, ндз]
```

### Тип D: Менеджер и клиент НЕ слышат друг друга (тех. проблема)
**Признак:** в transcript обе стороны говорят, но повторяют "Алло", "вы меня слышите?", "плохо слышно", "перезвоните" — нет содержательного диалога.

**Заполнить:**
```yaml
callOutcome: technical_issue
hadRealConversation: false
callType: not_applicable
outcome: not_applicable
scriptScore: null
clientReaction: confused
managerStyle: not_applicable
summary: "Технические проблемы связи — клиент и МОП не слышат друг друга. Звонок не состоялся как диалог."
ropInsight: "Проверить качество связи. Если повторяется у конкретного МОПа — проблема гарнитуры/SIP. Засчитать как НДЗ для отчёта."
purchaseProbability: null
extractedCommitments: []
tags: [technical_issue, тех_проблема, ндз]
```

### Тип E: Очень короткий разговор без сути
**Признак:** длительность 30-60 сек, клиент сказал "не сейчас / занят / перезвоните позже" → перенос.

**Заполнить почти как обычно**, но scriptScore низкий (1-2/9):
```yaml
callOutcome: real_conversation
hadRealConversation: true
callType: квалификация_лида (или upsell — по контексту)
outcome: scheduled_callback
scriptScore: 1-2
criticalErrors: []                 # за 30 сек ничего не должна была сделать
summary: "Клиент попросил перезвонить позже. Без выявления потребностей."
ropInsight: "Норма для cold-calling. Проверить выполнен ли follow-up в назначенное время."
extractedCommitments: [{speaker: МЕНЕДЖЕР, action: callback, deadline: ...}]
tags: [перенос, короткий_звонок]
```

### Правило различения

| Признак | Тип |
|---|---|
| transcript ≤ 100 chars + только placeholder | A: NO_SPEECH |
| только МОП реплики, voicemail-фразы | B: VOICEMAIL/IVR |
| < 30 сек, "Алло" сбросил | C: HUNG_UP |
| повторяющиеся "Алло, слышите?" | D: TECHNICAL |
| 30-60 сек, "перезвоните" | E: SHORT_RESCHEDULE |
| ≥ 60 сек, диалог с темами | F: NORMAL → полный 6-блочный enrich |

**Skill сам определяет тип ПЕРЕД enrich** через быстрый анализ длины transcript и ключевых маркеров. Edge-case = быстрая обработка (5-10 секунд), нет смысла думать 30 секунд над пустым звонком.

---

## Важные правила

1. **Дочитывай канон каждый раз** — `feedback-master-enrich-canon.md` определяет все 6 блоков. Не пропускай поля даже если данных нет (null).
2. **Используй per-tenant анкету** — критические ошибки и категории звонков могут отличаться для разных клиентов.
3. **Не суммаризируй** — cleanedTranscript должен быть полным, summary только в отдельном поле.
4. **Не галлюцинируй** — если в transcript нет данных для поля → null. НЕ додумывай.
5. **Cost gate:** для текущих 5 клиентов работаешь через подписку. Если объёмы > 1000/день per tenant — попроси user запустить через API.

## Интеграция с другими канонами

- Schema: `feedback-master-enrich-canon.md`
- Pipeline upstream: `feedback-pipeline-v213-final-settings.md`
- Pipeline canon: `feedback-pipeline-canon-with-opus-enrich.md`
- Flow: `feedback-onboarding-and-daily-enrich-flow.md`
- View layer: `feedback-rop-dashboard-minimum.md` (Канон #37)
- Образец: `~/Desktop/v213-fix-samples/b8367ce9_enriched.md`
