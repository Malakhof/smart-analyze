# 🚀 HANDOFF — Cron Auto-Update + Real-Time Pipeline (v3 — production-ready)

**Создан:** 2026-04-28 → v2 2026-04-29 → **v3 2026-04-29 (компилирует ВСЁ)**
**Куда копировать:** новая сессия Claude Code в `/Users/kirillmalahov/smart-analyze`
**Цель:** end-to-end cron orchestrator + ОДИН backfill за **2026-04-28** + safety против падений

---

## 📋 КОРОТКИЙ ПРОМПТ для копирования в новую сессию

```
Привет. Реализую боевой режим cron auto-update для SalesGuru.

🛑 STEP 0 — ОБЯЗАТЕЛЬНЫЕ tool-calls ПЕРЕД любым кодом:

  Read("/Users/kirillmalahov/smart-analyze/docs/handoffs/2026-04-28-cron-realtime-pipeline-handoff.md")
  Read("/Users/kirillmalahov/smart-analyze/scripts/cron-master-pipeline.skeleton.ts")
  Read("/Users/kirillmalahov/smart-analyze/scripts/cron-stage35-link-fresh-calls.ts")

После 3 Read'ов — в первом сообщении выдай 4 строки resume:
- "Backfill window: ... до ... МСК (фиксировано)"
- "Этапов: 11 | DoD-критериев: ... | Compliance gates: ..."
- "Эталоны структуры: cron-stage35 + skeleton"
- "5 safety canons: lockfile + disk-cleanup + gpu-cost-cap + whisper-resume + gc-cookie-refresh"

Без resume = STEP 0 не выполнен → стоп.

Все остальные файлы (memory feedback-*, canon-*) читай ПО МЕРЕ НЕОБХОДИМОСТИ —
индекс в секции «📚 По требованию» внизу handoff'а.

Tenant ID для diva: 'cmo4qkb1000000jo432rh0l3u'
Доступ к prod БД: ssh -i ~/.ssh/timeweb root@80.76.60.130 "docker exec smart-analyze-db psql ..."
НЕ использовать mcp__soldout-db__* (другая БД — WB-аналитика).

Дальше следуй handoff'у дословно: ЗАДАЧА 0 (audio URLs backfill + cookie refresh setup) →
ЗАДАЧА 1 (Backfill 2026-04-28) → ЗАДАЧИ 2-4 (Этапы 1-11 с compliance gates + Crontab + E2E).
```

---

## 🎯 BACKFILL TARGET — ЗАФИКСИРОВАННАЯ ДАТА (НЕ относительно «вчера»)

**Первый запуск — это ОДНОРАЗОВЫЙ ручной backfill за 28 апреля 2026.**

| Параметр | Значение |
|---|---|
| Цель | догнать пропущенные звонки **2026-04-28** для diva |
| Window FROM | `last_call_in_db.startStamp` (примерно вечер 2026-04-27) |
| Window TO | **2026-04-28 23:59:59 МСК** (включительно) |
| Tenant | `diva-school` (`cmo4qkb1000000jo432rh0l3u`) |
| Где запускать | manual: `npx tsx scripts/manual-backfill-2026-04-28.ts` |
| Когда успех | все звонки 28.04 в БД с `transcript NOT NULL` + `enrichmentStatus IS NULL` |
| Что дальше | `/loop /enrich-calls` подберёт ночью + cron активируется на 29.04+ |

⛔ **«28.04» = ФИКСИРОВАННАЯ ДАТА.** Если читаешь handoff 30 апреля — backfill всё равно про 28.04, не «вчера». Если cron не успели поставить до 30.04 → нужен ОТДЕЛЬНЫЙ backfill для 29.04 — спросить пользователя.

---

## 🛡️ 5 SAFETY CANONS (mandatory — без них pipeline падает за неделю)

| Canon | Что закрывает | Файл |
|---|---|---|
| 1. **Lockfile** | Concurrent cron-1 + cron-2 → race condition на UPSERT, дубли в БД | `docs/canons/cron-safety-canons/canon-cron-lockfile.md` |
| 2. **Disk Cleanup** | `/tmp/whisper-input/` заполняется за 5-7 дней → диск 100% → весь сервер падает | `docs/canons/cron-safety-canons/canon-disk-cleanup.md` |
| 3. **GPU Cost Cap** | Watchdog зацикливается → $50-100 потеряно за ночь | `docs/canons/cron-safety-canons/canon-gpu-cost-cap.md` |
| 4. **Whisper Resume** | GPU silent stop → in-flight файлы навсегда в lost-state | `docs/canons/cron-safety-canons/canon-whisper-resume.md` |
| 5. **GC Cookie Refresh** | Cookie протух ночью → 12+ часов простоя phone resolve | `docs/canons/cron-safety-canons/canon-gc-cookie-auto-refresh.md` |
| 6. **Daily Health Check** | Cron упал и никто не узнал 24+ часа | `docs/canons/cron-safety-canons/canon-daily-health-check.md` |

**Каждый canon содержит:** TL;DR проблемы, готовый TypeScript код, schema migrations, test scenario.

---

## 📋 COMPLIANCE CHECKLIST PER STAGE (главное нововведение v3)

**Каждый Stage имеет explicit checklist что применить из канона. Skeleton `cron-master-pipeline.skeleton.ts` уже размечен ✅ комментариями — просто заполнить stubs.**

### STAGE 0: Preflight
- [ ] ✅ kill switch check (`/tmp/disable-cron-pipeline` → exit 0)
- [ ] ✅ Lockfile (canon-cron-lockfile)
- [ ] ✅ Disk cleanup (canon-disk-cleanup)
- [ ] ✅ Free space check > 10%
- [ ] ✅ GC cookie alive check + auto-refresh (canon-gc-cookie)

### STAGE 1: PBX adapter (`fetchHistorySince`)
- [ ] ✅ SSH `ConnectTimeout=20` (memory feedback-ssh-intelion-quirks)
- [ ] ✅ Idempotent (повторный запуск с тем же lastSync = 0 дублей)
- [ ] ✅ Exit 1 + Telegram alert при недоступности PBX
- [ ] ✅ Поля из `feedback-pbx-call-metadata-required.md`

### STAGE 2: Smart-download
- [ ] ✅ `sleep 3000ms` между файлами (1 IP rate limit)
- [ ] ✅ Exp backoff: max 5 retries (3s, 6s, 12s, 24s, 48s)
- [ ] ✅ `skipExisting` проверка
- [ ] ✅ Pickup stuck `transcriptionStatus='in_flight'` старше 30 мин (canon-whisper-resume)

### STAGE 3: Bin-packing FFD
- [ ] ✅ First Fit Decreasing алгоритм
- [ ] ✅ Cap = 30 минут совокупного аудио на bin
- [ ] ✅ Тест на 100 звонков: bins ≤ ceil(total / 30)
- [ ] ✅ Длинный (45+ мин) — отдельный bin

### STAGE 4: GPU auto-start
- [ ] ✅ `pending >= 10` чтобы стартовать (экономия)
- [ ] ✅ GPU cost cap pre-check (canon-gpu-cost-cap)
- [ ] ✅ Watchdog ping каждые 25 мин (memory feedback-intelion-auto-renewal-bug)
- [ ] ✅ Max-runtime safety 2 часа → kill
- [ ] ✅ Запись `GpuRun` для billing tracking

### STAGE 5: Whisper v2.13
- [ ] ✅ Mark batch in-flight в БД ДО transcribe (canon-whisper-resume)
- [ ] ✅ `.mp3` суффикс в files-list (memory feedback-orchestrate-tar-mp3-suffix-bug)
- [ ] ✅ `nohup setsid` для detachment (memory feedback-ssh-intelion-quirks)
- [ ] ✅ Whisper params PROB=0.20, GAP=3.0, VAD=off (memory feedback-pipeline-v213-final-settings)
- [ ] ✅ Hotwords из БД (имена МОПов + русские имена)
- [ ] ✅ Timeout safety 90 мин → kill pod, mark batch resume needed
- [ ] ✅ Ignore SSH exit 255 (memory feedback-ssh-intelion-quirks)

### STAGE 6: GPU auto-stop
- [ ] ✅ Stop через max 10 мин idle
- [ ] ✅ Запись `GpuRun.stoppedAt` для billing
- [ ] ✅ Log idle time

### STAGE 7: DeepSeek downstream
- [ ] ✅ concurrency=15
- [ ] ✅ Все 4 шага: detect-call-type, repair, script-score, insights
- [ ] ✅ Failure isolation per step (try/catch на каждый)
- [ ] ✅ **Whisper «хвост творцов» cleanup в repair step** (regex/fuzzy match на `Большое спасибо за просмотр / Не забудьте подписаться / От творцов / Продолжение следует`)

### STAGE 7.5: Phone resolve + Deal link (только GC tenants)
- [ ] ✅ `data-user-id` парсинг (commit `2731932`, НЕ `data-key`)
- [ ] ✅ Phone normalize last 10 digits
- [ ] ✅ GC rate limit sleep 1s между запросами
- [ ] ✅ При 302 → /login → trigger cookie refresh (canon-gc-cookie)
- [ ] ✅ Cookie regex check encrypted/plain

### STAGE 8: Upsert (Канон #8 — ОДИН проход)
- [ ] ✅ `audioUrl = onPBX URL` (НЕ GC fileservice)
- [ ] ✅ Все обязательные поля в одном UPSERT
- [ ] ✅ Phone resolve выполнен ДО upsert
- [ ] ✅ Тест: SELECT после upsert → 16+ полей не-null

### STAGE 9: Reconciliation 3-way (Канон #38)
- [ ] ✅ PBX count, DB count, CRM count (GC HTML scraping)
- [ ] ✅ Window = последние 24 часа (НЕ lastSync window)
- [ ] ✅ Запись в `ReconciliationCheck` table
- [ ] ✅ Если cookie expired → crmCount=null + degrade до 2-way

### STAGE 10: Telegram alert
- [ ] ✅ Формула: `discrepancy = |PBX_count - DB_count| / PBX_count`
- [ ] ✅ Alert если > 0.05
- [ ] ✅ Тело: tenant, window, 3 counts, top-5 missing UUIDs

### STAGE 11: UPDATE LastSync
- [ ] ✅ `timestamp = NOW()` в одной транзакции
- [ ] ✅ Если reconciliation упал → НЕ обновлять (повтор в след cycle)

### Crontab install (отдельный шаг)
- [ ] ✅ `crontab -l > ~/cron-backup-2026-04-29.txt` ДО install
- [ ] ✅ Kill switch `/tmp/disable-cron-pipeline` проверен в каждом скрипте
- [ ] ✅ Logrotate `/var/log/smart-analyze/cron.log`
- [ ] ✅ Daily health-check 04:00 AM (canon-daily-health-check)

---

## 🔥 Cron = ПОЛНАЯ ЦЕПОЧКА (11 stages)

```
Cron triggers (каждые 15 мин)
   ↓
Stage 0: Preflight — lockfile + disk cleanup + cookie alive check
   ↓
Stage 1: PBX API mongo_history.search — delta UUIDs новых звонков
   ↓
Stage 2: Smart-download MP3 (1 IP, sleep 3s, exp backoff, idempotent skip)
   ↓
Stage 3: Bin-packing FFD (max 30 мин/bin для GPU load balance)
   ↓
Stage 4: ⭐ AUTO-START GPU (Intelion API) если pending >= 10 + cost cap check
   ↓
Stage 5: Whisper v2.13 transcribe (per-channel, hotwords, watchdog, resume-ready)
   ↓
Stage 6: AUTO-STOP GPU когда очередь пуста (10 мин idle)
   ↓
Stage 7: DeepSeek downstream (callType, repair+хвост-strip, scriptScore, summary)
   ↓
Stage 7.5: Phone resolve + Deal.clientCrmId JOIN (GC tenants — Stage 3.5 logic)
   ↓
Stage 8: Upsert CallRecord — все поля ВКЛЮЧАЯ audioUrl=onPBX URL (Канон #8)
   ↓
Stage 9: Reconciliation — PBX vs CRM vs БД (3-way diff)
   ↓
Stage 10: Telegram alert если discrepancy > 0.05
   ↓
Stage 11: UPDATE LastSync.timestamp = NOW() (только если 9-10 успешны)
   ↓
Готово — UI первичная версия (transcript + scriptScore + базовые теги)
   ↓
Вечером: пользователь запускает /loop /enrich-calls
   ↓
   Master Enrich (Opus, 6 блоков + Block 7) обогащает что cron не довёл
   ↓
UI обновляется до полной enriched-версии (sample-1, sample-2, sample-3 как эталоны)
```

---

## 🗺️ CRON vs ENRICH — какие поля кто заполняет

**Это критично для понимания «дашборд РОПа покажет всё или половину».**

### Cron заполняет (БАЗОВЫЕ ~30 полей)

| Категория | Поля | Откуда |
|---|---|---|
| Идентификация | `pbxUuid`, `managerId`, `dealId`, `clientPhone`, `gcContactId` | PBX + Stage 3.5 |
| Запись | `transcript`, `transcriptRepaired`, `audioUrl` | Whisper v2.13 |
| Метаданные звонка | `duration`, `userTalkTime`, `startStamp`, `gateway`, `hangupCause`, `pbxMeta`, `direction` | PBX |
| DeepSeek базовые | `callType`, `scriptScore`, `scriptDetails`, `callSummary`, `sentiment`, `objections`, `hotLead`, `hotLeadReason` | DeepSeek |
| State | `transcriptionStatus`, `retryCount` | own logic |

### `/enrich-calls` заполняет (ENRICH-ONLY ~30 полей — критично для Канон #37)

| Категория | Поля | Влияние на Канон #37 |
|---|---|---|
| 🔴 callOutcome | `callOutcome`, `hadRealConversation`, `outcome` | **БЕЗ ЭТОГО НЕТ НДЗ/АО/реальные счётчиков** (анкета п.9.2-9.4) |
| Классификация | `isCurator`, `isFirstLine`, `possibleDuplicate` | Исключение кураторов из метрик (анкета п.2) |
| Script compliance | `scriptScorePct`, `criticalErrors` | Drill-down РОПа «что МОП пропустила» |
| Психология | `psychTriggers`, `clientReaction`, `managerStyle`, `keyClientPhrases`, `clientEmotionPeaks` | Дифференциирующий слой |
| Контент | `cleanedTranscript`, `cleanupNotes`, `criticalDialogMoments`, `managerWeakSpot` | Разбор звонка в UI |
| РОП-инсайт | `ropInsight`, `nextStepRecommendation`, `enrichedTags`, `purchaseProbability` | Главное чем продаём |
| Block 7 | `extractedCommitments`, `commitmentsCount`, `commitmentsTracked` | Promise-keeping killer feature |

### Архитектурное следствие для UI

```
Cron-проход → CallRecord with enrichmentStatus = NULL
   ↓
UI dashboard:
  IF enrichmentStatus IS NULL:
    badge "📊 базовое (transcript+scriptScore)"
    показать: transcript, scriptScore, callType (DeepSeek), summary
  IF enrichmentStatus = 'enriched':
    badge "✅ полное (Master Enrich)"
    показать: всё включая ropInsight, criticalErrors, commitments

   ↓
Вечерний /loop /enrich-calls подбирает все NULL → обогащает → UI обновляется
```

---

## 🟢 8 БЛОКОВ МЕТАДАННЫХ (что и куда пишется)

### БЛОК 1 — onPBX API (cron каждые 15 мин)

**Endpoint:** `POST https://api.onlinepbx.ru/{domain}/mongo_history/search.json` | **Auth:** apiKey (от Тани)

| Поле PBX | Куда в БД | Зачем |
|---|---|---|
| `uuid` | `CallRecord.pbxUuid` | Primary key, дедуп |
| `start_stamp` (UNIX) | `CallRecord.startStamp` | Канон #37 Block 5 trend |
| `end_stamp` | вычислить duration | Длительность |
| `duration` | `CallRecord.duration` | Канон #37 Block 1 — avg длина |
| `user_talk_time` | `CallRecord.userTalkTime` | НДЗ детектор (если 0 → no_answer) |
| `caller_id_number` | `CallRecord.clientPhone` (incoming) или `Manager.ext` (outgoing) | Phone matching |
| `destination_number` | `CallRecord.clientPhone` (outgoing) или `Manager.ext` (incoming) | То же |
| `direction` | `CallRecord.direction` | INCOMING / OUTGOING |
| `hangup_cause` | `CallRecord.hangupCause` | NORMAL_CLEARING / NO_ANSWER / USER_BUSY → callOutcome |
| `gateway` | `CallRecord.gateway` | Cost per SIM |
| `record_url` (или generated `/recording/{uuid}.mp3`) | `CallRecord.audioUrl` | Прямая ссылка для UI player (НЕ GC) |
| `manager_extension` | `CallRecord.managerExt` | Linkage к Manager через internalExtension |
| `quality_score` | `CallRecord.qualityScore` | Качество связи |
| Весь raw JSON | `CallRecord.pbxMeta` (jsonb) | Источник правды для re-process |

**Дополнительные endpoints onPBX:**
- `/user/get.json` — список МОПов с extensions → Manager (имя ↔ ext)
- `/mongo_history/recording_link.json?uuid=X` — signed URL если нужен
- `/queues.json` — линии (для группировки по отделам)

### БЛОК 2 — GetCourse HTML scraping

**Auth:** `gcCookie` из CrmConfig (encrypted aes-256-gcm или plain) | **Subdomain:** `cc.subdomain` (для diva = `web.diva.school`)

#### 2.1 Phone → user_id (Stage 3.5)
- **Endpoint:** `GET /pl/user/contact/index?ContactSearch[phone]={phone}`
- Парсить `data-user-id="{N}"` (НЕ `data-key`)
- → `CallRecord.gcContactId = N`

#### 2.2 Список звонков (Reconciliation Канон #38)
- **Endpoint:** `GET /pl/teach/control/stream/calls?date_from=X&date_to=Y`
- UUIDs всех звонков GC за окно
- 3-way diff: PBX vs CRM vs БД

#### 2.3 Список Deal'ов клиента
- **Endpoint:** `GET /pl/sales/deal/index?DealSearch[date_from]=X&date_to=Y`
- `data-deal-id` + `data-user-id` per row → `Deal.crmId` + `Deal.clientCrmId`
- Связка `CallRecord.dealId` через JOIN `Deal ON clientCrmId = gcContactId`

#### 2.4 Карточка Deal (для clientCrmId если listing не покрыл)
- **Endpoint:** `GET /sales/control/deal/update/id/{dealCrmId}`
- `data-user-id` per page → `Deal.clientCrmId`
- Также: amount, status, manager

#### 2.5 Список менеджеров tenant
- **Endpoint:** `GET /pl/teach/control/users/index`
- Имя ↔ user_id GC (для linkage `Manager.crmId`)

| Поле GC | Куда в БД | Зачем |
|---|---|---|
| GC `data-user-id` (контакт) | `CallRecord.gcContactId` | Канон #37 Block 3 deep-link на клиента |
| GC `data-deal-id` (URL id) | `Deal.crmId` | Deep-link на сделку |
| `Deal.clientCrmId` | `Deal.clientCrmId` | JOIN bridge phone↔deal |
| Deal `title` / `amount` / `status` | `Deal.title/amount/status` | Карточка клиента UI |
| Manager GC `user_id` | `Manager.crmId` | Linkage МОП ↔ его GC аккаунт |
| `clientName` (из контакта) | `CallRecord.clientName` | UI Drill-down |

### БЛОК 3 — Whisper v2.13 (после download MP3)

| Field | Куда |
|---|---|
| `transcript` (raw, channel-first merge) | `CallRecord.transcript` |
| `transcript_raw` (per-channel words+segments) | `CallRecord.pbxMeta.transcript_raw` |
| `mode` (`stereo_channel_first_v213`) | `CallRecord.pbxMeta.mode` |
| Качественные индикаторы (`avg_logprob`) | `CallRecord.qualityScore` |

### БЛОК 4 — DeepSeek downstream (после Whisper)

#### 4.1 detect-call-type
- → `CallRecord.callType` (REAL / VOICEMAIL / IVR / HUNG_UP / NO_ANSWER)

#### 4.2 repair-transcripts (per-tenant glossary + хвост-strip)
- → `CallRecord.transcriptRepaired` (имена/термины поправлены, Whisper-галлюцинации удалены)

#### 4.3 score-script-compliance (11 этапов diva)
- → `CallRecord.scriptScore` (int)
- → `CallRecord.scriptDetails` (jsonb per-stage)

#### 4.4 analyze-bundle (insights)
- → `CallRecord.callSummary` (1-2 строки)
- → `CallRecord.sentiment` (positive/negative/neutral)
- → `CallRecord.objections` (jsonb массив)
- → `CallRecord.hotLead` (bool)
- → `CallRecord.hotLeadReason` (текст)

### БЛОК 5 — Master Enrich (Opus в подписке `/enrich-calls`)

**Это финальный слой — превращает всё выше в полную карточку. 6 блоков + Block 7:**

| Поле | Тип | Откуда |
|---|---|---|
| `enrichmentStatus` | text | pending / enriched / failed |
| `enrichedAt` | timestamp | NOW() |
| `enrichedBy` | text | 'claude-opus-4-7-v6' |
| `callType` (Master ре-классификация) | text | enum квалификация_лида/продажи_новый/win_back/upsell/NPS/тех_поддержка/курьер |
| `callOutcome` | text | real_conversation / no_answer / voicemail / hung_up / ivr / technical_issue / no_speech_or_silence |
| `hadRealConversation` | bool | true если callOutcome=real_conversation |
| `outcome` | text | closed_won / closed_lost / scheduled_callback / objection_unresolved / no_offer_made |
| `isCurator` | bool | match по фамилиям из анкеты раздел 2 |
| `isFirstLine` | bool | Жихарев/Чернышова для diva |
| `possibleDuplicate` | bool | SQL: phone+tenant duplicate check |
| `scriptScorePct` | float | scriptScore / scriptScoreMax |
| `criticalErrors` | jsonb | array enum (6 типов diva) |
| `psychTriggers` | jsonb | `{positive: [{time, technique, effect}], missed: [{trigger, why_missed, what_to_do}]}` |
| `clientReaction` | text | warm / cold / engaged / resistant / sarcastic / confused / silent |
| `managerStyle` | text | soft_seller / strong_closer / empathic / aggressive / neutral / technical |
| `clientEmotionPeaks` | jsonb | array `[{time, emotion}]` |
| `keyClientPhrases` | jsonb | array цитат |
| `cleanedTranscript` | text | очищенный transcript |
| `cleanupNotes` | jsonb | что было удалено |
| `managerWeakSpot` | text | 1 фраза для drill-down |
| `criticalDialogMoments` | jsonb | array `[{time_range, what_happened, what_should_be}]` |
| `ropInsight` | text | 5 пунктов action items для РОПа |
| `enrichedTags` | jsonb | array UI badges |
| `nextStepRecommendation` | text | 4 шага МОПу с эмодзи 📲 📎 🗓️ 💌 |
| `purchaseProbability` | int 0-100 | обоснованная вероятность |
| `gcCallCardUrl` | text | вычислено из `dealCrmId` / `gcContactId` + subdomain |
| `gcDeepLinkType` | text | call_card / contact_fallback |
| `extractedCommitments` | jsonb | array `[{speaker, quote, timestamp, action, deadline, target, evidence}]` |
| `commitmentsCount` | int | length |
| `commitmentsTracked` | bool | false (для cron sync в CRM tasks) |

### БЛОК 6 — Manager linkage (lookup в БД при upsert)

| Источник | Куда |
|---|---|
| onPBX `manager_extension` | match с `Manager.internalExtension` → `CallRecord.managerId` |
| GC `user_id` менеджера | match с `Manager.crmId` → `Manager.id` |
| `Manager.name` | для UI «МОП Ольга», agg per-МОП |
| `Manager.role` | curator / mop / first_line (для фильтров) |

### БЛОК 7 — LastSync + ReconciliationCheck (state tables)

#### LastSync (cron state)
| Поле | Описание |
|---|---|
| `tenantId` | |
| `provider` | `PBX_ONPBX` / `PBX_SIPUNI` / `CRM_GC` / `CRM_AMOCRM` |
| `lastTimestamp` | когда последний sync прошёл |
| `lastUuid` | последний обработанный звонок |
| `lastError` | если был fail |

#### ReconciliationCheck (Канон #38)
| Поле | Зачем |
|---|---|
| `tenantId, checkedAt` | Когда проверка |
| `windowStart, windowEnd` | Окно сверки (last 24h) |
| `pbxCount` | Сколько звонков в onPBX за окно |
| `dbCount` | Сколько в нашей БД |
| `crmCount` | Сколько в GC ленте звонков |
| `missingInDb` (jsonb) | UUIDs что есть в PBX но нет в БД |
| `missingInCrm` (jsonb) | UUIDs что в PBX но не в GC |
| `duplicates` (jsonb) | UUIDs с >1 записью в БД |
| `discrepancyPct` | Формула alert > 0.05 |
| `alertSent` | bool (anti-spam) |

### БЛОК 8 — Канон #37 Дашборд РОПа (что отображается из enriched)

#### Block 1 — Daily Activity per МОП (metadata)
- `Manager.name` (агрегат)
- `count(CallRecord)` per `managerId` per day
- `count(callOutcome='no_answer')` — НДЗ
- `count(callOutcome='voicemail')` — автоответчики
- `count(callOutcome='real_conversation')` — реальные
- `avg(userTalkTime)` где real

#### Block 2 — Quality score per МОП
- `avg(scriptScore)` per managerId
- `scriptScorePct` — relative top/bottom 30%

#### Block 3 — Drill-down (top-10 худших за день per МОП)
- `cleanedTranscript`, `summary`, `managerWeakSpot`, `criticalErrors`, `ropInsight`

#### Block 4 — Chat-style ask
- DeepSeek читает enriched cards: `psychTriggers`, `managerStyle`, `criticalErrors`, `keyClientPhrases`

#### Block 5 — Оценка отдела
- avg per `tenantId` НЕ-кураторов
- 7d / 30d trend

#### Block 6 (новый) — Невыполненные обещания (Block 7 derivative)
- `WHERE commitmentsTracked = true AND deadline < NOW() AND completed = false`
- Топ-5 МОПов с просрочкой

#### Advanced tab
- `startStamp` distribution → лучшее время для звонка
- Re-call patterns per `clientPhone` + startStamp ordering
- `gateway` aggregation → cost per SIM
- `clientReaction`, `managerStyle` → tone analysis

---

## 🌐 GC SYNC ARCHITECTURE — 5 каналов синка

GC = основная CRM для diva. У нас 5 отдельных каналов синка, каждый со своими рисками.

| # | Канал | Что | Как | Состояние | Главный риск |
|---|---|---|---|---|---|
| 1 | Phone → gcContactId | резолв phone в GC user_id для каждого звонка | HTTP `/pl/user/contact/index?ContactSearch[phone]=X`, парсинг `data-user-id` | ✅ 99.8% (commit `2731932`) | Cookie expires |
| 2 | Deal sync | все Deals → `Deal.crmId` + `Deal.clientCrmId` | `/pl/sales/deal/index` paginated HTML | ✅ 99.99% (`gc-sync-v2.ts:482`) | Cookie expires |
| 3 | dealId link | для CallRecord с gcContactId → `Deal.id` через JOIN на `clientCrmId` | чистый SQL | ✅ 82.2% (предельно по данным) | Низкий |
| 4 | Commitments → GC tasks | Block 7 → создать GC tasks через HTML POST | reverse-engineered HTML form | 🔴 НЕ ПОСТРОЕН (Phase 2) | Anti-bot, CSRF expires |
| 5 | Reconciliation count | сверка PBX vs DB vs GC count'ов за 24ч | GC HTML scrape за date_range | 🔴 НЕ ПОСТРОЕН | Cookie + heavy query |

**Common point of failure:** GC cookie. Каналы 1, 2, 4, 5 — все ломаются одновременно когда cookie протух. **Решение:** `canon-gc-cookie-auto-refresh.md` (auto Playwright refresh каждый час).

---

## 🛑 Edge-cases типы A-F (как Whisper-pipeline + enrich классифицируют)

| Тип | Признак | callOutcome | Что заполняет cron + enrich |
|---|---|---|---|
| 🔇 **A: NO_SPEECH** | `transcript ≤ 100 chars` (любое содержимое — placeholder / Whisper-галлюцинация / шум) | `no_speech_or_silence` | hadRealConversation: false, scriptScore: null, tags: [no_speech, ндз] |
| 📞 **B: VOICEMAIL/IVR** | Только МОП реплики, фразы «вызываемый абонент не отвечает», «оставайтесь на линии» | `voicemail` | tags: [voicemail, ндз], ropInsight: «контролировать частоту попыток» |
| ☎️ **C: HUNG_UP** | < 30 сек, клиент сбросил после «Алло» | `hung_up` или `no_answer` | tags: [hung_up, ндз], ropInsight: «проверить эффективность времени звонков» |
| 📡 **D: TECHNICAL** | Повторяющиеся «Алло, слышите?», «плохо слышно» | `technical_issue` | tags: [тех_проблема, ндз], ropInsight: «проверить гарнитуру МОПа» — red flag |
| ⏰ **E: SHORT_RESCHEDULE** | 30-60 сек, клиент: «не сейчас / занят / перезвоните» | `real_conversation` | outcome: scheduled_callback, scriptScore 1-2/9, без criticalErrors |
| 💬 **F: NORMAL** | ≥ 60 сек, диалог с темами | `real_conversation` | Полный 6-блочный + Block 7 enrich (sample-1, sample-2, sample-3 как эталоны) |

**Все edge-case'ы:**
- ✅ Получают `callOutcome`, `summary`, `ropInsight` для отчёта РОПу
- ✅ Засчитываются как НДЗ в агрегатах Канон #37 Block 1 («Сколько НДЗ?»)
- ❌ НЕ оцениваются по скрипту (`scriptScore = null`) — нечего оценивать
- ❌ НЕ имеют психологии (`psychTriggers` пустые)
- ✅ Тип D — отдельный red flag для РОПа: «топ-5 МОПов с TECHNICAL_ISSUE > 10% звонков»

---

## 🔑 Tribal knowledge — gotchas (НЕ повторять, проверено сегодня)

1. **`Tenant.subdomain` НЕ существует** — subdomain в `CrmConfig.subdomain` (probed 29 апр)
2. **`Deal.clientCrmId`** для diva уже заполнен 99.99% (137974/137992) — но `gc-sync-v2.ts:482` обязателен для будущих syncов
3. **Phone normalize** — последние 10 цифр (`destination_number.replace(/\D/g, "").slice(-10)`)
4. **GC endpoint `/pl/api/account/users` требует API key** которого у нас нет — использовать HTML scraping `/pl/user/contact/index?ContactSearch[phone]=X` (cookie из `CrmConfig.gcCookie`)
5. **GC HTML — парсить `data-user-id`** (реальный user_id), НЕ `data-key` (это row index Yii2). Фикс в коммите `2731932`
6. **Cookie может быть encrypted** (`iv:tag:enc`) или plain — regex `/^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/i` перед `decrypt()`
7. **Intelion GPU silently stops через 60 мин** — watchdog обязателен (memory + canon-gpu-cost-cap)
8. **GC sync отдает только обновлённые deals в date_range** (`created_at` в их БД ≠ нашему `createdAt`) — per-user filter не работает, только per-deal page fetch
9. **MCP `soldout-db`** — это **другая БД** (WB-аналитика), там нет SalesGuru таблиц
10. **Whisper «хвост творцов»** — известная галлюцинация в конце audio («Большое спасибо за просмотр / От творцов / Продолжение следует»). Strip в repair step Stage 7

---

## 🛡️ GPU защита (4 memory canon'a — большой опыт шишек)

1. **`feedback-intelion-auto-renewal-bug.md`** — Intelion silent stop через 60 мин → watchdog ping каждые 25 мин (canon-gpu-cost-cap дополняет cost тэргетингом)
2. **`feedback-ssh-intelion-quirks.md`** — SSH banner timeout (`-o ConnectTimeout=20`), exit 255 не ошибка, `nohup setsid` для detachment
3. **`feedback-orchestrate-tar-mp3-suffix-bug.md`** — `.mp3` суффикс в files-list.txt обязателен
4. **`feedback-pipeline-v213-final-settings.md`** — Whisper params PROB=0.20, GAP=3.0, HOST_PAUSE_MIN=1.0, VAD=off — НЕ ТРОГАТЬ (калиброваны на 60 файлах)

### Anti-patterns (ABSOLUTELY DON'T)

❌ Запускать GPU 24/7 — пустая трата денег
❌ Запускать GPU без watchdog — тихо сломается через час
❌ Использовать GC fileservice URLs для audioUrl — протухают
❌ Скачивать audio в нашу инфру — лишняя работа, прямой URL onPBX лучше
❌ Crontab install ДО успешного Backfill 28.04 — двойная обработка / discrepancy спам
❌ Запускать cron-master-pipeline без lockfile — race condition гарантирована
❌ Cron-скрипт без disk cleanup — диск переполнится за 5-7 дней
❌ GPU pod без cost cap — runaway billing $50-100/ночь
❌ Whisper transcribe без in_flight tracking — потерянные файлы при silent stop
❌ Полагаться на ручной cookie refresh — простой 12-24 часов

---

## 🌟 Killer features которые нужно сохранить в сознании

1. **Канон #8** — все поля CallRecord в **одном upsert**. Phone resolve **до** upsert.
2. **Канон #37** — РОП покупает контроль качества разговоров, не BI на CRM.
3. **Канон #38** — sync + reconcile в **одном проходе**.
4. **Master Enrich Block 7** — automatically promise tracking. **Killer feature** vs Roistat/CoMagic.
5. **Whisper baseline limits** — late-start ~13%, echo bleed МОП↔КЛИЕНТ. Это **известный лимит**, проходят через Master Enrich edge-case handling (Тип A).

---

## ✅ Что уже готово (не делать заново)

- [x] Pipeline v2.13 (Whisper + repair) на сервере
- [x] Stage 3.5 cron worker (`scripts/cron-stage35-link-fresh-calls.ts`) — **эталон структуры**
- [x] Master Enrich schema в БД (60 колонок CallRecord включая Block 7)
- [x] Skill `/enrich-calls` v6 с auto-loop + edge-case + ScheduleWakeup
- [x] 2 эталона enriched cards: `sample-1-soft-seller-no-offer.md`, `sample-2-empathic-win-back-brackets.md`
- [x] Канон #37 (дашборд РОПа) doc
- [x] Канон #38 (reconciliation) doc
- [x] Phone resolve script (`resolve-phones-via-gc.ts`) — фикс `data-user-id` (commit `2731932`)
- [x] Deal.clientCrmId backfill 99.99% для diva
- [x] gc-sync-v2.ts:482 — sync пишет clientCrmId автоматом
- [x] Все memory canon (Intelion bugs, SSH quirks, tar suffix, pipeline params)
- [x] **5 новых safety canons (v3):** lockfile, disk-cleanup, gpu-cost-cap, whisper-resume, gc-cookie-refresh, daily-health-check
- [x] **Skeleton `cron-master-pipeline.skeleton.ts`** с размеченными compliance ✅ checks

---

## 📝 Что НЕ готово (делать в новой сессии)

### ЗАДАЧА 0 — Подготовка (1 час)
- [ ] `scripts/backfill-pbx-audio-urls.ts` — 6126 записей, ~15 мин на прогон
- [ ] `scripts/setup-gc-credentials.ts` — manual prompt + encrypt → `Tenant.gcCredentials` (для cookie auto-refresh)
- [ ] Проверить test scenario `canon-gc-cookie-auto-refresh.md` (refresh работает)
- [ ] Inventory existing scripts что переиспользовать

### ЗАДАЧА 1 — Backfill 28.04 (manual, ОДИН раз)
- [ ] `scripts/manual-backfill-2026-04-28.ts` — window до `2026-04-28 23:59:59 МСК`
- [ ] Прогнать для diva → проверить count(БД 28.04) ≈ count(PBX 28.04)
- [ ] Только после успеха — переход к ЗАДАЧЕ 2

### ЗАДАЧА 2 — Master Cron (Этапы 1-11) — заполнить skeleton
- [ ] `scripts/cron-master-pipeline.ts` (на основе skeleton + DoD)
- [ ] `scripts/lib/cron-lock.ts` (canon-cron-lockfile)
- [ ] `scripts/lib/disk-cleanup.ts` (canon-disk-cleanup)
- [ ] `scripts/lib/gpu-cost-tracker.ts` (canon-gpu-cost-cap)
- [ ] `scripts/cron-gc-cookie-check.ts` (canon-gc-cookie-auto-refresh)
- [ ] `scripts/daily-health-check.ts` (canon-daily-health-check)
- [ ] Per-PBX adapter pattern (onPBX/Sipuni/МегаПБХ)
- [ ] Schema migrations: `LastSync`, `ReconciliationCheck`, `GpuRun`, `HealthCheckRun`, `Tenant.gcCredentials`, `Tenant.dailyGpuCapUsd`, `CallRecord.transcriptionStatus`, `CallRecord.retryCount`

### ЗАДАЧА 3 — Установка
- [ ] `crontab -l > backup` ДО install
- [ ] Crontab на prod (4 расписания: pipeline × 4 tenant + cookie-check + health-check + cleanup)
- [ ] Kill switch + logrotate
- [ ] `npx playwright install chromium` в Docker image (для cookie refresh)

### ЗАДАЧА 4 — E2E тест
- [ ] Тестовый звонок → 15 мин → /quality
- [ ] 3 cron-цикла без discrepancy
- [ ] Прогнать все test scenarios из 5 canons + daily-health-check

---

## 📡 Crontab (после успешного Backfill 28.04)

```cron
# /etc/cron.d/salesguru-sync — поставить ПОСЛЕ Backfill 28.04 success
# kill switch check happens INSIDE each script

# Master pipeline per tenant (15 мин)
*/15 * * * * cd /root/smart-analyze && tsx scripts/cron-master-pipeline.ts diva-school   >> /var/log/smart-analyze/cron.log 2>&1
*/15 * * * * cd /root/smart-analyze && tsx scripts/cron-master-pipeline.ts vastu         >> /var/log/smart-analyze/cron.log 2>&1
*/15 * * * * cd /root/smart-analyze && tsx scripts/cron-master-pipeline.ts reklama       >> /var/log/smart-analyze/cron.log 2>&1
*/30 * * * * cd /root/smart-analyze && tsx scripts/cron-master-pipeline.ts coral         >> /var/log/smart-analyze/cron.log 2>&1

# GC cookie health (каждый час)
0 * * * *    cd /root/smart-analyze && tsx scripts/cron-gc-cookie-check.ts               >> /var/log/smart-analyze/gc-cookie.log 2>&1

# Disk cleanup aggressive (3:00 AM)
0 3 * * *    cd /root/smart-analyze && tsx scripts/daily-disk-cleanup.ts                 >> /var/log/smart-analyze/cleanup.log 2>&1

# Daily health check (4:00 AM)
0 4 * * *    cd /root/smart-analyze && tsx scripts/daily-health-check.ts                 >> /var/log/smart-analyze/health.log 2>&1
```

---

## 🛡️ ROLLBACK READY (выполнить ДО первого запуска cron)

| Что | Команда |
|---|---|
| Backup crontab | `crontab -l > ~/cron-backup-2026-04-29.txt` |
| Kill switch | все скрипты начинаются с `if [ -f /tmp/disable-cron-pipeline ]; then exit 0; fi` |
| Disable cron быстро | `touch /tmp/disable-cron-pipeline` (без редактирования crontab) |
| Re-enable | `rm /tmp/disable-cron-pipeline` |
| Полный rollback | `crontab ~/cron-backup-2026-04-29.txt` |
| Backfill rollback | `UPDATE LastSync SET timestamp = '<previous>' WHERE tenantId='cmo4qkb1...'` |

---

## 📐 КЛЮЧЕВЫЕ ФОРМУЛЫ (явно, не «приблизительно»)

### Bin-packing FFD (Stage 3)
```python
def bin_pack_first_fit_decreasing(calls, max_bin_minutes=30):
    sorted_calls = sorted(calls, key=lambda c: c.duration, reverse=True)
    bins = []
    for call in sorted_calls:
        placed = False
        for b in bins:
            if sum(c.duration for c in b) + call.duration <= max_bin_minutes * 60:
                b.append(call)
                placed = True
                break
        if not placed:
            bins.append([call])
    return bins  # len(bins) = сколько GPU pods нужно
```

### Discrepancy (Stage 10)
```python
def discrepancy_pct(pbx_count, db_count):
    if pbx_count == 0:
        return 0.0
    return abs(pbx_count - db_count) / pbx_count
# Alert if discrepancy_pct(...) > 0.05
```

### Backfill window (28.04 фиксировано)
```python
from datetime import datetime
import pytz
MSK = pytz.timezone('Europe/Moscow')

BACKFILL_FROM = (await db.callRecord.findFirst({
    where: {tenantId: 'cmo4qkb1000000jo432rh0l3u'},
    orderBy: {startStamp: 'desc'},
    select: {startStamp: True}
})).startStamp  # ~27.04 evening

BACKFILL_TO = MSK.localize(datetime(2026, 4, 28, 23, 59, 59))
# фиксировано — НЕ now()
```

### Whisper «хвост творцов» strip (Stage 7 repair)
```python
HALLUCINATION_PATTERNS = [
    r"большое спасибо за просмотр",
    r"не забудьте подписаться",
    r"от творцов проекта",
    r"продолжение следует",
    r"субтитры подготовлены",
    r"до встречи в следующем",
]

def strip_whisper_tail(transcript):
    lines = transcript.split('\n')
    while lines and any(re.search(p, lines[-1], re.I) for p in HALLUCINATION_PATTERNS):
        lines.pop()
    return '\n'.join(lines)
```

---

## ✅ Success criteria (final, перед closing сессии)

- [ ] `scripts/backfill-pbx-audio-urls.ts` пройден — все 6126 имеют onPBX URL
- [ ] **Backfill 28.04 успешен** — count(БД 28.04) ≈ count(PBX 28.04), discrepancy < 5%
- [ ] `cron-master-pipeline.ts` создан + DoD каждого этапа пройден
- [ ] PBX adapter для onPBX/Sipuni унифицирован
- [ ] Schema migrations все мигрированы (`LastSync`, `ReconciliationCheck`, `GpuRun`, `HealthCheckRun`, etc)
- [ ] **Все 5 safety canons имплементированы** (lockfile, disk-cleanup, gpu-cost-cap, whisper-resume, gc-cookie-refresh)
- [ ] **Daily health-check работает** (canon-daily-health-check)
- [ ] GPU auto-start с watchdog (нет silent stops в тесте)
- [ ] **`audioUrl = onPBX URL`** во всех новых записях (тест: SELECT)
- [ ] Reconciliation 3-way работает, alert при discrepancy > 0.05
- [ ] Crontab активен на prod + kill switch проверен
- [ ] Тестовый звонок виден в /quality через 15 мин
- [ ] 3 cron-цикла подряд без discrepancy
- [ ] **Прогнаны все test scenarios** из 5 canons + daily-health-check (lockfile race, disk full, GPU silent stop, cookie expired, stuck in_flight)

---

## 📚 По требованию — индекс файлов по этапам

Читай только когда коснёшься соответствующего этапа.

### Для Этапов 1-2 (PBX/sync):
- `~/.claude/projects/-Users-kirillmalahov/memory/feedback-pbx-call-metadata-required.md`

### Для Этапов 4-6 (GPU):
- `~/.claude/projects/-Users-kirillmalahov/memory/feedback-intelion-auto-renewal-bug.md`
- `~/.claude/projects/-Users-kirillmalahov/memory/feedback-ssh-intelion-quirks.md`
- `~/.claude/projects/-Users-kirillmalahov/memory/feedback-orchestrate-tar-mp3-suffix-bug.md`
- `docs/canons/cron-safety-canons/canon-gpu-cost-cap.md`
- `docs/canons/cron-safety-canons/canon-whisper-resume.md`

### Для Этапа 5 (Whisper):
- `~/.claude/projects/-Users-kirillmalahov/memory/feedback-pipeline-v213-final-settings.md`
- `scripts/intelion-transcribe-v2.py`

### Для Этапа 7.5 (Phone resolve / GC):
- `~/.claude/projects/-Users-kirillmalahov/memory/feedback-upsert-call-canon8-mandatory.md`
- `scripts/resolve-phones-via-gc.ts`
- `docs/canons/cron-safety-canons/canon-gc-cookie-auto-refresh.md`

### Для Этапов 9-10 (Reconciliation/alerts):
- `docs/canons/canon-38-reconciliation-in-cron.md`
- `~/.claude/projects/-Users-kirillmalahov/memory/feedback-canon-38-daily-reconciliation.md`

### Для общего контекста:
- `~/.claude/projects/-Users-kirillmalahov/memory/feedback-pipeline-canon-with-opus-enrich.md`

### Для Master Enrich интеграции (Block 7):
- `~/.claude/projects/-Users-kirillmalahov/memory/feedback-master-enrich-canon.md`
- `docs/canons/canon-master-enrich-card.md`
- `docs/canons/master-enrich-samples/sample-1-soft-seller-no-offer.md`
- `docs/canons/master-enrich-samples/sample-2-empathic-win-back-brackets.md`

### Для Канон #37 (UI consumer):
- `~/.claude/projects/-Users-kirillmalahov/memory/feedback-rop-dashboard-minimum.md`
- `docs/canons/canon-37-rop-dashboard-minimum.md`

### Для Safety canons (cron-master-pipeline):
- `docs/canons/cron-safety-canons/canon-cron-lockfile.md`
- `docs/canons/cron-safety-canons/canon-disk-cleanup.md`
- `docs/canons/cron-safety-canons/canon-gpu-cost-cap.md`
- `docs/canons/cron-safety-canons/canon-whisper-resume.md`
- `docs/canons/cron-safety-canons/canon-gc-cookie-auto-refresh.md`
- `docs/canons/cron-safety-canons/canon-daily-health-check.md`

---

## 📝 Коммитить как

Каждый этап = отдельный commit с conventional message:
```
feat(cron-lib): cron-lock + disk-cleanup + gpu-cost-tracker
feat(cron): PBX adapter pattern (Этап 1)
feat(cron): smart-download + bin-packing FFD (Этапы 2-3)
feat(cron): GPU auto-start with cost cap + watchdog (Этапы 4-6)
feat(cron): DeepSeek downstream + хвост-strip + Stage 3.5 (Этапы 7-7.5)
feat(cron): upsert with onPBX audioUrl (Этап 8)
feat(reconciliation): 3-way diff + Telegram alert (Этапы 9-10)
feat(cron): master-pipeline orchestrator + LastSync (Этап 11)
feat(cron): GC cookie auto-refresh via Playwright
feat(cron): daily-health-check
chore(backfill): manual run for 2026-04-28 (ЗАДАЧА 1 success)
ops(cron): crontab install + kill switch + logrotate + playwright in Docker
```

---

## 🚀 Готов к старту

В новой сессии копируй короткий промпт сверху → STEP 0 (3 Read'а) → resume в первом сообщении (4 строки) → следуй handoff'у дословно.

**Текущая сессия (где это писалось):** оставить открытой как «штаб». **НЕ закрывать пока новая сессия не доложит «Backfill 28.04 success».**

Удачи 🚀
