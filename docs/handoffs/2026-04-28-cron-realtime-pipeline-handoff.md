# 🚀 HANDOFF — Cron Auto-Update + Real-Time Pipeline (для новой сессии)

**Создан:** 2026-04-28
**Куда копировать:** новая сессия Claude Code в `/Users/kirillmalahov/smart-analyze`
**Цель сессии:** реализовать боевой режим — cron автообновление по всем 5 клиентам + встроенная reconciliation

---

## 📋 Промпт для копирования в новую сессию

> Привет. Я хочу реализовать **боевой режим cron auto-update** для SalesGuru pipeline. Контекст уже зафиксирован в memory + repo. Прочитай в таком порядке:
>
> **Memory (читать по очереди):**
> 1. `feedback-pipeline-canon-with-opus-enrich.md` — 5-стадийный pipeline (Whisper → v2.13 → repair → Stage 3.5 → Opus enrich)
> 2. `feedback-onboarding-and-daily-enrich-flow.md` — два режима работы (backfill / daily)
> 3. `feedback-canon-38-daily-reconciliation.md` — сверка PBX↔CRM↔БД встроена в cron
> 4. `feedback-master-enrich-canon.md` — schema enriched call card (6 блоков + Block 7)
> 5. `feedback-pipeline-v213-final-settings.md` — params текущего pipeline + planned hotwords
> 6. `feedback-pbx-call-metadata-required.md` — какие поля сохранять в CallRecord (canon #8)
> 7. `feedback-upsert-call-canon8-mandatory.md` — phone matching через GC API
> 8. `feedback-rop-dashboard-minimum.md` — Канон #37 (что показывать в UI)
>
> **Doc canons (в проекте):**
> - `docs/canons/canon-38-reconciliation-in-cron.md` — компиляция reconciliation
> - `docs/canons/canon-37-rop-dashboard-minimum.md`
> - `docs/canons/canon-master-enrich-card.md`
> - `docs/plans/2026-04-28-pipeline-v213-roadmap.md` — что уже сделано / pending
> - `docs/plans/2026-04-28-promise-keeping-layer.md`
>
> **Существующие скрипты:**
> - `scripts/cron-stage35-link-fresh-calls.ts` — Stage 3.5 уже готов (phone resolve + dealId link)
> - `scripts/resolve-phones-via-gc.ts` — phone resolve via GC HTML scraping
> - `scripts/intelion-transcribe-v2.py` — Whisper pipeline v2.13
> - `scripts/cron-amo-refresh-all.ts` — токены amoCRM
>
> **Состояние БД (на 2026-04-28):**
> - 6126 CallRecord для diva (tenant `cmo4qkb1000000jo432rh0l3u`)
> - Deal.clientCrmId заполнен 99.99% (137974/137992) — sync fix `gc-sync-v2.ts:482`
> - GC sync теперь автоматически пишет clientCrmId
> - Mmaster Enrich schema готова (26 колонок CallRecord для Opus enrich)
> - Skill `/enrich-calls` готов с auto-loop + edge-case handling
>
> **Цель сессии (Фаза 1 — cron + API pull):**
> Создать cron-инфраструктуру для real-time режима по всем 5 клиентам:
> - diva (onPBX) — каждые 15 мин
> - vastu / reklama (Sipuni) — каждые 15 мин
> - coral (МегаПБХ) — каждые 30 мин
> - shumka — TBD (когда подключим)
>
> С встроенной reconciliation (Канон #38): один cron-проход = sync новые звонки + Stage 3.5 link + reconciliation сверка PBX/CRM/БД.
>
> Начни с обзора что есть, потом план реализации, потом код. Каждый этап коммить отдельно.

---

## 🔥 ВАЖНО: Cron = ПОЛНАЯ ЦЕПОЧКА, не просто sync

Cron не просто «забрал URLs». Это **end-to-end orchestrator** всего flow:

```
Cron triggers (каждые 15 мин)
   ↓
Stage 1: PBX API (mongo_history.search) — получить delta UUIDs новых звонков
   ↓
Stage 2: Smart-download MP3 (1 IP, sleep 3s, exp backoff, idempotent skip already-downloaded)
   ↓
Stage 3: Group + sort by duration (greedy bin-packing для GPU load balancing)
   ↓
Stage 4: ⭐ AUTO-START GPU (Intelion API) если есть >=10 новых
   ↓
Stage 5: Whisper v2.13 transcribe (per-channel, hotwords, watchdog auto-renewal)
   ↓
Stage 6: AUTO-STOP GPU когда очередь пуста
   ↓
Stage 7: DeepSeek downstream (callType, repair, scriptScore, callSummary)
   ↓
Stage 7.5: Phone resolve + Deal.clientCrmId JOIN (Stage 3.5 для GC tenants)
   ↓
Stage 8: Upsert CallRecord — все поля ВКЛЮЧАЯ audioUrl=onPBX URL (Канон #8)
   ↓
Stage 9: Reconciliation — PBX vs CRM (GC scraping) vs наша БД
   ↓
Stage 10: Telegram alert если discrepancy >5%
   ↓
Stage 11: UPDATE LastSync.timestamp = NOW()
   ↓
Готово — UI показывает первичную версию (transcript + scriptScore + базовые теги).
   ↓
Вечером: пользователь в Claude Code сессии запускает /loop /enrich-calls
   ↓
   Master Enrich (Opus, 6 блоков + Block 7 commitments) обогащает что cron не довёл.
   ↓
UI обновляется до полной enriched-версии.
```

**Критично:** в первый запуск cron должен забрать **весь день** (delta с last-sync до now), не пропустить ничего.

---

## 🎯 Что должна сделать новая сессия

### Этап 0: Первый прогон вручную (тестовый)

**ПЕРЕД** настройкой cron — **прогнать всю цепочку ОДИН РАЗ вручную** на свежих данных:
- За промежуток 2026-04-28..2026-04-29 (с момента последнего sync до сегодня)
- Один tenant (diva-school)
- Полный flow: PBX → download → GPU → Whisper → DeepSeek → Stage 3.5 → upsert → reconcile
- **Цель:** убедиться что end-to-end собирается, нет регрессий, GPU не падает
- Только после успеха — переход к Этапу 1

### Этап 1: Master Cron Worker (1 день)

**Создать `scripts/cron-master-pipeline.ts`** — единый cron-проход:

```typescript
// Per-tenant invocation — END-TO-END orchestrator
async function runCronPipeline(tenantName: string) {
  const tenant = await loadTenant(tenantName)
  const pbxConfig = await loadPbxConfig(tenant)
  const crmConfig = await loadCrmConfig(tenant)
  const lastSync = await getLastSync(tenant)

  // STAGE 1: PBX delta
  const newCalls = await pbxAdapter.fetchHistorySince(lastSync.timestamp)
  if (newCalls.length === 0) {
    await runReconcileOnly(tenant) // всё равно проверяем что нет потерь
    return
  }

  // STAGE 2: Smart-download MP3 (1 IP, sleep 3s, exp backoff, idempotent)
  const downloaded = await smartDownload(newCalls, {
    rateLimit: 3000,
    maxRetries: 5,
    skipExisting: true, // если файл уже скачан — skip
  })

  // STAGE 3: Group + sort by duration (greedy bin-packing для GPU load balancing)
  const batches = greedyBinPackByDuration(downloaded, { targetBatchMin: 30 })

  // STAGE 4: AUTO-START GPU только если есть работа (>=10 новых)
  if (downloaded.length >= 10) {
    await intelionApi.startGpuPod({
      tier: 'rtx-3090',
      keepaliveWatchdog: true, // canon: feedback-intelion-auto-renewal-bug.md
      maxIdleMinutes: 5,
    })
  }

  // STAGE 5: Whisper v2.13 transcribe (с hotwords из БД)
  const hotwords = await buildHotwords(tenant) // имена МОПов + топ русских имён
  for (const batch of batches) {
    await transcribeBatch(batch, {
      pipeline: 'v2.13',
      hotwords,
      watchdog: true, // если silent stop — авто-restart
    })
  }

  // STAGE 6: AUTO-STOP GPU когда очередь пуста
  await intelionApi.stopGpuPodIfIdle({ idleMinutes: 5 })

  // STAGE 7: DeepSeek downstream (concurrency 15)
  await runDownstream(downloaded, {
    steps: ['detect-call-type', 'repair', 'script-score', 'insights'],
    concurrency: 15,
  })

  // STAGE 7.5: Phone resolve + Deal link (GC tenants)
  if (crmConfig.provider === 'GETCOURSE') {
    await runStage35(tenant) // scripts/cron-stage35-link-fresh-calls.ts logic
  }
  // Для amoCRM dealId уже пришёл из Note.params.uniq

  // STAGE 8: Upsert CallRecord (Канон #8 — все поля в одном проходе)
  await upsertCallRecords(downloaded, tenant, {
    fields: [
      'pbxUuid', 'managerId', 'dealId', 'clientPhone',
      'transcript', 'transcriptRepaired',
      'callType', 'scriptScore', 'scriptDetails',
      'callSummary', 'sentiment', 'objections', 'hotLead',
      'audioUrl', // ← onPBX direct URL (НЕ GC fileservice!)
      'pbxMeta', 'gateway', 'hangupCause', 'userTalkTime',
      'gcContactId', 'startStamp',
    ],
  })

  // STAGE 9: Reconciliation (Канон #38)
  const reconciliation = await reconcile({
    pbxAdapter, crmAdapter, db,
    tenant, window: { from: lastSync.timestamp, to: now }
  })
  await db.reconciliationCheck.create({ data: reconciliation })

  // STAGE 10: Telegram alert
  if (reconciliation.discrepancyPct > 5) {
    await sendTelegramAlert(tenant, reconciliation)
  }

  // STAGE 11: UPDATE LastSync
  await updateLastSync(tenant, now)
}
```

### Этап 2: Crontab установка на prod (1 час)

```bash
# /etc/cron.d/salesguru-sync
*/15 * * * * docker run ... tsx scripts/cron-master-pipeline.ts diva-school
*/15 * * * * docker run ... tsx scripts/cron-master-pipeline.ts vastu
*/15 * * * * docker run ... tsx scripts/cron-master-pipeline.ts reklama
*/30 * * * * docker run ... tsx scripts/cron-master-pipeline.ts coral
0 4 * * *   docker run ... tsx scripts/daily-health-check.ts
```

### Этап 3: Schema migration `ReconciliationCheck` (10 мин)

```prisma
model ReconciliationCheck {
  id              String   @id @default(cuid())
  tenantId        String
  checkedAt       DateTime @default(now())
  windowStart     DateTime
  windowEnd       DateTime
  pbxCount        Int
  dbCount         Int
  crmCount        Int?
  missingInDb     Json?
  missingInCrm    Json?
  duplicates      Json?
  discrepancyPct  Float
  alertSent       Boolean  @default(false)
}
```

### Этап 4: Per-PBX adapter `fetchHistorySince` (2 дня)

Нужно унифицировать API доступ:
- **onPBX** — `POST /mongo_history/search.json` с `start_stamp_from`
- **Sipuni** — `GET /api/calls/list?from=...`
- **МегаПБХ** — TBD (пока ручной sync)

Адаптер pattern:
```typescript
interface PbxAdapter {
  fetchHistorySince(timestamp: Date): Promise<NormalizedCall[]>
  downloadAudio(callId: string): Promise<Buffer>
}
```

### Этап 5: Telegram alerts (1 час)

```typescript
async function sendTelegramAlert(tenant, reconciliation) {
  const text = `⚠️ ${tenant.name} reconciliation
PBX: ${reconciliation.pbxCount}
БД: ${reconciliation.dbCount}
CRM: ${reconciliation.crmCount}
Discrepancy: ${reconciliation.discrepancyPct.toFixed(1)}%
Missing UUIDs: ${reconciliation.missingInDb?.slice(0,5).join(', ')}...`

  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text })
  })
}
```

### Этап 5.5: Audio URLs из PBX (КРИТИЧНО для UI)

**Проблема:** в БД 6126 diva CallRecord имеют `audioUrl` на `fs*.getcourse.ru` (40%) или null (60%) — **ни одной onPBX ссылки**. Это блокирует UI player.

**Что делать:**

1. **В `cron-master-pipeline.ts` upsert step:**
   - При создании/апдейте CallRecord писать `audioUrl = <onPBX recording URL>`
   - Endpoint: `https://api.onlinepbx.ru/{domain}/mongo_history/download/{uuid}.mp3?key={apiKey}` (или signed URL через `recording_link.json`)
   - **НЕ скачивать** аудио в нашу инфру — только URL

2. **Backfill `scripts/backfill-pbx-audio-urls.ts`:**
   - Для всех 6126 существующих CallRecord без onPBX URL
   - Получить из onPBX api актуальные URLs
   - UPDATE `audioUrl`
   - Можно запустить раз и навсегда (~10-15 мин при concurrency)

3. **Edge cases:**
   - Звонки старше retention policy onPBX → audio удалён → `audioUrl = null` + флаг
   - НДЗ / voicemail → audio может быть пустой → проверить
   - Короткие звонки (<5s) → recording не сохранён → null

**Когда делать:** в Этапе 1 master-pipeline (для новых звонков) + отдельный backfill скрипт **сегодня же** (одноразовый прогон).

---

### Этап 6: Тест end-to-end (1 час)

1. Сделать тестовый звонок на diva (pickup → 30 сек разговор → hangup)
2. Подождать ~15 мин
3. Проверить в БД: CallRecord появился? transcript есть? gcContactId+dealId заполнены? scriptScore проставлен?
4. Запустить `/enrich-calls --uuids=<test-uuid>` → enriched fields появились?
5. Проверить ReconciliationCheck — pbxCount=N, dbCount=N, discrepancyPct=0

---

## 📚 Контекст про cron+API (важно понимать)

**Cron** = расписание Linux (когда запускать).
**API** = откуда брать данные (PBX endpoints).
**Они работают вместе.** Cron триггерит скрипт → скрипт вызывает API → получает данные → пишет в БД.

```
Linux cron (timeweb 80.76.60.130)
       ↓ запускает tsx скрипт каждые 15 мин
TypeScript: cron-master-pipeline.ts
       ↓ fetch() → onPBX/Sipuni API
PBX API: /mongo_history/search.json?start_stamp_from=X
       ↓ JSON delta новых звонков
TS: download audio → transcribe → DeepSeek → Prisma upsert
       ↓ Stage 3.5 + reconciliation
БД (Postgres)
```

**Webhook (Фаза 2, далеко):** PBX сам пушит нам события. Нужен public HTTPS endpoint + auth + retry queue. **Не нужен сейчас** — анкета diva: «алерты НЕ нужны». Cron 15 мин достаточен.

---

## 🛡️ Не путать

| | Cron sync | Webhook | Backfill | /enrich-calls |
|---|---|---|---|---|
| Когда | каждые 15 мин | в момент звонка | one-shot | вечером batch |
| Что | свежие звонки | один звонок | все исторические | LLM обогащение |
| Кто | Linux cron | PBX | manual | Claude Code skill |
| Latency | 15 мин | <1 мин | минуты-часы | 5-7 мин/40 |

В Фазе 1 делаем **только Cron sync**. Backfill уже сделан вручную для diva. /enrich-calls работает в подписке (отдельно от cron).

---

## ✅ Что уже готово (не делать заново)

- [x] Pipeline v2.13 (Whisper + repair) на сервере
- [x] Stage 3.5 cron worker (`scripts/cron-stage35-link-fresh-calls.ts`)
- [x] Master Enrich schema в БД (29 колонок CallRecord включая Block 7)
- [x] Skill `/enrich-calls` с auto-loop + edge-case
- [x] Канон #37 (дашборд РОПа) doc
- [x] Канон #38 (reconciliation) doc
- [x] Phone resolve script (`resolve-phones-via-gc.ts`) — 99.8% покрытие
- [x] Deal.clientCrmId backfill 99.99% для diva (137974/137992)
- [x] gc-sync-v2.ts:482 — sync пишет clientCrmId автоматом
- [x] CallRecord.dealId — 82.2% покрытие (5038/6126)
- [x] Все memory canon (Intelion bugs, SSH quirks, tar suffix, pipeline params)

## 📝 Что НЕ готово (делать в новой сессии)

### Этап 0 — Первый прогон вручную (за прошедший день)
- [ ] Прогнать end-to-end на интервале с last-sync до now (для diva это 28-29 апреля)
- [ ] Зафиксировать что всё работает
- [ ] Только потом — настройка cron

### Этап 1-6 — Master Cron
- [ ] `cron-master-pipeline.ts` — главный orchestrator (11 stages выше)
- [ ] PBX adapter pattern (onPBX/Sipuni/МегаПБХ под одним интерфейсом)
- [ ] GPU auto-start/stop через Intelion API + watchdog
- [ ] Greedy bin-packing batch sorter (по duration)
- [ ] Smart-download MP3 с idempotent skip
- [ ] **audioUrl = onPBX URL** (НЕ GC fileservice!) — backfill 6126 + новые
- [ ] `LastSync` table + миграция
- [ ] `ReconciliationCheck` table + миграция
- [ ] Reconciliation logic (3-way diff PBX/CRM/БД)
- [ ] Telegram alerts >5% discrepancy
- [ ] GC playwright восстановить если sync через Playwright (cookie refresh)

### Установка
- [ ] Crontab на prod (per-tenant расписание)
- [ ] End-to-end тест с тестовым звонком (sync → 15 мин → видим в /quality)
- [ ] Документация в STATUS.md

---

## 🛡️ GPU защита (КРИТИЧНО — большой опыт шишек собран)

В этой сессии было много инцидентов с GPU. Canon записан в memory:

### Обязательно использовать

1. **`feedback-intelion-auto-renewal-bug.md`**
   - Серверы Intelion **silently stop через 60 мин** без видимой ошибки
   - **Watchdog обязательно:** API ping каждые 25 мин → если pod_status='stopped' → restart
   - В master-pipeline это `Promise.race([transcribe, watchdog])` pattern

2. **`feedback-ssh-intelion-quirks.md`**
   - SSH banner timeout — добавлять `-o ConnectTimeout=20`
   - Exit 255 ≠ ошибка — это normal disconnection
   - **Pattern:** `nohup setsid <cmd> > log 2>&1 &` для detachment от SSH
   - SCP launcher вместо inline heredoc (heredoc ломает escaping)

3. **`feedback-orchestrate-tar-mp3-suffix-bug.md`**
   - tar transfer файлов ТРЕБУЕТ `.mp3` суффикс в files-list.txt
   - Без суффикса — 0 файлов на target, 286 фейлов download_failed
   - **Pre-process** files-list ДО tar transfer

4. **`feedback-pipeline-v213-final-settings.md`**
   - Production params Whisper (PROB 0.20, GAP 3.0, HOST_PAUSE_MIN 1.0, etc.)
   - НЕ ТРОГАТЬ — калиброваны на 60 файлах + диагностике 10 проблемных

### Anti-patterns (ABSOLUTELY DON'T)

❌ Запускать GPU 24/7 — пустая трата денег
❌ Запускать GPU без watchdog — тихо сломается через час
❌ Использовать GC fileservice URLs для audioUrl — протухают
❌ Скачивать audio в нашу инфру — лишняя работа, прямой URL onPBX лучше

---

## 🔥 Killer features которые нужно сохранить в сознании

При разработке cron-pipeline **помнить**:

1. **Канон #8** — все поля CallRecord в **одном upsert** (никаких "потом отдельным скриптом"). Phone resolve делать **до** upsert, не после.

2. **Канон #37** — РОП покупает контроль качества разговоров, не BI на CRM. Reconciliation алерт = "у нас всё под контролем", не "у нас цифры выручки".

3. **Канон #38** — sync + reconcile в **одном проходе**. Не разделять на два cron — нагрузка возрастёт, ошибки будет сложно дебажить.

4. **Canon Master Enrich** — Block 7 (extracted commitments) автоматически даёт **promise tracking**. Не забыть после Phase 2 (Block 7 sync в CRM tasks).

5. **Whisper baseline limits** — late-start ~13% (placeholder), echo bleed МОП↔КЛИЕНТ. Это **не баг**, это **известный лимит** (memory `feedback-whisper-8khz-baseline-limit.md`). Cron не должен пытаться "починить" эти случаи — они проходят через Master Enrich edge-case handling.

---

## Коммитить как

Каждый этап = отдельный commit с conventional message:
```
feat(cron): master-pipeline для diva (Этап 1)
feat(cron): PBX adapter pattern (Этап 4)
feat(reconciliation): встроена в cron-master-pipeline (Канон #38)
feat(alerts): Telegram bot для discrepancy >5%
```

После всех этапов — отдельный commit для crontab + production deploy.

---

## Готов к старту

В новой сессии копируй промпт сверху → начни с обзора → план → реализация → коммиты по этапам.

**Текущая сессия (где это писалось):** оставить открытой как «штаб» — здесь все каноны и backup на случай вопросов.

Удачи 🚀
