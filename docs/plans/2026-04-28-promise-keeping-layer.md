# Promise-keeping layer (Block 7) — план развития

**Date:** 2026-04-28
**Status:** Block 7 schema добавлен, extract в `/enrich-calls` готов. Sync в CRM + tracking + UI — следующая итерация.
**Killer feature:** **никто из конкурентов** (Roistat / CoMagic / Calltouch) не делает promise tracking.

---

## Идея

Из каждого звонка вытаскиваем ВСЕ обещания/задачи/договорённости (МОПа и клиента) → синхронизируем в CRM как задачи → проверяем выполнение → показываем РОПу «топ нарушителей сроков».

## Зачем

- РОП **не слушает** все звонки — видит только метрики
- МОПы **обещают** прислать КП/перезвонить — половина не делает
- **Прямая монетизация:** "сколько денег потеряно из-за невыполненных обещаний"
- Клиент тоже даёт обещания ("пришлю скрин оплаты", "посоветуюсь с мужем 7 дней") → tracking client-side → cold leads оживают

## Архитектура (3 фазы)

### ✅ Фаза 1: EXTRACT (СДЕЛАНО — 2026-04-28)
- Schema: `extractedCommitments JSONB`, `commitmentsCount INT`, `commitmentsTracked BOOL`
- Skill `/enrich-calls` извлекает обещания (Block 7 в SKILL.md)
- Каждое обещание: `{speaker, quote, timestamp, action, deadline, target, evidence}`
- Actions: `send_whatsapp | send_email | send_telegram | callback | send_offer | send_link | meeting | task | bring_documents | other`

### 🟡 Фаза 2: SYNC в CRM (~2-3 дня)

**Скрипт:** `scripts/sync-commitments-to-crm.ts`

```
For each CallRecord WHERE commitmentsTracked = false:
  For each commitment in extractedCommitments:
    if speaker = 'МЕНЕДЖЕР':
      → создать задачу в CRM на МОПа
        - amoCRM: POST /api/v4/leads/tasks
          { responsible_user_id: managerCrmId,
            entity_id: dealCrmId,
            entity_type: 'leads',
            text: action + target,
            complete_till: deadline_unix }
        - GC: использовать gcContactId для контакта, создать задачу
    if speaker = 'КЛИЕНТ':
      → создать reminder для МОПа "клиент обещал X к Y"

  UPDATE commitmentsTracked = true
```

**Запуск:** cron каждые 30 минут (после daily enrich) или сразу после `/enrich-calls`.

**Per-tenant различия:**
| Tenant | CRM | Endpoint |
|---|---|---|
| diva | GetCourse | scrape/API tasks |
| vastu / reklama / coral | amoCRM | `/api/v4/leads/tasks` |

### 🔴 Фаза 3: TRACK выполнение (~1-2 дня)

**Скрипт:** `scripts/verify-commitments.ts` (cron daily 09:00)

```
Получить все задачи созданные >24h назад
For each task:
  Проверить статус в CRM (closed=true/false, complete_till passed)
  Записать в БД CommitmentStatus:
    - on_time | overdue | missed | completed_late
  
  if missed:
    → red flag для РОПа в Канон #37 Block 6
```

**Дополнительно:** проверять реальную отправку через:
- amoCRM `/api/v4/leads/{id}/notes` — есть ли сообщение в WhatsApp с прикрепленным КП?
- GC: проверить что email/telegram отправлены через ChatBot API

### 🟢 Фаза 4: UI Block 6 «Невыполненные обещания» (~1 день)

В дашборде РОПа Канон #37 — добавить блок:

```
┌─ 🚨 Невыполненные обещания (последние 7 дней) ────────┐
│  Топ нарушителей:                                        │
│  • Ольга — 12 пропущенных (5 КП, 4 перезвона, 3 ссылки) │
│  • Татьяна — 8 пропущенных                              │
│  • Наталья — 3 пропущенных                              │
│                                                           │
│  Просрочка > 48ч: 23 обещания                            │
│  Click → drill-down: список звонков + цитаты + дата     │
└──────────────────────────────────────────────────────────┘
```

---

## Метрики успеха

| Метрика | Целевое значение |
|---|---|
| Обещаний извлекается per звонок | 1-3 (норма для diva) |
| Точность extract (manual review) | ≥85% |
| Sync в CRM success rate | ≥95% |
| Reduction просроченных обещаний за месяц после внедрения | -50% |

---

## Risks

1. **False positives** — Skill может выдумать обещание ("МОП сказала 'будем на связи' ≠ конкретное обещание")
   - Mitigation: жёсткий промпт + manual review первые 50 batch'ей
2. **CRM rate limits** — amoCRM 7 req/sec, GC ~1 req/sec
   - Mitigation: batch + queue
3. **МОПы будут саботировать** — закроют задачи в CRM не выполнив
   - Mitigation: проверять реальные WhatsApp/email отправки (Фаза 3)

---

## Связь с другими канонами

- `feedback-master-enrich-canon.md` — Block 7 schema
- `feedback-rop-dashboard-minimum.md` — Канон #37 потребитель Block 6
- `feedback-pipeline-canon-with-opus-enrich.md` — где Block 7 живёт в flow
- `docs/canons/canon-master-enrich-card.md` — компилированный canon (обновлён)

---

## Status (2026-04-28)

- ✅ Schema migration (`extractedCommitments`, `commitmentsCount`, `commitmentsTracked`) применена
- ✅ `/enrich-calls` skill обновлён — извлекает Block 7
- ⏳ Sync скрипт — следующая итерация (после успешного backfill 857)
- ⏳ Tracking cron — следующая итерация
- ⏳ UI Block 6 — следующая итерация
