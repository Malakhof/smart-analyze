# Эталон D: TECHNICAL — МОП и клиент не слышат друг друга

**Категория:** D (TECHNICAL) | **Master Enrich нужен?** ❌ НЕТ — skill skip Opus.
**Created for:** skill v10 contract
**Anti-hallucination role:** учит Opus, что повторяющиеся «Алло, слышите?» с обеих сторон — это не диалог. Это технический срыв, диагностика для тех. отдела, не оценка МОПа.

---

## Meta

| Поле | Значение |
|---|---|
| `pbxUuid` | `d4444444-dddd-4ddd-dddd-dddddddddddd` (синтетический) |
| `gcCallId` | может быть (звонок зарегистрирован в GC) |
| `duration` | 42 sec |
| `talkDuration` | 30 sec (МОП и клиент говорили, но не слышали друг друга) |
| `category` | D — TECHNICAL |
| `archetype` | not_applicable |
| `scriptScore` | `null` |
| `Pre-classification trigger` | ≥2 tech-маркеров AND not content_substantial |

---

## Пример transcript (raw)

```
[МЕНЕДЖЕР 00:00] Алло, Лариса, здравствуйте!
[КЛИЕНТ 00:03] Алло? Алло? Я вас не слышу.
[МЕНЕДЖЕР 00:05] Лариса, вы меня слышите?
[КЛИЕНТ 00:09] Алло? Кто это?
[МЕНЕДЖЕР 00:12] Это Наталья из школы Ди—
[КЛИЕНТ 00:14] Алло, плохо слышно, перезвоните пожалуйста!
[МЕНЕДЖЕР 00:18] Лариса, вы меня слышите? Алло?
[КЛИЕНТ 00:23] Я вас не слышу, перезвоните!
[МЕНЕДЖЕР 00:27] Хорошо, перезвоню сейчас!
[КЛИЕНТ 00:30] Алло? Алло? Перезвоните, плохая связь!
[МЕНЕДЖЕР 00:35] Лариса, я перезвоню, не отключайтесь —
(гудки)
```

**Признак для skill:**
```python
tech_markers = re.findall(
    r"вы\s+меня\s+слышите|алло[\s,.!]+алло|плохо\s+слышно|перезвоните",
    transcript, re.I
)
content_substantial = (
    len(transcript) > 200
    and not all(line_is_short_phatic(l) for l in transcript.splitlines())
)
if len(tech_markers) >= 2 and not content_substantial:
    category = "D"
```

`line_is_short_phatic` — фраза ≤ 5 слов из набора {алло, слышите, перезвоните, плохо, не слышу, …}.

---

## CLEANUP NOTES

**Не cleanup'им.** `cleanedTranscript = raw transcript` (копия). Причина: повторяющиеся «алло» — это **диагностический паттерн** для тех. отдела (показывает кто не слышал — МОП или клиент). Любое сжатие удалит эту инфу.

Optional уточнение: можно добавить `[plural_alloes_detected: 5]` в notes — но не модифицировать transcript.

---

## Полная ENRICHED CARD (что skill ДОЛЖЕН записать в БД)

```yaml
# === Classification ===
callOutcome: technical_issue
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

# === Psychology (нет содержательного диалога) ===
psychTriggers:
  positive: []
  missed: []
clientReaction: confused
managerStyle: not_applicable
clientEmotionPeaks: []
keyClientPhrases: []
criticalDialogMoments: []

# === Phrase compliance (нечего оценивать) ===
phraseCompliance: {}

# === Content ===
cleanedTranscript: |
  [МЕНЕДЖЕР 00:00] Алло, Лариса, здравствуйте!
  [КЛИЕНТ 00:03] Алло? Алло? Я вас не слышу.
  [МЕНЕДЖЕР 00:05] Лариса, вы меня слышите?
  ...(полный raw)...
cleanupNotes: null
callSummary: "Технические проблемы связи — клиент и МОП не слышат друг друга. Звонок не состоялся как диалог."
managerWeakSpot: null
ropInsight: "Проверить качество связи. Если повторяется у конкретного МОПа — проблема гарнитуры/SIP. Засчитать как НДЗ для отчёта. ДИАГНОСТИЧЕСКИЙ ВОПРОС: если у этого МОПа >5% звонков с tag=technical_issue → проверить hardware (гарнитура / SIP / интернет-канал)."
nextStepRecommendation: null

# === Commitments ===
extractedCommitments: []
commitmentsCount: 0
commitmentsTracked: false

# === Tags & status ===
enrichedTags: [technical_issue, тех_проблема, ндз]
enrichmentStatus: enriched
enrichedBy: claude-opus-4-7-v10
```

---

## Какие поля заполнены (explicit list with values)

| Поле | Значение | Почему именно так |
|---|---|---|
| `callOutcome` | `technical_issue` | Validator: `assert callOutcome == "technical_issue"`. Единственный enum для D. |
| `hadRealConversation` | `false` | Технические реплики ≠ диалог |
| `callType` | `not_applicable` | Не было содержательной классификации |
| `outcome` | `not_applicable` | Лида не было |
| `clientReaction` | `confused` | Validator: `assert clientReaction == "confused"`. Клиент пытался разговаривать, но не понимал что происходит. |
| `managerStyle` | `not_applicable` | Не успел проявить стиль |
| `cleanedTranscript` | copy of raw | Сохраняем для тех. отдела — паттерн «5 alloes» это диагностика |
| `callSummary` | Шаблонная строка | «Технические проблемы связи — клиент и МОП не слышат друг друга. Звонок не состоялся как диалог.» |
| `ropInsight` | Расширенный шаблон + диагностический вопрос | Из EDGE-CASES.md: «Special: ropInsight должен включать диагностический вопрос для РОПа: "Если у этого МОПа повторяется → проблема гарнитуры/SIP". Cron daily summary считает D-звонков per МОП — если у одного >5%, alert.» |
| `enrichedTags` | `[technical_issue, тех_проблема, ндз]` | Validator: `assert "тех_проблема" in tags or "technical_issue" in tags` AND `assert "ндз" in tags` |

---

## Какие поля null / [] / {} / not_applicable + WHY (anti-hallucination)

| Поле | Значение | WHY |
|---|---|---|
| `scriptScore` | `null` | МОП не отрабатывал скрипт — пытался установить связь. **Не ставить 1/11** за «приветствие». |
| `scriptDetails` | `{}` | UI ожидает empty object. |
| `criticalErrors` | `[]` | Не было возможности — связи не было. **НЕ ставить `no_close_attempt`** — у МОПа не было шанса. |
| `phraseCompliance` | `{}` | Ни одна из 12 техник не применима в условиях нет связи. |
| `psychTriggers.positive` | `[]` | **Не записывать «вежливо переспросил = эмоциональный_подхват»** — это галлюцинация. |
| `psychTriggers.missed` | `[]` | Без содержательной реплики клиента нет триггеров. **«Я вас не слышу» — это не buying signal**, не записывать. |
| `clientEmotionPeaks` | `[]` | Фрустрация от связи ≠ эмоциональный пик о продукте. |
| `keyClientPhrases` | `[]` | **Никогда не записывать «Алло, плохо слышно» как keyClientPhrase.** Это не цитата-триггер. |
| `criticalDialogMoments` | `[]` | Не было диалога вообще. |
| `extractedCommitments` | `[]` | Если МОП сказал «перезвоню» в условиях паники тех. сбоя — это **не commitment**, это попытка успокоить. Не записывать. (Альт: можно записать но с low_confidence — но v10 контракт строже: пустой массив для D.) |
| `nextStepRecommendation` | `null` | **Не выдумывать «🔁 Перезвонить»** — это уже подразумевается. |
| `purchaseProbability` | `null` | Нет данных. **НЕ ставить 0.** |
| `managerWeakSpot` | `null` | Не было возможности проявить слабость. |

**Главное правило для D:** это **диагностика для тех. отдела**, не оценка МОПа. Skill не должен пытаться «вытащить смысл» из паники переспрашиваний.

---

## Что UI рендерит / скрывает

| UI элемент | Рендерится для D? | Что показывает |
|---|---|---|
| **Шапка карточки** | ✅ Да | 🚨 **Алерт-бейдж** «🔧 Технический срыв — тех. отдел проверь запись» (красная подложка для visibility) |
| **Плеер `<audio>`** | ✅ Да (если есть) | Тех. отдел может прослушать, понять — это echo / cut-off / проблема SIP |
| **GC deep-link** | ⚠️ Если есть | |
| Block: callSummary | ✅ Да | Шаблон |
| Block: cleanedTranscript | ✅ Да | Полный raw — паттерн «5 alloes» виден |
| Block: scriptDetails | ❌ **СКРЫТЬ** | scriptScore IS NULL |
| Block: phraseCompliance | ❌ **СКРЫТЬ** | Empty object |
| Block: psychTriggers | ❌ **СКРЫТЬ** | Оба пусто |
| Block: criticalDialogMoments | ❌ **СКРЫТЬ** | Пустой массив |
| Block: keyClientPhrases | ❌ **СКРЫТЬ** | Пустой массив |
| Block: extractedCommitments | ❌ **СКРЫТЬ** | Empty array |
| Block: ropInsight | ✅ Да | Расширенный шаблон + диагностический вопрос |
| Block: nextStepRecommendation | ❌ **СКРЫТЬ** | null |
| Block: enrichedTags | ✅ Да | Чипы `technical_issue` + `тех_проблема` + `ндз` |
| **Счётчик «технических» в карточке МОПа** | ✅ Да | `COUNT(*) WHERE callOutcome='technical_issue'` per managerId |
| **🚨 Алерт-флаг при >5% технических у МОПа** | ✅ Per МОПу | Красная точка «проверить hardware» |

**Главный UX-индикатор:** **🚨 алерт-бейдж в шапке** + **счётчик с алертом в карточке МОПа**. Тех. отдел видит алерт (per managerId агрегат), РОП видит метрику качества связи.

---

## Validator assertions (verbatim из EDGE-CASES.md)

```python
# Pre-check:
tech_markers = re.findall(
    r"вы\s+меня\s+слышите|алло[\s,.!]+алло|плохо\s+слышно|перезвоните",
    transcript, re.I
)
content_substantial = (
    len(transcript) > 200
    and not all(line_is_short_phatic(l) for l in transcript.splitlines())
)
if len(tech_markers) >= 2 and not content_substantial:
    category = "D"

# Validator (validate-enrich-sql.ts):
assert callOutcome == "technical_issue"
assert hadRealConversation == False
assert clientReaction == "confused"
assert "тех_проблема" in tags or "technical_issue" in tags
assert "ндз" in tags

# Special: ropInsight должен включать диагностический вопрос для РОПа
# (проверка что строка содержит "ДИАГНОСТИЧЕСКИЙ" или "проверить hardware/гарнитуру/SIP")
```

**Что произойдёт при fail:** UPDATE SQL отвергается, карточка → `needs_rerun_v10`.

---

## Сравнение с sample-3 / sample-4 (NORMAL) и C (HUNG_UP)

| Параметр | sample-3 NORMAL | sample-C HUNG_UP | sample-D TECHNICAL |
|---|---|---|---|
| Длительность | 12:00 | 8 sec | 42 sec |
| Реплики клиента | Содержательные | Только «Алло» (или нет) | Повторяющиеся «алло, слышите?» |
| Реплики МОПа | Содержательные | Только начало приветствия | Повторяющиеся «алло, слышите?» |
| `clientReaction` | `engaged` | `cold` / `not_engaged` | `confused` |
| Звонок состоялся? | ✅ Да | ❌ Нет (клиент сбросил) | ❌ Нет (тех. срыв) |
| Кому интересно? | РОП (оценить МОПа) | РОП (НДЗ-счётчик) | **Тех. отдел** (hardware/SIP) + РОП (НДЗ) |
| Паттерн ошибки | Реальные ошибки разговора | Не успели начать | Связь не работает |
| `ropInsight` | 5 пунктов action items | Шаблонная строка про время | **Шаблон + диагностический вопрос про hardware** |
| Алерт per МОПу | ❌ | ⚠️ если >40% hung_up | 🚨 **если >5% technical_issue** |

**Ключевая разница C vs D:** в C клиент сбросил быстро — это **бизнес-проблема** (плохая база/время). В D связь сама не работала — это **техническая проблема** (гарнитура / SIP / интернет МОПа).

---

## Заметки для автора skill v10

1. **Алерт-логика для тех. отдела:** аггрегат `COUNT(*) WHERE callOutcome='technical_issue' GROUP BY managerId` — если у МОПа >5% от всех звонков за неделю, daily cron присылает алерт в Telegram-канал тех. отдела с конкретными pbxUuid для прослушивания.
2. **Различение D vs B.** В B нет реплик клиента совсем (автоответчик). В D реплики клиента **есть**, но они тоже про «не слышу». Если manager_lines AND not client_lines → B. Если manager_lines AND client_lines AND tech_markers ≥2 → D.
3. **Различение D vs C.** В C клиент сбросил быстро (≤30s). В D клиент пытался разговаривать, и duration может быть 30-60+ сек. Главный признак D — повторяющиеся tech_markers с **обеих сторон**.
4. **Не вызывать Opus.** Шаблонное заполнение skill'ом, ROI insight включает заранее заготовленный диагностический вопрос.
5. **Возможный edge:** если в транскрипте есть И tech_markers И содержательная часть (МОП дозвонился через минуту, начался реальный диалог) — это **F NORMAL** или **E SHORT**, не D. Условие `not content_substantial` критично.

---

**Last updated: 2026-05-03**
**Created for: skill v10 contract**
