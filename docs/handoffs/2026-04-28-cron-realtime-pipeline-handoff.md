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

## 🎯 Что должна сделать новая сессия

### Этап 1: Master Cron Worker (1 день)

**Создать `scripts/cron-master-pipeline.ts`** — единый cron-проход:

```typescript
// Per-tenant invocation
async function runCronPipeline(tenantName: string) {
  const tenant = await loadTenant(tenantName)
  const pbxConfig = await loadPbxConfig(tenant)  // onPBX/Sipuni/МегаПБХ
  const crmConfig = await loadCrmConfig(tenant)  // GC/amoCRM

  const lastSync = await getLastSync(tenant)

  // ШАГ 1: Sync новых звонков (delta только)
  const newCalls = await pbxAdapter.fetchHistorySince(lastSync.timestamp)
  console.log(`[pbx] fetched ${newCalls.length} new calls`)

  // ШАГ 2: Smart-download audio (1 IP, sleep 3s, backoff)
  await downloadAudios(newCalls, { rateLimit: 3000 })

  // ШАГ 3: Trigger transcribe queue (если >10 новых — start GPU)
  if (newCalls.length >= 10) await ensureGpuRunning()
  await queueTranscription(newCalls)

  // ШАГ 4: Wait для transcribe + downstream (или асинхронно — записать в очередь)
  // Альтернатива: отдельный cron для transcribe queue

  // ШАГ 5: Stage 3.5 — phone resolve + Deal link (только GC tenants)
  if (crmConfig.provider === 'GETCOURSE') {
    await runStage35(tenant)
  }
  // Для amoCRM dealId уже пришёл в Note.params.uniq при sync

  // ШАГ 6: Upsert CallRecord (Canon #8 — все поля в одном проходе)
  await upsertCallRecords(newCalls, tenant)

  // ШАГ 7: ⭐ RECONCILIATION (Канон #38)
  const reconciliation = await reconcile({
    pbxAdapter, crmAdapter, db,
    tenant, window: { from: lastSync.timestamp, to: now }
  })
  await db.reconciliationCheck.create({ data: reconciliation })

  if (reconciliation.discrepancyPct > 5) {
    await sendTelegramAlert(tenant, reconciliation)
  }

  // ШАГ 8: UPDATE LastSync
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
- [x] Master Enrich schema в БД (26 колонок CallRecord)
- [x] Skill `/enrich-calls` с auto-loop
- [x] Канон #37 (дашборд РОПа) doc
- [x] Канон #38 (reconciliation) doc
- [x] Phone resolve script (`resolve-phones-via-gc.ts`)
- [x] Deal.clientCrmId backfill 99.99% для diva
- [x] gc-sync-v2.ts:482 — sync пишет clientCrmId автоматом

## 📝 Что НЕ готово (делать в новой сессии)

- [ ] `cron-master-pipeline.ts` — главный cron worker
- [ ] PBX adapter pattern (onPBX/Sipuni/МегаПБХ под одним интерфейсом)
- [ ] `LastSync` table + миграция
- [ ] `ReconciliationCheck` table + миграция
- [ ] Reconciliation logic (3-way diff)
- [ ] Telegram alerts
- [ ] Crontab установка на prod
- [ ] End-to-end тест с тестовым звонком

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
