# 🚀 HANDOFF — Cron Auto-Update + Real-Time Pipeline (v2)

**Создан:** 2026-04-28 → обновлён 2026-04-29 (v2)
**Куда копировать:** новая сессия Claude Code в `/Users/kirillmalahov/smart-analyze`
**Цель:** end-to-end cron orchestrator + ОДИН backfill за **2026-04-28** (фиксированная дата)

---

## 📋 ПРОМПТ для копирования в новую сессию (короткий — handoff сам всё расскажет)

```
Привет. Реализую боевой режим cron auto-update для SalesGuru.

🛑 STEP 0 — ОБЯЗАТЕЛЬНЫЕ tool-calls ПЕРЕД любым кодом:

  Read("/Users/kirillmalahov/smart-analyze/docs/handoffs/2026-04-28-cron-realtime-pipeline-handoff.md")
  Read("/Users/kirillmalahov/smart-analyze/scripts/cron-stage35-link-fresh-calls.ts")

После двух Read'ов — в первом сообщении выдай **3 строки resume**:
- "Backfill window: ... (фиксировано)"
- "Этапов: ... | DoD-критериев: ..."
- "Эталон структуры: cron-stage35-link-fresh-calls.ts"

Без resume = STEP 0 не выполнен → стоп.

Все остальные файлы (memory feedback-*, canon-*, scripts/) читай ПО МЕРЕ
НЕОБХОДИМОСТИ — индекс в секции «📚 По требованию» внизу handoff'а.

Tenant ID для diva: 'cmo4qkb1000000jo432rh0l3u'
Доступ к prod БД: ssh -i ~/.ssh/timeweb root@80.76.60.130 "docker exec smart-analyze-db psql ..."
НЕ использовать mcp__soldout-db__* (другая БД — WB-аналитика).

Дальше следуй handoff'у дословно: Backfill 28.04 → Этапы 1-11 (commit за каждый) →
Crontab → E2E тест.
```

---

## 🎯 BACKFILL TARGET — ЗАФИКСИРОВАННАЯ ДАТА (НЕ относительно «вчера»)

**Первый запуск — это ОДНОРАЗОВЫЙ ручной backfill за 28 апреля 2026.**

| Параметр | Значение |
|---|---|
| Цель | догнать пропущенные звонки 28 апреля 2026 для diva |
| Window FROM | `last_call_in_db.startStamp` (примерно вечер 2026-04-27) |
| Window TO | **2026-04-28 23:59:59 МСК** (включительно) |
| Tenant | `diva-school` (`cmo4qkb1000000jo432rh0l3u`) |
| Где запускать | manual: `npx tsx scripts/manual-backfill-2026-04-28.ts` |
| Когда успех | все звонки 28.04 в БД с `transcript NOT NULL` + `enrichmentStatus IS NULL` |
| Что дальше | `/loop /enrich-calls` подберёт их ночью + cron активируется на 29.04+ |

⛔ **«28.04» — это ФИКСИРОВАННАЯ ДАТА.** Если читаешь handoff 30 апреля или позже:
- Backfill всё равно про 28.04 (не «вчера»)
- 29.04 и далее уже идут через cron (если он установлен)
- Если cron не успели поставить до 30.04 → нужен ОТДЕЛЬНЫЙ backfill за 29.04 — спросить пользователя

**ROLLBACK BACKFILL (если что-то пошло не так):**
1. `LastSync` rollback: `UPDATE "LastSync" SET timestamp = '<previous>' WHERE "tenantId"='cmo4qkb1000000jo432rh0l3u'`
2. Удалить только не-enriched записи (чтобы не потерять работу `/enrich-calls`):
   ```sql
   DELETE FROM "CallRecord"
   WHERE "tenantId"='cmo4qkb1000000jo432rh0l3u'
     AND "startStamp" BETWEEN '2026-04-28 00:00 MSK' AND '2026-04-28 23:59 MSK'
     AND "enrichmentStatus" IS NULL
   ```
3. Disable cron (если уже установлен): `touch /tmp/disable-cron-pipeline` — все скрипты в начале проверяют этот файл и `exit 0`

---

## 📋 DEFINITION-OF-DONE — критерии готовности каждого этапа

**Перед commit'ом каждого этапа проверь ВСЕ критерии явно. Если хоть один не выполнен — этап не готов, переделать.**

### Этап 1: PBX adapter (`fetchHistorySince`)
- [ ] За **3 запуска подряд** возвращает только новые UUIDs (по `LastSync.timestamp`)
- [ ] При недоступности PBX (5xx/timeout) → exit code 1 + Telegram alert «PBX недоступен»
- [ ] **Idempotent**: повторный запуск с тем же `lastSync` не создаёт дублей в БД
- [ ] Тест: симулировать timeout → проверить что нет partial state

### Этап 2: Smart-download MP3
- [ ] `sleep 3000ms` между файлами (1 IP rate-limit для PBX)
- [ ] Exp backoff при 429/5xx: max 5 retries (3s, 6s, 12s, 24s, 48s)
- [ ] `skipExisting`: проверка файла в `/tmp/whisper-input/` ПЕРЕД download
- [ ] Тест: скачать 10 файлов → перезапустить → 0 повторных download'ов

### Этап 3: Bin-packing для Whisper batches
- [ ] **Алгоритм: First Fit Decreasing**
  1. Сортировать звонки по `duration` DESC
  2. Greedy раскидать по bins (новый bin когда не влезает)
  3. **Cap на bin: 30 минут совокупного аудио**
- [ ] Тест на 100 синтетических звонков: `bins ≤ ceil(total_duration_min / 30)`
- [ ] Длинный (45+ мин) звонок → отдельный bin (не разбивать)
- [ ] Если N bins > 1 → запросить N GPU pods через Intelion API

### Этап 4: GPU auto-start
- [ ] Запуск **только если** `pending >= 10` (иначе skip — экономия)
- [ ] **Watchdog ping каждые 25 мин** (Intelion silent stop через 60 — `feedback-intelion-auto-renewal-bug.md`)
- [ ] Один pod на cron-проход (использовать lock-файл `/tmp/gpu-pod-starting.lock`)
- [ ] Тест: симулировать `pod_status='stopped'` → watchdog должен restart

### Этап 5: Whisper v2.13
- [ ] Параметры **строго** из `feedback-pipeline-v213-final-settings.md`:
  - `PROB=0.20`, `GAP=3.0`, `HOST_PAUSE_MIN=1.0`, `word_timestamps=true`, `VAD=off`
- [ ] Hotwords из БД (имена МОПов tenant + топ-100 русских имён)
- [ ] **Файлы переименовываются БЕЗ суффикса `.mp3.mp3`** (фикс `feedback-orchestrate-tar-mp3-suffix-bug.md`)
- [ ] Тест: после batch'а `ls /tmp/whisper-output/*.mp3 | grep -c '\.mp3\.mp3$'` = 0

### Этап 6: GPU auto-stop
- [ ] Stop через **max 10 мин** после Whisper-завершения (idle timer)
- [ ] Логировать idle time → видно сколько minutes wasted
- [ ] Если idle > 10 мин но pending > 0 → НЕ останавливать (новые звонки)

### Этап 7: DeepSeek downstream
- [ ] `concurrency=15` (per `feedback-pipeline-canon-with-opus-enrich.md`)
- [ ] Все 4 шага: `detect-call-type`, `repair`, `script-score`, `insights`
- [ ] **Failure одного step не блокирует другие** (try/catch isolated на каждый)
- [ ] Тест: убить DeepSeek API на 30 сек → остальные steps продолжают

### Этап 7.5: Phone resolve + Deal link (только GC tenants)
- [ ] Использует существующий `cron-stage35-link-fresh-calls.ts` logic
- [ ] **gcContactId извлекается через `data-user-id`** (НЕ `data-key` — фикс из коммита `2731932`)
- [ ] При cookie expired (response code 302 → /login) → Telegram alert «нужна ручная авторизация GC для tenant X»
- [ ] Cookie regex check: `/^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/i` для encrypted vs plain
- [ ] Тест: phone `+79123456789` → должен вернуть GC user_id (число > 1000000)

### Этап 8: Upsert CallRecord (Канон #8 — ОДИН проход)
- [ ] **`audioUrl = onPBX URL`** (НЕ GC fileservice — протухает, фикс)
- [ ] Все обязательные поля в одном UPSERT (16 штук — см. ниже Этап 8 в детализации)
- [ ] Phone resolve выполнен **ДО** upsert (не after)
- [ ] Тест: записать → SELECT → все 16 полей не-null (где должны)

### Этап 9: Reconciliation (Канон #38)
- [ ] **3-way diff:** PBX count, DB count, CRM count (GC HTML scraping)
- [ ] Window = последние **24 часа** (НЕ lastSync window — для чистоты diff на цикл)
- [ ] Запись в `ReconciliationCheck` table (schema ниже)

### Этап 10: Telegram alert
- [ ] **Формула:** `discrepancy = |PBX_count - DB_count| / PBX_count`
- [ ] Если `discrepancy > 0.05` → alert
- [ ] Тело alert: `tenant`, `window`, все 3 counts, `top-5 missing UUIDs`
- [ ] Тест: фейкнуть DB count = PBX-10% → должен прийти alert

### Этап 11: UPDATE LastSync
- [ ] `timestamp = NOW()` в **одной транзакции** после reconciliation
- [ ] Если reconciliation упал → НЕ обновлять LastSync (повторим в след cycle)
- [ ] Тест: kill процесс между Stage 9 и 11 → LastSync не сдвинулся

### Crontab install (отдельный шаг, ПОСЛЕ всех Этапов + успешного Backfill 28.04)
- [ ] **Backup**: `crontab -l > ~/cron-backup-2026-04-29.txt` ДО install
- [ ] **Kill switch**: все скрипты в начале проверяют `/tmp/disable-cron-pipeline` и `exit 0` если есть
- [ ] **Logrotate** для `/var/log/smart-analyze/cron.log` (max 100MB, keep 7)
- [ ] Расписание: 15 мин diva/vastu/reklama, 30 мин coral, 4:00 daily-health-check
- [ ] Тест: сделать тестовый звонок → 15 мин → проверить /quality

---

## 📐 КЛЮЧЕВЫЕ ФОРМУЛЫ (явно, не «приблизительно»)

### Bin-packing (Этап 3)
```python
def bin_pack_first_fit_decreasing(calls, max_bin_minutes=30):
    """First Fit Decreasing — длинные звонки в первый подходящий bin."""
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
            bins.append([call])  # новый bin
    return bins  # len(bins) = сколько GPU pods нужно
```

### Discrepancy (Этап 10)
```python
def discrepancy_pct(pbx_count, db_count):
    """Если PBX=0 → нет звонков → нет discrepancy. Иначе процент по PBX как опорному."""
    if pbx_count == 0:
        return 0.0
    return abs(pbx_count - db_count) / pbx_count

# Alert if discrepancy_pct(...) > 0.05
```

### Backfill window (28.04)
```python
from datetime import datetime
import pytz

MSK = pytz.timezone('Europe/Moscow')
BACKFILL_FROM = (await db.callRecord.findFirst({
    where: {tenantId: 'cmo4qkb1000000jo432rh0l3u'},
    orderBy: {startStamp: 'desc'},
    select: {startStamp: True}
})).startStamp  # последний звонок в БД сейчас (~27.04 evening)

BACKFILL_TO = MSK.localize(datetime(2026, 4, 28, 23, 59, 59))
# фиксировано — НЕ now()
```

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
Stage 3: Group + sort by duration (greedy bin-packing для GPU load balancing) ← FFD, max 30 мин/bin
   ↓
Stage 4: ⭐ AUTO-START GPU (Intelion API) если есть >=10 новых
   ↓
Stage 5: Whisper v2.13 transcribe (per-channel, hotwords, watchdog auto-renewal)
   ↓
Stage 6: AUTO-STOP GPU когда очередь пуста (idle 10 мин)
   ↓
Stage 7: DeepSeek downstream (callType, repair, scriptScore, callSummary) — concurrency 15
   ↓
Stage 7.5: Phone resolve + Deal.clientCrmId JOIN (для GC tenants — Stage 3.5 logic)
   ↓
Stage 8: Upsert CallRecord — все поля ВКЛЮЧАЯ audioUrl=onPBX URL (Канон #8)
   ↓
Stage 9: Reconciliation — PBX vs CRM (GC scraping) vs наша БД (3-way diff)
   ↓
Stage 10: Telegram alert если discrepancy > 0.05 (формула выше)
   ↓
Stage 11: UPDATE LastSync.timestamp = NOW() (только если 9-10 успешны)
   ↓
Готово — UI показывает первичную версию (transcript + scriptScore + базовые теги).
   ↓
Вечером: пользователь в Claude Code сессии запускает /loop /enrich-calls
   ↓
   Master Enrich (Opus, 6 блоков + Block 7 commitments) обогащает что cron не довёл.
   ↓
UI обновляется до полной enriched-версии.
```

---

## 🎯 Что должна сделать новая сессия (порядок задач)

### ЗАДАЧА 0: Inventory (30 мин)
- `ls scripts/cron-*.ts scripts/intelion-*.py scripts/sipuni-*.ts`
- Что уже покрывает части пайплайна (re-use)
- Что нужно написать с нуля
- **Эталон структуры:** `scripts/cron-stage35-link-fresh-calls.ts` (header + try/catch на каждый sub-step + Telegram alert + console.log с timestamp)

### ЗАДАЧА 1: BACKFILL 28.04 (manual, 2-3 часа)
**Это НЕ под cron — разовый прогон через `npx tsx scripts/manual-backfill-2026-04-28.ts`**
- Window: `last_call_in_db` → `2026-04-28 23:59:59 МСК` (фиксировано)
- Tenant: только `diva-school`
- Полный flow Этапов 1-11 (но **без** UPDATE LastSync на end — разовый run)
- После выхода: проверить в БД количество звонков 28.04 = ожидаемое из PBX
- Если backfill упал — НЕ ставить cron на расписание

### ЗАДАЧА 2: Реализация Этапов 1-11 (commit за этап)
- Каждый этап: код + DoD checklist (выше) + commit с conventional message
- Порядок: 1 (PBX) → 2 (download) → 3 (bin-pack) → 4-6 (GPU) → 7 (DeepSeek) → 7.5 (Stage 3.5) → 8 (upsert) → 9-10 (reconcile+alert) → 11 (LastSync)

### ЗАДАЧА 3: Crontab install (только после ЗАДАЧИ 1 успеха + всех Этапов)
- 15 мин для diva/vastu/reklama, 30 мин для coral
- Backup → install → kill switch ready
- Logging в `/var/log/smart-analyze/cron.log` с rotation

### ЗАДАЧА 4: E2E тест (3 cron-цикла, ~45 мин)
- Сделать тестовый звонок на diva (pickup → 30 сек разговор → hangup)
- Подождать 15 мин → проверить /quality показывает звонок
- Подождать ещё 30 мин (2 цикла) → проверить нет дублей
- Проверить ReconciliationCheck — discrepancyPct = 0

---

## 🛡️ ROLLBACK READY (выполнить ДО первого запуска cron)

| Что | Команда |
|---|---|
| Backup crontab | `crontab -l > ~/cron-backup-2026-04-29.txt` |
| Kill switch | все скрипты начинаются с `if [ -f /tmp/disable-cron-pipeline ]; then exit 0; fi` |
| Disable cron быстро | `touch /tmp/disable-cron-pipeline` (без редактирования crontab) |
| Re-enable | `rm /tmp/disable-cron-pipeline` |
| Полный rollback | `crontab ~/cron-backup-2026-04-29.txt` |

---

## 📦 Per-PBX adapter (Этап 1 detail)

```typescript
interface PbxAdapter {
  fetchHistorySince(timestamp: Date): Promise<NormalizedCall[]>
  downloadAudio(callId: string): Promise<Buffer>
  getRecordingUrl(callId: string): Promise<string>  // для audioUrl, БЕЗ download
}

// onPBX implementation
class OnPbxAdapter implements PbxAdapter {
  async fetchHistorySince(ts) {
    return await fetch(`https://api.onlinepbx.ru/${domain}/mongo_history/search.json`, {
      body: { start_stamp_from: ts.toISOString(), key: apiKey }
    })
  }
  async getRecordingUrl(callId) {
    // signed URL через recording_link.json
    return `https://api.onlinepbx.ru/${domain}/mongo_history/download/${callId}.mp3?key=${apiKey}`
  }
}

// Sipuni implementation (для vastu/reklama)
class SipuniAdapter implements PbxAdapter {
  async fetchHistorySince(ts) {
    return await fetch(`/api/calls/list?from=${ts.toISOString()}&token=${token}`)
  }
}

// МегаПБХ implementation (для coral) — TBD, пока ручной sync
```

---

## 📐 Schema migrations

### `LastSync` table
```prisma
model LastSync {
  id        String   @id @default(cuid())
  tenantId  String
  pbxType   String   // 'onpbx' | 'sipuni' | 'megapbx'
  timestamp DateTime  // последний успешный sync
  updatedAt DateTime @updatedAt

  @@unique([tenantId, pbxType])
}
```

### `ReconciliationCheck` table
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

---

## 📡 Crontab (после успешного Backfill 28.04)

```cron
# /etc/cron.d/salesguru-sync — поставить ПОСЛЕ Backfill 28.04 success

# kill switch check happens INSIDE each script
*/15 * * * * cd /root/smart-analyze && tsx scripts/cron-master-pipeline.ts diva-school   >> /var/log/smart-analyze/cron.log 2>&1
*/15 * * * * cd /root/smart-analyze && tsx scripts/cron-master-pipeline.ts vastu         >> /var/log/smart-analyze/cron.log 2>&1
*/15 * * * * cd /root/smart-analyze && tsx scripts/cron-master-pipeline.ts reklama       >> /var/log/smart-analyze/cron.log 2>&1
*/30 * * * * cd /root/smart-analyze && tsx scripts/cron-master-pipeline.ts coral         >> /var/log/smart-analyze/cron.log 2>&1
0 4 * * *    cd /root/smart-analyze && tsx scripts/daily-health-check.ts                 >> /var/log/smart-analyze/health.log 2>&1
```

---

## 📞 Telegram alerts (Этап 10 detail)

```typescript
async function sendTelegramAlert(tenant, reconciliation) {
  const text = `⚠️ ${tenant.name} reconciliation
Window: ${reconciliation.windowStart.toISOString()} → ${reconciliation.windowEnd.toISOString()}
PBX: ${reconciliation.pbxCount}
БД: ${reconciliation.dbCount}
CRM: ${reconciliation.crmCount}
Discrepancy: ${(reconciliation.discrepancyPct * 100).toFixed(1)}%
Top 5 missing UUIDs: ${reconciliation.missingInDb?.slice(0,5).join(', ')}...`

  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text })
  })

  await db.reconciliationCheck.update({
    where: { id: reconciliation.id },
    data: { alertSent: true }
  })
}
```

---

## 🎵 Audio URLs из PBX (Этап 8 КРИТИЧНО)

**Проблема:** в БД 6126 diva CallRecord имеют `audioUrl` на `fs*.getcourse.ru` (40%) или null (60%) — **ни одной onPBX ссылки**. Это блокирует UI player.

**Что делать:**

1. **В `cron-master-pipeline.ts` upsert step (Этап 8):**
   - При создании/апдейте CallRecord писать `audioUrl = <onPBX recording URL>`
   - Endpoint: `https://api.onlinepbx.ru/{domain}/mongo_history/download/{uuid}.mp3?key={apiKey}` (или signed URL через `recording_link.json`)
   - **НЕ скачивать** аудио в нашу инфру — только URL

2. **Backfill `scripts/backfill-pbx-audio-urls.ts` (одноразовый):**
   - Для всех 6126 существующих CallRecord без onPBX URL
   - Получить из onPBX API актуальные URLs
   - UPDATE `audioUrl`
   - Концurrency=10, ~15 мин total
   - **Запустить ПЕРЕД ЗАДАЧЕЙ 1 (Backfill 28.04)** — чтобы UI player работал

3. **Edge cases:**
   - Звонки старше retention policy onPBX → audio удалён → `audioUrl = null` + флаг
   - НДЗ / voicemail → audio может быть пустой → проверить
   - Короткие звонки (<5s) → recording не сохранён → null

---

## 🛡️ GPU защита (КРИТИЧНО — большой опыт шишек собран)

В этой сессии было много инцидентов с GPU. Canon записан в memory:

### Обязательно использовать

1. **`feedback-intelion-auto-renewal-bug.md`**
   - Серверы Intelion **silently stop через 60 мин** без видимой ошибки
   - **Watchdog обязательно:** API ping каждые 25 мин → если `pod_status='stopped'` → restart
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
❌ Crontab install ДО успешного Backfill 28.04 — двойная обработка / discrepancy спам

---

## 🔑 Tribal knowledge — gotchas (НЕ повторять, проверено сегодня)

1. **`Tenant.subdomain` НЕ существует** — subdomain в `CrmConfig.subdomain` (probed 29 апр)
2. **`Deal.clientCrmId`** для diva уже заполнен 99.99% (137974/137992) — но `gc-sync-v2.ts:482` обязателен для будущих syncов
3. **Phone normalize** — последние 10 цифр (`destination_number.replace(/\D/g, "").slice(-10)`)
4. **GC endpoint `/pl/api/account/users` требует API key** которого у нас нет — использовать HTML scraping `/pl/user/contact/index?ContactSearch[phone]=X` (cookie из `CrmConfig.gcCookie`)
5. **GC HTML — парсить `data-user-id`** (реальный user_id), НЕ `data-key` (это row index Yii2). Фикс в коммите `2731932`
6. **Cookie может быть encrypted** (`iv:tag:enc`) или plain — regex `/^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/i` перед `decrypt()`
7. **Intelion GPU silently stops через 60 мин** — watchdog обязателен
8. **GC sync отдает только обновлённые deals в date_range** (`created_at` в их БД ≠ нашему `createdAt`) — per-user filter не работает, только per-deal page fetch
9. **MCP `soldout-db`** — это **другая БД** (WB-аналитика), там нет SalesGuru таблиц

---

## 🌟 Killer features которые нужно сохранить в сознании

1. **Канон #8** — все поля CallRecord в **одном upsert** (никаких "потом отдельным скриптом"). Phone resolve делать **до** upsert, не после.

2. **Канон #37** — РОП покупает контроль качества разговоров, не BI на CRM. Reconciliation алерт = «у нас всё под контролем», не «у нас цифры выручки».

3. **Канон #38** — sync + reconcile в **одном проходе**. Не разделять на два cron — нагрузка возрастёт, ошибки сложнее дебажить.

4. **Canon Master Enrich** — Block 7 (extracted commitments) автоматически даёт **promise tracking**. Не забыть после Phase 2 (Block 7 sync в CRM tasks).

5. **Whisper baseline limits** — late-start ~13% (placeholder), echo bleed МОП↔КЛИЕНТ. Это **не баг**, это **известный лимит** (memory `feedback-whisper-8khz-baseline-limit.md`). Cron не должен пытаться «починить» эти случаи — они проходят через Master Enrich edge-case handling.

---

## ✅ Что уже готово (не делать заново)

- [x] Pipeline v2.13 (Whisper + repair) на сервере
- [x] Stage 3.5 cron worker (`scripts/cron-stage35-link-fresh-calls.ts`) — **эталон структуры для новых cron-скриптов**
- [x] Master Enrich schema в БД (60 колонок CallRecord включая Block 7)
- [x] Skill `/enrich-calls` v6 с auto-loop + edge-case + ScheduleWakeup
- [x] Канон #37 (дашборд РОПа) doc
- [x] Канон #38 (reconciliation) doc
- [x] Phone resolve script (`resolve-phones-via-gc.ts`) — 99.8% покрытие, фикс `data-user-id` (commit `2731932`)
- [x] Deal.clientCrmId backfill 99.99% для diva (137974/137992)
- [x] gc-sync-v2.ts:482 — sync пишет clientCrmId автоматом
- [x] CallRecord.dealId — 82.2% покрытие (5038/6126)
- [x] Все memory canon (Intelion bugs, SSH quirks, tar suffix, pipeline params)

---

## 📝 Что НЕ готово (делать в новой сессии)

### ЗАДАЧА 0 — Inventory + Backfill audio URLs (одноразовый)
- [ ] `scripts/backfill-pbx-audio-urls.ts` — 6126 записей, ~15 мин
- [ ] Inventory existing scripts что переиспользовать

### ЗАДАЧА 1 — Backfill 28.04 (manual, ОДИН раз)
- [ ] `scripts/manual-backfill-2026-04-28.ts` — window до `2026-04-28 23:59:59 МСК`
- [ ] Прогнать для diva → проверить count(БД 28.04) ≈ count(PBX 28.04)
- [ ] Только после успеха — переход к ЗАДАЧЕ 2

### ЗАДАЧА 2 — Master Cron (Этапы 1-11)
- [ ] `cron-master-pipeline.ts` — главный orchestrator
- [ ] Per-PBX adapter pattern (onPBX/Sipuni/МегаПБХ)
- [ ] GPU auto-start/stop через Intelion API + watchdog
- [ ] Greedy bin-packing (FFD, max 30 мин/bin)
- [ ] Smart-download MP3 с idempotent skip
- [ ] **audioUrl = onPBX URL** в upsert (Этап 8)
- [ ] `LastSync` + `ReconciliationCheck` миграции
- [ ] Reconciliation 3-way diff с формулой
- [ ] Telegram alerts (формула в файле)
- [ ] GC Playwright восстановить (Этап 7.5)

### ЗАДАЧА 3 — Установка
- [ ] `crontab -l > backup` ДО install
- [ ] Crontab на prod
- [ ] Kill switch + logrotate

### ЗАДАЧА 4 — E2E тест
- [ ] Тестовый звонок → 15 мин → /quality
- [ ] 3 cron-цикла без discrepancy

---

## 🔌 Контекст про cron+API (важно понимать)

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

В Фазе 1 делаем **только Cron sync**. Backfill 28.04 — разовый. /enrich-calls работает в подписке (отдельно от cron).

---

## 📚 По требованию — индекс файлов по этапам

Читай только когда коснёшься соответствующего этапа.

### Для Этапов 1-2 (PBX/sync):
- `~/.claude/projects/-Users-kirillmalahov/memory/feedback-pbx-call-metadata-required.md` — обязательные поля

### Для Этапов 4-6 (GPU):
- `~/.claude/projects/-Users-kirillmalahov/memory/feedback-intelion-auto-renewal-bug.md` — silent stop
- `~/.claude/projects/-Users-kirillmalahov/memory/feedback-ssh-intelion-quirks.md` — SSH timeout, exit 255
- `~/.claude/projects/-Users-kirillmalahov/memory/feedback-orchestrate-tar-mp3-suffix-bug.md` — `.mp3` суффикс

### Для Этапа 5 (Whisper):
- `~/.claude/projects/-Users-kirillmalahov/memory/feedback-pipeline-v213-final-settings.md` — production params

### Для Этапа 7.5 (Phone resolve / GC):
- `~/.claude/projects/-Users-kirillmalahov/memory/feedback-upsert-call-canon8-mandatory.md` — Канон #8
- `/Users/kirillmalahov/smart-analyze/scripts/resolve-phones-via-gc.ts` — Playwright/HTML parsing

### Для Этапов 9-10 (Reconciliation/alerts):
- `/Users/kirillmalahov/smart-analyze/docs/canons/canon-38-reconciliation-in-cron.md`
- `~/.claude/projects/-Users-kirillmalahov/memory/feedback-canon-38-daily-reconciliation.md`

### Для общего контекста:
- `~/.claude/projects/-Users-kirillmalahov/memory/feedback-pipeline-canon-with-opus-enrich.md` — общая концепция pipeline

### Для Master Enrich интеграции (Block 7):
- `~/.claude/projects/-Users-kirillmalahov/memory/feedback-master-enrich-canon.md` — schema enriched
- `/Users/kirillmalahov/smart-analyze/docs/canons/canon-master-enrich-card.md`

### Для Канон #37 (UI consumer):
- `~/.claude/projects/-Users-kirillmalahov/memory/feedback-rop-dashboard-minimum.md`
- `/Users/kirillmalahov/smart-analyze/docs/canons/canon-37-rop-dashboard-minimum.md`

---

## 📝 Коммитить как

Каждый этап = отдельный commit с conventional message:
```
feat(cron): PBX adapter pattern (Этап 1)
feat(cron): smart-download + bin-packing FFD (Этапы 2-3)
feat(cron): GPU auto-start with watchdog (Этапы 4-6)
feat(cron): DeepSeek downstream + Stage 3.5 (Этапы 7-7.5)
feat(cron): upsert with onPBX audioUrl (Этап 8)
feat(reconciliation): 3-way diff + Telegram alert (Этапы 9-10)
feat(cron): master-pipeline orchestrator + LastSync (Этап 11)
chore(cron): backfill 28.04 manual run (ЗАДАЧА 1 success)
ops(cron): crontab install + kill switch + logrotate
```

После всех этапов — отдельный commit для crontab + production deploy.

---

## ✅ Success criteria (final, перед closing сессии)

- [ ] `scripts/backfill-pbx-audio-urls.ts` пройден — все 6126 имеют onPBX URL
- [ ] **Backfill 28.04 успешен** — count(БД 28.04) ≈ count(PBX 28.04), discrepancy < 5%
- [ ] `cron-master-pipeline.ts` создан + DoD каждого этапа пройден
- [ ] PBX adapter для onPBX/Sipuni унифицирован
- [ ] Schema `LastSync` + `ReconciliationCheck` мигрированы
- [ ] GPU auto-start с watchdog (нет silent stops в тесте)
- [ ] **audioUrl = onPBX URL** во всех новых записях (тест: SELECT)
- [ ] Reconciliation 3-way работает, alert при discrepancy > 0.05
- [ ] Crontab активен на prod + kill switch проверен
- [ ] Тестовый звонок виден в /quality через 15 мин
- [ ] 3 cron-цикла подряд без discrepancy

---

## 🚀 Готов к старту

В новой сессии копируй короткий промпт сверху → STEP 0 (2 Read'а) → resume в первом сообщении → следуй handoff'у дословно.

**Текущая сессия (где это писалось):** оставить открытой как «штаб» — здесь все каноны и backup на случай вопросов. **НЕ закрывать пока новая сессия не доложит «Backfill 28.04 success».**

Удачи 🚀
