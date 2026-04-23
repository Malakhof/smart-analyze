# Diva Full Backfill + GC Linking + Auto-Update — Production Plan

**Date:** 2026-04-23
**Status:** READY TO EXECUTE
**Total cost:** ~750₽ (one-time historical) + ~3000₽/мес (operating)
**Total time:** Historical 2.3ч (3 GPU) | New code: ~2ч

---

## Context

После 8-часовой работы pipeline v2.4 доказал 100% точность на smoke test (15/15 = 10/10 на diva). Архитектура production-ready: Whisper → AI roles → channel-first merge → voicemail filter → repair → script score.

Время запустить full backfill 1786 real звонков diva с 10.04 + настроить связку с GC карточками + cron auto-update новых звонков.

---

## Goal

1. **Транскрибировать 1786 onPBX real звонков** диvы с 10.04 по сегодня
2. **Связать каждый с существующей CallRecord** в БД (phone+timestamp matching) — UPDATE, не INSERT
3. **Архивировать старые моно звонки** (до 10.04) — в БД остаются, в UI скрыты по дефолту
4. **Cron auto-update** каждые 15 мин — новые звонки → pipeline → DB

---

## Архитектурные решения

### Решение 1: Связка onPBX ↔ GC карточки

**Проблема:** onPBX UUID и GC `crmId` — разные ID систем. 0 overlap по ID.

**Логика клиента (правильная):** каждый звонок onPBX → автоматически карточка в GC через встроенную интеграцию. Карточка существует **гарантированно**. Нужно только её найти.

**Matching key:** `phone + start_timestamp ±2 минуты` — уникальный и надёжный.

```python
для каждого onPBX звонка:
  1. Транскрипция (Intelion v2.4)
  2. Получаем (uuid, destination_number, start_stamp, transcript, callType, scriptScore)
  3. Нормализуем phone: 79126922321 (без + и 8)
  4. SELECT * FROM CallRecord
     WHERE tenantId = diva
     AND clientPhone matches (with/without +)
     AND ABS(EXTRACT(EPOCH FROM createdAt - to_timestamp(start_stamp))) < 120
  5. Match найден → UPDATE existing record
     Match НЕ найден → log "edge case", НЕ создавать новый
```

Edge cases (звонок реально не в GC) — крайне редко (<1%), логируем для investigation.

### Решение 2: Архив старых звонков (до 10.04)

**НЕ удаляем** — оставляем в БД для истории.
**Скрываем** в UI по дефолту через `Tenant.analyticsStartDate`.

```sql
-- Migration:
ALTER TABLE "Tenant" ADD COLUMN "analyticsStartDate" TIMESTAMP;
UPDATE "Tenant" SET "analyticsStartDate" = '2026-04-10' WHERE name='diva-school';
```

**Все queries по умолчанию:**
```sql
WHERE c."createdAt" >= t."analyticsStartDate"
```

**UI:**
- Дефолт страниц = "с 10.04 (pipeline v2.4 verified data)"
- Toggle "Показать архив" в шапке `/quality` → отключает фильтр
- Архивные данные — серым, помечены "Legacy, моно, score нерелевантен"

**Что архивируется для diva:**
- 5269 calls до 18.04 (445 транскрибированных моно) — в shadow
- 138K deals — оставляем (история конверсий)
- 24K messages — оставляем (текстовая часть работает)
- 22 МОПов — оставляем (структура)

### Решение 3: Auto-update — Cron pull every 15 min

**Не webhook** (тариф onPBX вряд ли даёт), а cron pull:

```
*/15 * * * *  /root/smart-analyze/scripts/pull-and-process-onpbx.sh diva-school
```

**Скрипт:**
1. Pull `mongo_history/search.json` (последние 30 мин — overlap для надёжности)
2. SELECT max(externalId) FROM CallRecord WHERE source='onpbx_diva'
3. Diff = новые UUIDs которых нет в БД
4. Если diff > 0:
   - Старт Intelion server (если выключен)
   - Транскрибировать → AI roles → orchestrate → repair → callType → scriptScore
   - Phone matching → UPDATE CallRecord
   - Stop Intelion если очередь пустая
5. Если diff = 0: ничего не делаем, Intelion остаётся выключен

**Latency:** среднее 7-8 минут от конца звонка до записи в БД.
**Cost:** только когда есть звонки (Intelion pay-per-second).

---

## Deliverables

### Pre-existing (готовое из прошлых сессий)
- ✅ `scripts/intelion-transcribe-v2.py` (v2.4 channel-first + AI roles)
- ✅ `scripts/orchestrate-pipeline.py` (re-merge с AI ролями)
- ✅ `scripts/detect-channel-roles.ts` (DeepSeek role detector)
- ✅ `scripts/detect-call-type.ts` (voicemail/IVR)
- ✅ `scripts/repair-transcripts.ts` (glossary)
- ✅ `scripts/score-diva-script-compliance.ts` (11-этапный scorer)
- ✅ Schema migration applied (callType, scriptScore, scriptDetails, transcriptRepaired)

### Новые скрипты для этого плана
1. `scripts/build-batch-from-onpbx.ts` (~30 мин) — pull onPBX 10.04+ → JSONL батч
2. `scripts/link-pbx-to-gc.ts` (~45 мин) — phone+time matching → UPDATE CallRecord
3. `scripts/pull-and-process-onpbx.sh` (~30 мин) — cron orchestrator (полный цикл)
4. Migration `analyticsStartDate` (~10 мин)
5. UI patch `/quality` page — фильтр "с analyticsStartDate" + toggle "архив" (~30 мин)

---

## Steps

### Step 1: Запустить full backfill 1786 звонков (~2.3ч на 3 GPU)

```bash
# 1. Re-auth onPBX, build batch
node scripts/build-batch-from-onpbx.ts --tenant=diva-school --since=2026-04-10 --real-only > /tmp/batch-1786.jsonl

# 2. Run full pipeline (3 GPU parallel)
./scripts/run-full-pipeline.sh /tmp/batch-1786.jsonl /tmp/runs/diva-historical --gpus=3
```

**Cost:** Intelion 3×2.3h×47.6₽ = ~324₽ + DeepSeek (roles+voicemail+repair+score) = ~430₽ = **~750₽**

**Output:** /tmp/runs/diva-historical/merged.jsonl с 1786 транскриптами + AI roles applied.

### Step 2: Schema migration analyticsStartDate (~10 мин)

```sql
ALTER TABLE "Tenant" ADD COLUMN "analyticsStartDate" TIMESTAMP;
UPDATE "Tenant" SET "analyticsStartDate" = '2026-04-10' WHERE name='diva-school';
-- Other tenants get NULL (no archive distinction yet)
```

### Step 3: Phone+time matching script (~45 мин)

`scripts/link-pbx-to-gc.ts`:
```typescript
const norm = (p: string) => p.replace(/[^0-9]/g, '').replace(/^8/, '7')
for each pbx_call from /tmp/runs/diva-historical/merged.jsonl:
  const candidates = await prisma.callRecord.findMany({
    where: {
      tenantId: diva_id,
      clientPhone: { in: [norm(pbx.phone), '+'+norm(pbx.phone)] },
      createdAt: {
        gte: new Date(pbx.start_stamp*1000 - 120_000),
        lte: new Date(pbx.start_stamp*1000 + 120_000),
      }
    }
  })
  if (candidates.length === 1) {
    await update(candidates[0].id, { transcript, transcriptRepaired, callType, scriptScore, scriptDetails })
    matched++
  } else if (candidates.length > 1) {
    log warn "ambiguous", pick closest by time
    matched++
  } else {
    log "edge case — no match", save to /tmp/runs/diva-historical/no-match.jsonl
    unmatched++
  }
```

**Expected results:** ~95% matched, <5% edge cases.

### Step 4: UI обновление — analyticsStartDate filter + archive toggle (~30 мин)

`src/lib/queries/quality.ts`:
- В `qcCallWhere` добавить `createdAt: { gte: tenant.analyticsStartDate }`
- Если URL param `?archive=1` — снять фильтр

`src/app/(dashboard)/quality/page.tsx`:
- Добавить badge "Данные с 10.04" + toggle "Показать архив"

### Step 5: Cron auto-update setup (~30 мин)

`scripts/pull-and-process-onpbx.sh`:
```bash
#!/bin/bash
# Daily delta pull and process
TENANT=$1  # e.g. diva-school
LAST_TS=$(docker exec smart-analyze-db psql -t -c "
  SELECT EXTRACT(EPOCH FROM MAX(\"createdAt\"))::int FROM \"CallRecord\" c
  JOIN \"Tenant\" t ON c.\"tenantId\"=t.id
  WHERE t.name='$TENANT' AND c.transcript IS NOT NULL
")

# Pull onPBX since last_ts
node scripts/build-batch-from-onpbx.ts --tenant=$TENANT --since-ts=$LAST_TS > /tmp/delta.jsonl

LINES=$(wc -l < /tmp/delta.jsonl)
if [ "$LINES" -eq "0" ]; then
  exit 0
fi

# Process via orchestrator (single GPU for daily volume)
./scripts/run-full-pipeline.sh /tmp/delta.jsonl /tmp/runs/$(date +%Y%m%d-%H%M)-$TENANT --gpus=1
node scripts/link-pbx-to-gc.ts /tmp/runs/.../merged.jsonl
```

**Cron entry:** `*/15 * * * * /root/smart-analyze/scripts/pull-and-process-onpbx.sh diva-school >> /var/log/salesguru.log 2>&1`

---

## Verification

После Step 1+3:
- В БД: `SELECT COUNT(*) FROM CallRecord WHERE tenantId=diva AND transcript IS NOT NULL AND createdAt >= '2026-04-10'` ≈ 1786
- Cross-check: `/quality?from=2026-04-10` показывает все 1786 с метриками
- Edge cases logged: `wc -l /tmp/runs/diva-historical/no-match.jsonl` < 100

После Step 4:
- `/quality` по дефолту показывает только данные с 10.04
- Toggle "Архив" → снимает фильтр, показывает всё включая legacy моно

После Step 5:
- Cron в `/etc/cron.d/salesguru-onpbx-pull`
- Каждые 15 мин — лог в `/var/log/salesguru.log`
- При новых звонках — Intelion стартует/останавливается автоматически

---

## Out of scope

- Webhooks от onPBX (Phase 2 если тариф позволит)
- Real-time alerts (МОП молчит N часов) — отдельная фича
- Pre-10.04 retroactive (моно — не имеет смысла)
- Vastu/Reklama equivalent setup — после успеха diva
- Phone matching ↔ Contact в GC для 100% линковки — отдельный полировочный pass

---

## Risks

| Risk | Mitigation |
|---|---|
| Phone matching <80% accuracy | Logging + manual review of edge cases |
| Intelion timeout/SSL gremlin | Retry logic + локальный download fallback |
| Daily cost >ожидание | Pay-per-second + auto-stop = только реальный расход |
| onPBX URL expiry (30 мин) | Re-resolve в момент start, не предварительно |
| Tenant.analyticsStartDate ломает старые dashboards | A/B rollout — сначала /quality, потом остальное |

---

## Cost summary

| Этап | One-time | Monthly |
|---|---|---|
| Backfill 1786 | ~750₽ | — |
| Coding (5 scripts) | ~2ч моего времени | — |
| Daily cron Intelion (~30 мин/день) | — | ~700₽/мес |
| DeepSeek runtime (~50 calls/день) | — | ~50₽/мес |
| **TOTAL** | **~750₽** | **~750₽/мес** |

Окупается за **1 месяц подписки 1 клиента**.
