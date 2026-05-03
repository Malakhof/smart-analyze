# Эталон C: HUNG_UP / NO_ANSWER — клиент сбросил / не ответил

**Категория:** C (HUNG_UP / NO_ANSWER) | **Master Enrich нужен?** ❌ НЕТ — skill skip Opus.
**Created for:** skill v10 contract
**Anti-hallucination role:** учит Opus, что 5 секунд «алло, сброс» — это НЕ диалог. Ставить НДЗ, не пытаться оценить «качество приветствия».

---

## Meta

| Поле | Значение |
|---|---|
| `pbxUuid` | `c3333333-cccc-4ccc-cccc-cccccccccccc` (синтетический) |
| `gcCallId` | `null` или есть (если был зарегистрирован GC) |
| `duration` | 8 sec |
| `talkDuration` | 0-2 sec |
| `hangupCause` | `ORIGINATOR_CANCEL` / `NO_ANSWER` / `USER_BUSY` |
| `category` | C — HUNG_UP / NO_ANSWER |
| `archetype` | not_applicable |
| `scriptScore` | `null` |
| `Pre-classification trigger` | `duration < 30s` AND (hangup_cause OR ультра-короткий transcript без диалога) |

---

## Пример transcript (raw)

**Вариант 1: HUNG_UP (клиент ответил и сразу сбросил)**

```
[МЕНЕДЖЕР 00:00] (Приветствие. ПД. ФИО)
[КЛИЕНТ 00:04] Алло.
[МЕНЕДЖЕР 00:05] Здравствуйте, Лариса! Это Наталья из школы Ди—
```
(гудки, сброс)

**Вариант 2: NO_ANSWER (клиент не взял трубку)**

```
(гудки)
```
(transcript практически пустой, но duration 25 sec — не A, потому что hangupCause=NO_ANSWER явный)

**Признак для skill:**
```python
if duration < 30 and (hangup_cause in ("ORIGINATOR_CANCEL", "NO_ANSWER", "USER_BUSY")):
    category = "C"
elif duration < 30 and len(transcript) < 200 and "Алло" in transcript and not has_dialogue:
    category = "C"
```

`has_dialogue` = есть хотя бы 2 реплики КЛИЕНТА с осмысленным контентом (>5 слов каждая).

---

## CLEANUP NOTES

**Не cleanup'им.** `cleanedTranscript = raw transcript` (копия). За 5 секунд нечего «очищать» — нет содержания. Любая модификация Opus'ом = выдумка.

---

## Полная ENRICHED CARD (что skill ДОЛЖЕН записать в БД)

```yaml
# === Classification ===
callOutcome: hung_up                # или 'no_answer' если клиент не взял трубку
hadRealConversation: false
callType: not_applicable
outcome: not_applicable
isCurator: null
isFirstLine: null
possibleDuplicate: null
purchaseProbability: null

# === Script (нечего оценивать) ===
scriptScore: null
scriptScorePct: null
scriptDetails: {}
criticalErrors: []

# === Psychology (нет диалога) ===
psychTriggers:
  positive: []
  missed: []
clientReaction: cold                # или 'not_engaged' — клиент не вступил в диалог
managerStyle: not_applicable
clientEmotionPeaks: []
keyClientPhrases: []
criticalDialogMoments: []

# === Phrase compliance (нечего оценивать) ===
phraseCompliance: {}

# === Content ===
cleanedTranscript: |
  [МЕНЕДЖЕР 00:00] (Приветствие. ПД. ФИО)
  [КЛИЕНТ 00:04] Алло.
  [МЕНЕДЖЕР 00:05] Здравствуйте, Лариса! Это Наталья из школы Ди—
cleanupNotes: null
callSummary: "Клиент сбросил / не ответил после короткого приветствия. Диалога не состоялось."
managerWeakSpot: null
ropInsight: "НДЗ. Возможно неудачное время — проверить эффективность звонков в этот час."
nextStepRecommendation: null

# === Commitments ===
extractedCommitments: []
commitmentsCount: 0
commitmentsTracked: false

# === Tags & status ===
enrichedTags: [hung_up, ндз]        # или [no_answer, ндз]
enrichmentStatus: enriched
enrichedBy: claude-opus-4-7-v10
```

---

## Какие поля заполнены (explicit list with values)

| Поле | Значение | Почему именно так |
|---|---|---|
| `callOutcome` | `hung_up` ИЛИ `no_answer` | Validator: `assert callOutcome in ("hung_up", "no_answer")`. Различение через hangupCause + наличие реплики клиента «Алло». |
| `hadRealConversation` | `false` | Не было реального диалога |
| `callType` | `not_applicable` | Без диалога нет категории |
| `outcome` | `not_applicable` | Не `closed_lost` — не было попытки продажи |
| `clientReaction` | `cold` или `not_engaged` | Validator: `assert clientReaction in ("cold", "not_engaged")`. `cold` для активного сброса, `not_engaged` для NO_ANSWER. |
| `managerStyle` | `not_applicable` | Не успел проявить стиль |
| `cleanedTranscript` | copy of raw | МОП всё-таки начал приветствие — РОП может прослушать (мб говорил неправильным тоном) |
| `callSummary` | Шаблонная строка | «Клиент сбросил / не ответил после короткого приветствия. Диалога не состоялось.» |
| `ropInsight` | `"НДЗ. Возможно неудачное время — проверить эффективность звонков в этот час."` | Точная строка из EDGE-CASES.md |
| `enrichedTags` | `[hung_up, ндз]` или `[no_answer, ндз]` | Validator: `assert "ндз" in tags` |

---

## Какие поля null / [] / {} / not_applicable + WHY (anti-hallucination)

| Поле | Значение | WHY |
|---|---|---|
| `scriptScore` | `null` | За 5 секунд МОП не отрабатывал 11 этапов. **Не ставить 1/11** за «приветствие» — это было обрублено. |
| `scriptDetails` | `{}` | UI ожидает empty object. |
| `criticalErrors` | `[]` | Не было возможности совершить ошибку — клиент сбросил. **НЕ ставить `interrupted_client`** — это МОПа обрубили, не наоборот. |
| `phraseCompliance` | `{}` | За 5 секунд ни одна из 12 техник не применима. |
| `psychTriggers.positive` | `[]` | **Не записывать «приветствие = искренний_комплимент»** — типичная галлюцинация Opus, защищаемся явным [] |
| `psychTriggers.missed` | `[]` | Не было реплик клиента → нет триггеров для упущения. |
| `clientEmotionPeaks` | `[]` | «Алло» не несёт эмоционального пика. |
| `keyClientPhrases` | `[]` | **Никогда не записывать «Алло» как keyClientPhrase** — это не цитата-триггер. |
| `criticalDialogMoments` | `[]` | Не было диалога. |
| `extractedCommitments` | `[]` | Никто ничего не обещал за 5 секунд. |
| `nextStepRecommendation` | `null` | **Не выдумывать «🔁 Перезвонить через час»** — это решение РОПа, не алгоритма. |
| `purchaseProbability` | `null` | Нет данных. **НЕ ставить 0** — клиент мог быть в неудобный момент. |
| `managerWeakSpot` | `null` | Не было возможности проявить слабость. |
| `cleanupNotes` | `null` | Не делали cleanup. |
| `isCurator`, `isFirstLine`, `possibleDuplicate` | `null` | Не определимо без диалога. |

**Главное правило для C:** НДЗ — это **не оценка качества звонка**, а **факт попытки дозвона**. Skill не должен пытаться найти «что МОП сделал не так за 5 секунд».

---

## Что UI рендерит / скрывает

| UI элемент | Рендерится для C? | Что показывает |
|---|---|---|
| **Шапка карточки** | ✅ Да | Бейдж «📵 Клиент сбросил» (для hung_up) или «📞 Не ответил» (для no_answer) + duration + managerName + hangupCause |
| **Плеер `<audio>`** | ⚠️ Если `audioUrl` есть | Полезно для воспроизведения — мб проблема в начале (плохой тон МОПа) |
| **GC deep-link** | ⚠️ Если `gcCallId` есть | |
| Block: callSummary | ✅ Да | Шаблон |
| Block: cleanedTranscript | ✅ Да | Раw, чтобы РОП видел что МОП успел сказать |
| Block: scriptDetails (11 этапов) | ❌ **СКРЫТЬ** | scriptScore IS NULL |
| Block: phraseCompliance | ❌ **СКРЫТЬ** | Empty object |
| Block: psychTriggers | ❌ **СКРЫТЬ** | Оба пусто |
| Block: criticalDialogMoments | ❌ **СКРЫТЬ** | Пустой массив |
| Block: keyClientPhrases | ❌ **СКРЫТЬ** | Пустой массив |
| Block: extractedCommitments | ❌ **СКРЫТЬ** | Empty array |
| Block: ropInsight | ✅ Да | «НДЗ. Возможно неудачное время...» |
| Block: nextStepRecommendation | ❌ **СКРЫТЬ** | null |
| Block: enrichedTags | ✅ Да | Чипы `hung_up`/`no_answer` + `ндз` |
| **Счётчик НДЗ** в карточке МОПа | ✅ Да | `COUNT(*) WHERE callOutcome IN ('hung_up','no_answer','voicemail','ivr')` per managerId |
| **«Эффективные часы» график** | ⚠️ Per МОПу | Если у МОПа много hung_up в одно время суток — выделить в карточке |

**Главный UX-индикатор:** **бейдж «📵 Клиент сбросил»** + НДЗ-счётчик в карточке МОПа. РОП понимает что разбирать звонок не нужно.

---

## Validator assertions (verbatim из EDGE-CASES.md)

```python
# Pre-check:
if duration < 30 and (hangup_cause in ("ORIGINATOR_CANCEL", "NO_ANSWER", "USER_BUSY")):
    category = "C"
elif duration < 30 and len(transcript) < 200 and "Алло" in transcript and not has_dialogue:
    category = "C"

# Validator (validate-enrich-sql.ts):
assert callOutcome in ("hung_up", "no_answer")
assert hadRealConversation == False
assert clientReaction in ("cold", "not_engaged")
assert "ндз" in tags
```

**Что произойдёт при fail:** UPDATE SQL отвергается, карточка → `needs_rerun_v10`.

---

## Сравнение с sample-3 / sample-4 (NORMAL) и B (VOICEMAIL)

| Параметр | sample-3 NORMAL | sample-B VOICEMAIL | sample-C HUNG_UP |
|---|---|---|---|
| Длительность | 12:00 | 17 sec | 8 sec |
| Реплики клиента | Есть, содержательные | Нет | Только «Алло» (или вообще ничего) |
| `clientReaction` | `engaged` | `silent` | `cold` / `not_engaged` |
| `hangupCause` | `NORMAL_CLEARING` | `NORMAL_CLEARING` | `ORIGINATOR_CANCEL` / `NO_ANSWER` / `USER_BUSY` |
| Полезен ли transcript? | ✅ Источник всех данных | ⚠️ Полезен (МОП-реплики) | ⚠️ Минимально полезен (можно прослушать тон) |
| `extractedCommitments` | 2 | 0-1 (если МОП оставил голосовое) | 0 (всегда) |
| Можно оценивать МОПа? | ✅ Да | ❌ Нет | ❌ Нет |

**Ключевая разница B vs C:** в B автоответчик ответил, МОП успел оставить голосовое — есть содержательная диагностика. В C клиент сбросил — нечего сохранять кроме факта НДЗ.

---

## Заметки для автора skill v10

1. **hangupCause критичен для классификации.** Skill v10 должен читать `hangupCause` из БД (заполняется sync-pipeline'ом из PBX). `ORIGINATOR_CANCEL` = клиент сбросил после ответа = `hung_up`. `NO_ANSWER` = клиент не взял трубку = `no_answer`. `USER_BUSY` = занято (тоже категория C, тег `no_answer`).
2. **Различение C vs A.** Если duration < 30s но transcript содержит ≤ 100 chars — это категория **A** (NO_SPEECH) приоритетнее. Decision tree в CATEGORIES.md ставит A первой.
3. **Различение C vs E.** Если duration 30-60s и в transcript есть содержательный обмен с просьбой переноса — это **E** (SHORT_RESCHEDULE), не C. C — это ультракороткие до 30s.
4. **Опциональный nuance:** если у одного МОПа >40% звонков уходят в `hung_up` — это может быть проблема с базой (неактуальные номера) или плохое начало приветствия. Аггрегат для алерта в карточке МОПа.

---

**Last updated: 2026-05-03**
**Created for: skill v10 contract**
