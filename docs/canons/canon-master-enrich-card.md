# Канон Master Enrich — образец обогащения карточки звонка

**Date:** 2026-04-28
**Memory ref:** `feedback-master-enrich-canon.md`
**Образец:** `~/Desktop/v213-fix-samples/b8367ce9_enriched.md`

---

## Rule

Каждый звонок после Whisper+repair проходит через **Master Enrich** (Opus в подписке Claude Code, batch 40-50 звонков через `/enrich-calls`). Output — структурированная карточка из 6 блоков, покрывающая 100% требований анкеты клиента + наш дифференциирующий слой (психология/нейропродажи).

## Why

- **Анкета diva раздел 4-9** жёстко определяет какие данные нужны РОПу/собственнику (callType, callOutcome, criticalErrors, outcome, possible_duplicate, scriptScore). Без них Канон #37 (дашборд РОПа) показывает только metadata.
- **Психологический слой** (soft_seller, oxytocin-trigger, упущенные триггеры) — дифференциация SalesGuru vs Roistat/CoMagic (BI на CRM).
- **Opus в подписке Pro** — last-mile editor который превращает нечитабельный transcript в продакшн-аналитику. Цена $0 за подписку для текущих 5 клиентов.

## How to apply

При обогащении ОБЯЗАТЕЛЬНО заполнить все 6 блоков. Если данных нет — null (не пропускать поле).

---

## 6 блоков enriched call card

### Блок 1: METADATA (без LLM, из PBX/БД)
- `pbxUuid`, `managerExt → managerName`, `userTalkTime`, `duration`, `startStamp`, `gateway`, `hangupCause`, `clientPhone`, `direction`

### Блок 2: CALL CLASSIFICATION (анкета п.4, п.5, п.8, п.9)
- `callType`: `квалификация_лида | продажи_новый | поддержка_ученика | техвопрос | NPS | upsell | win_back | курьер | прочее`
- `callOutcome`: `real_conversation | no_answer | voicemail | hung_up | ivr`
- `hadRealConversation`: bool
- `isCurator`, `isFirstLine`: bool (per-tenant список фамилий)
- `outcome`: `closed_won | closed_lost | scheduled_callback | objection_unresolved | no_offer_made | not_applicable`
- `possible_duplicate`: bool

### Блок 3: SCRIPT COMPLIANCE (анкета п.6 — 6 критических ошибок)
- `scriptScore`: 0-9 (или 0-11 для diva)
- `scriptScorePct`: %
- `criticalErrors`: array enum (interrupted_client, no_needs_discovery, no_objection_handling, no_close_attempt, no_next_step, monolog_not_pain_tied)
- `scriptDetails`: per-stage JSON

### Блок 4: PSYCHOLOGY & NEUROSALES (наш слой)
- `psychTriggers.positive[]`: time + technique + effect (искренний_комплимент, выбор_без_выбора, эмоциональный_подхват, юмор_забота)
- `psychTriggers.missed[]`: trigger + why_missed + what_to_do
- `clientReaction`: `warm | cold | resistant | engaged | sarcastic | confused`
- `managerStyle`: `soft_seller | aggressive | empathic | neutral | technical`
- `clientEmotionPeaks[]`: where клиент включился/закрылся
- `keyClientPhrases[]`: цитаты-триггеры

### Блок 5: CONTENT (для UI / drill-down — Канон #37 Block 3)
- `cleanedTranscript` — полный, очищенный (cleanup эхо/гарбажа/восстановление порядка)
- `cleanupNotes` — что было удалено/восстановлено
- `summary` — 3-4 строки
- `managerWeakSpot` — 1 фраза для drill-down
- `criticalDialogMoments[]` — для inline разбора в UI
- `ropInsight` — 3-5 action items для РОПа
- `tags[]` — UI badges
- `nextStepRecommendation` — действия МОПа ДО следующего звонка
- `purchaseProbability` — int 0-100

### Блок 6: AGGREGATABLE FIELDS (для Канон #37 widgets)
Производные на уровне UI (group/count/avg по managerName, callOutcome, scriptScore).

### Блок 7: EXTRACTED COMMITMENTS (Promise-keeping layer — НАША killer feature)
- `extractedCommitments[]`: массив обещаний из звонка
  - `{speaker, quote, timestamp, action, deadline, target, evidence}`
  - actions: `send_whatsapp | send_email | callback | send_offer | meeting | task | other`
- `commitmentsCount`: int
- `commitmentsTracked`: bool (синхронизировано в CRM как задача)

**Цель слоя:** вытащить ВСЕ обещания МОПа и клиента из звонка, потом sync в CRM как задачи, потом проверять выполнение, потом показывать РОПу «топ нарушителей сроков». Дифференциация vs Roistat/CoMagic.

---

## Соответствие анкете diva

| Раздел анкеты | Поле в карточке |
|---|---|
| 2. Кураторы / Первая линия | `isCurator`, `isFirstLine` |
| 4. Что считать продажей | `outcome` |
| 5. Категории звонков | `callType` |
| 6. Критические ошибки | `criticalErrors` |
| 8. Дубли | `possible_duplicate` |
| 9.1 Наборы per МОП | агрегат |
| 9.2-9.4 НДЗ/АО/реальные | `callOutcome` |
| 9.5 Оценка МОП | `scriptScore` |
| 9.6-9.7 Оценка отдела/разбивки | агрегат |

100% покрытие анкеты + наш Блок 4-5 (психология/нейропродажи) — дифференциация SalesGuru.

---

## Связь с другими канонами

- **Канон #8** (PBX metadata required) — feeds Блок 1
- **Канон #37** (минимальный дашборд РОПа) — потребляет всю schema
- **feedback-pipeline-canon-with-opus-enrich.md** — где живёт этот canon (Stage 4)
- **feedback-pipeline-v213-final-settings.md** — upstream Stage 1-2

---

## Образец

`~/Desktop/v213-fix-samples/b8367ce9_enriched.md` — звонок Ольга → Елена 47, 22 мин, soft_seller, no_offer_made, scriptScore 67%, **окситоцин-trigger сработал но не использован для оффера**.
