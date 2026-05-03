# Эталон B: VOICEMAIL / IVR — автоответчик / голосовое меню

**Категория:** B (VOICEMAIL/IVR) | **Master Enrich нужен?** ❌ НЕТ — skill skip Opus, заполняет шаблонно.
**Created for:** skill v10 contract
**Anti-hallucination role:** учит Opus, что только МОП-реплики ≠ диалог. Не оценивать как звонок, засчитывать как НДЗ (попытка дозвона).

---

## Meta

| Поле | Значение |
|---|---|
| `pbxUuid` | `b2222222-bbbb-4bbb-bbbb-bbbbbbbbbbbb` (синтетический) |
| `gcCallId` | `null` (часто отсутствует) |
| `duration` | 17 sec |
| `talkDuration` | 0 sec (живого разговора не было) |
| `category` | B — VOICEMAIL/IVR |
| `archetype` | not_applicable |
| `scriptScore` | `null` |
| `Pre-classification trigger` | `manager_lines AND not client_lines` ИЛИ voicemail-маркеры в transcript |

---

## Пример transcript (raw)

```
[МЕНЕДЖЕР 00:00] Алло, Лариса, здравствуйте!
[МЕНЕДЖЕР 00:03] Лариса, это Наталья из школы Дива.
[МЕНЕДЖЕР 00:08] Алло, вы меня слышите?
[АВТООТВЕТЧИК 00:10] Вызываемый абонент не отвечает. После сигнала вы можете оставить голосовое сообщение.
[МЕНЕДЖЕР 00:14] Лариса, перезвоню вам ещё раз сегодня в 16:00. До свидания.
```

(Альтернативные варианты что попадает в категорию B:)
- IVR корпоративного номера: `Здравствуйте, вы позвонили в компанию X. Для отдела продаж нажмите 1...`
- Только МОП-реплики без markers, но без ответов клиента (МОП говорит «алло, алло» три раза в пустоту)
- DeepSeek уже определил `callType=VOICEMAIL` на predeepseek-этапе

**Признак для skill:**
```python
manager_lines = re.findall(r"\[МЕНЕДЖЕР", transcript)
client_lines = re.findall(r"\[КЛИЕНТ", transcript)
voicemail_markers = re.search(r"вызываемый\s+абонент|оставайтесь\s+на\s+линии|после\s+сигнала", transcript, re.I)

if (manager_lines and not client_lines) or voicemail_markers:
    category = "B"
```

---

## CLEANUP NOTES

**Не cleanup'им.** Для категории B `cleanedTranscript = raw transcript` (копия). Причина: автоответчик и реплики МОПа — это содержательная диагностика для РОПа («МОП оставил голосовое в 16:00 — это commitment»). Любая «нормализация» может удалить важное.

Исключение: если МОП оставил голосовое сообщение типа «перезвоню в 14:00» — это пишется в `extractedCommitments`. Сам transcript при этом всё равно копируется raw.

---

## Полная ENRICHED CARD (что skill ДОЛЖЕН записать в БД)

```yaml
# === Classification ===
callOutcome: voicemail              # или 'ivr' если корпоративный robot-меню
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
clientReaction: silent
managerStyle: not_applicable
clientEmotionPeaks: []
keyClientPhrases: []
criticalDialogMoments: []

# === Phrase compliance (нечего оценивать) ===
phraseCompliance: {}

# === Content ===
cleanedTranscript: |
  [МЕНЕДЖЕР 00:00] Алло, Лариса, здравствуйте!
  [МЕНЕДЖЕР 00:03] Лариса, это Наталья из школы Дива.
  [МЕНЕДЖЕР 00:08] Алло, вы меня слышите?
  [АВТООТВЕТЧИК 00:10] Вызываемый абонент не отвечает. После сигнала вы можете оставить голосовое сообщение.
  [МЕНЕДЖЕР 00:14] Лариса, перезвоню вам ещё раз сегодня в 16:00. До свидания.
cleanupNotes: null
callSummary: "Автоответчик/IVR. Менеджер не дозвонился до клиента. МОП оставил голосовое: обещание перезвонить в 16:00."
managerWeakSpot: null
ropInsight: "Засчитывается как НДЗ (попытка дозвона). Контролировать частоту повторных попыток."
nextStepRecommendation: null

# === Commitments (опционально — если МОП оставил голосовое) ===
extractedCommitments:
  - speaker: МЕНЕДЖЕР
    quote: "перезвоню вам ещё раз сегодня в 16:00"
    timestamp: "00:14"
    action: callback
    deadline: "сегодня 16:00"
    target: "перезвонить клиенту"
commitmentsCount: 1
commitmentsTracked: false

# === Tags & status ===
enrichedTags: [voicemail, ндз]
enrichmentStatus: enriched
enrichedBy: claude-opus-4-7-v10
```

---

## Какие поля заполнены (explicit list with values)

| Поле | Значение | Почему именно так |
|---|---|---|
| `callOutcome` | `voicemail` ИЛИ `ivr` | `voicemail` = голосовая почта абонента; `ivr` = корпоративный robot-меню. Validator: `assert callOutcome in ("voicemail", "ivr")` |
| `hadRealConversation` | `false` | Клиент не сказал ни слова |
| `callType` | `not_applicable` | Не было разговора, чтобы классифицировать |
| `outcome` | `not_applicable` | Не applicable — лида не было |
| `clientReaction` | `silent` | Validator: `assert clientReaction == "silent"` |
| `managerStyle` | `not_applicable` | МОП не успел проявить стиль |
| `cleanedTranscript` | copy of raw | Сохраняем чтобы РОП видел что именно МОП оставил |
| `callSummary` | Шаблон + конкретика про commitment если есть | «Автоответчик/IVR. Менеджер не дозвонился до клиента. <опц: МОП оставил голосовое: обещание X.>» |
| `ropInsight` | `"Засчитывается как НДЗ (попытка дозвона). Контролировать частоту повторных попыток."` | Точная строка из EDGE-CASES.md |
| `enrichedTags` | `[voicemail, ндз]` или `[ivr, ндз]` | Validator: `assert "voicemail" in tags or "ivr" in tags` И `assert "ндз" in tags` |
| `extractedCommitments` | `[{speaker: МЕНЕДЖЕР, action: callback, ...}]` ИЛИ `[]` | **Опционально** — заполняется если МОП в голосовом обещал перезвонить с конкретным временем |

---

## Какие поля null / [] / {} / not_applicable + WHY (anti-hallucination)

| Поле | Значение | WHY |
|---|---|---|
| `scriptScore` | `null` | За попытку дозвона МОП не отрабатывал 11 этапов скрипта. **Не ставить 1/11** за «приветствие» — приветствие в пустоту ≠ выполненный этап. |
| `scriptDetails` | `{}` | UI безопасный empty object. Validator проверяет тип. |
| `criticalErrors` | `[]` | МОП не мог совершить ошибку — не было собеседника. |
| `phraseCompliance` | `{}` | Все 12 техник diva требуют диалога. Без клиента — нечего оценивать. |
| `psychTriggers.positive` | `[]` | **Не записывать «приветствие = искренний_комплимент»** — это в пустоту. |
| `psychTriggers.missed` | `[]` | Чтобы что-то «упустить», нужна реплика клиента — её нет. |
| `clientEmotionPeaks` | `[]` | Нет эмоций клиента. |
| `keyClientPhrases` | `[]` | **Никогда не записывать фразу автоответчика как keyClientPhrase.** Это не клиент. |
| `criticalDialogMoments` | `[]` | Не было диалога. |
| `nextStepRecommendation` | `null` | **Не выдумывать «🔁 Перезвонить»** — это уже зафиксировано в commitment если МОП обещал. Шаблонную рекомендацию РОП может написать сам через UI. |
| `purchaseProbability` | `null` | Нет данных. **НЕ ставить 0** — мы не знаем, заинтересован клиент или нет. |
| `managerWeakSpot` | `null` | Не было возможности проявить слабость. |
| `isCurator`, `isFirstLine`, `possibleDuplicate` | `null` | Без диалога невозможно определить. |

**Важный nuance vs A:** для B мы **сохраняем cleanedTranscript полностью** (там есть полезная диагностика — что именно МОП говорил, оставил ли голосовое). Для A — там только Whisper-галлюцинация типа `Ого!`, оставляем для трейсинга но не для смысла.

---

## Что UI рендерит / скрывает (cross-ref ui-enrichment-contract.md)

| UI элемент | Рендерится для B? | Что показывает |
|---|---|---|
| **Шапка карточки** | ✅ Да | Бейдж «📞 Автоответчик / IVR» + duration + managerName |
| **Плеер `<audio>`** | ✅ Если `audioUrl` есть | РОП может прослушать что МОП наговорил в voicemail |
| **GC deep-link** | ⚠️ Если `gcCallId` есть | Часто отсутствует |
| Block: callSummary | ✅ Да | Шаблонная строка |
| Block: cleanedTranscript | ✅ Да | Полный raw — РОП видит что говорил МОП |
| Block: scriptDetails (11 этапов) | ❌ **СКРЫТЬ** | scriptScore IS NULL → не рендерить |
| Block: phraseCompliance (12 техник) | ❌ **СКРЫТЬ** | Object empty → скрыть |
| Block: psychTriggers | ❌ **СКРЫТЬ** | Оба массива пустые |
| Block: criticalDialogMoments | ❌ **СКРЫТЬ** | Пустой массив |
| Block: keyClientPhrases | ❌ **СКРЫТЬ** | Пустой массив |
| **Block: extractedCommitments (Block 7)** | ⚠️ **УСЛОВНО** | Если `commitmentsCount > 0` — показать (МОП оставил голосовое с обещанием). Если `=0` — скрыть. |
| Block: ropInsight | ✅ Да | «Засчитывается как НДЗ...» |
| Block: nextStepRecommendation | ❌ **СКРЫТЬ** | null |
| Block: enrichedTags | ✅ Да | Чипы `voicemail` / `ivr` + `ндз` |
| Счётчик НДЗ в карточке МОПа | ✅ Да | Агрегат `COUNT(*) WHERE callOutcome IN ('voicemail','ivr','hung_up','no_answer')` |
| Алерт «частота повторных попыток» | ⚠️ Пер МОПу | Если у одного МОПа >30% звонков уходят в voicemail — в карточке МОПа красная точка |

**Главный UX-индикатор:** **бейдж «📞 Автоответчик / IVR»** + если был commitment — мини-блок «МОП обещал перезвонить в 16:00» с tracking-флагом для РОПа.

---

## Validator assertions (verbatim из EDGE-CASES.md)

```python
# Pre-check:
manager_lines = re.findall(r"\[МЕНЕДЖЕР", transcript)
client_lines = re.findall(r"\[КЛИЕНТ", transcript)
voicemail_markers = re.search(r"вызываемый\s+абонент|оставайтесь\s+на\s+линии|после\s+сигнала", transcript, re.I)
if (manager_lines and not client_lines) or voicemail_markers:
    category = "B"

# Validator (validate-enrich-sql.ts):
assert callOutcome in ("voicemail", "ivr")
assert hadRealConversation == False
assert callType == "not_applicable"
assert scriptScore is None
assert clientReaction == "silent"
assert "voicemail" in tags or "ivr" in tags
assert "ндз" in tags

# Optional поля (могут быть):
# - extractedCommitments — если МОП оставил голосовое сообщение
#   типа "перезвоню в 14:00", фиксировать как commit_to_callback
```

**Что произойдёт при fail:** UPDATE SQL не выполнится, карточка вернётся в `needs_rerun_v10`.

---

## Сравнение с sample-3 / sample-4 (NORMAL) и sample-A

| Параметр | sample-3 (NORMAL) | sample-A (NO_SPEECH) | sample-B (VOICEMAIL) |
|---|---|---|---|
| Длительность | 12:00 | 4 sec | 17 sec |
| Реплики клиента | Есть | Нет | Нет (только МОП + автоответчик) |
| `cleanedTranscript` | очищенный, compression 21% | копия raw `Ого!` | копия raw (МОП-реплики важны для РОПа) |
| `extractedCommitments` | 2 | `[]` | `[1]` если МОП оставил голосовое, иначе `[]` |
| `enrichedTags` | архетип-теги (`empathic_seller` etc) | `[no_speech, не_оценивается]` | `[voicemail/ivr, ндз]` |
| Ключевая seman | «оценить как МОП работал» | «звонок без речи — диагностика» | «попытка дозвона, контролировать частоту» |
| НДЗ-счётчик | ❌ нет | ❌ нет | ✅ +1 для МОПа |

**Ключевая разница A vs B:** в B мы **сохраняем смысл** (МОП-реплики, его голосовое сообщение — это commitment). В A смысла нет вообще.

---

## Заметки для автора skill v10

1. **Различение voicemail vs ivr:** voicemail = голосовая почта конкретного абонента (после «вызываемый абонент не отвечает»); ivr = корпоративный robot-меню («нажмите 1 для отдела продаж»). Эту разницу определяет regex по содержимому. По умолчанию ставим `voicemail`.
2. **Commitment extraction для B:** если в МОП-репликах есть pattern `(перезвоню|свяжусь|напишу).*((сегодня|завтра|в \d+:\d+))` — извлекаем как commitment. Это дешёвый regex, не нужно Opus.
3. **Не вызывать Opus.** Как и для A — детерминированное заполнение skill'ом.
4. **Алерт-логика для РОПа:** если у МОПа >30% звонков попадают в voicemail/ivr/hung_up — это сигнал «звонит в нерабочее время» или «не работает с базой». Это аггрегат на уровне `/managers/[id]`.

---

**Last updated: 2026-05-03**
**Created for: skill v10 contract**
