# 📑 Call Categories — 7 типов звонков (A-G)

**Single source of truth по классификации звонков.** Каждая категория имеет правила различения + что делать в Master Enrich + какой эталон должен быть.

Источник: `~/.claude/skills/enrich-calls/SKILL.md` секция «Edge-cases» (lines 670-790) + `/tmp/ui-session-followups.md` (категория G).

---

## 🚦 Decision tree — как определить категорию

```
┌──────────────────────────────────────────────────┐
│ length(transcript) ≤ 100 chars                   │
│ (включая placeholder, "Ого!", шум)               │
│ → A: NO_SPEECH                                   │
└──────────────────────────────────────────────────┘
                       │ no
                       ▼
┌──────────────────────────────────────────────────┐
│ Только МОП-реплики, нет КЛИЕНТ-реплик,          │
│ фразы "вызываемый абонент не отвечает", IVR      │
│ → B: VOICEMAIL/IVR                               │
└──────────────────────────────────────────────────┘
                       │ no
                       ▼
┌──────────────────────────────────────────────────┐
│ duration < 30s, "Алло" → сброс, нет содержания  │
│ → C: HUNG_UP                                     │
└──────────────────────────────────────────────────┘
                       │ no
                       ▼
┌──────────────────────────────────────────────────┐
│ Повторяющиеся "Алло, слышите?", "перезвоните"   │
│ Обе стороны говорят, нет содержательного диалога │
│ → D: TECHNICAL                                   │
└──────────────────────────────────────────────────┘
                       │ no
                       ▼
┌──────────────────────────────────────────────────┐
│ duration 30-60s, real_conversation НО клиент    │
│ "не сейчас / занят / перезвоните позже"          │
│ → E: SHORT_RESCHEDULE                            │
└──────────────────────────────────────────────────┘
                       │ no
                       ▼
┌──────────────────────────────────────────────────┐
│ duration ≥ 60s, реальный диалог с темами         │
│ → F: NORMAL  (полный 14-блок enrichment)        │
└──────────────────────────────────────────────────┘

⚠️ Параллельно (не в decision tree, а до):
audioUrl IS NULL OR transcript IS NULL OR no PBX↔GC match
→ G: PIPELINE_GAP (skip Master Enrich совсем, UI redirect)
```

**Skill v10 определяет категорию через быстрый pre-classification (5-10 сек),** до запуска тяжёлого enrichment. Edge-case = быстрая обработка, нет смысла думать 30 сек над пустым звонком.

---

## A: NO_SPEECH (звонок без речи)

### Признак
- `length(transcript) ≤ 100 chars` независимо от типа содержимого
- Включает: placeholder, Whisper-галлюцинацию ("Ого!" / "Продолжение следует..."), шум, тишину
- Невозможно реконструировать диалог из текста

### callOutcome
`no_speech_or_silence` | `hadRealConversation: false`

### Заполнение карточки
```yaml
callOutcome: no_speech_or_silence
hadRealConversation: false
callType: not_applicable
outcome: not_applicable
scriptScore: null            # нечего оценивать
criticalErrors: []
psychTriggers: { positive: [], missed: [] }
clientReaction: silent
managerStyle: not_applicable
summary: "Whisper не нашёл речь — возможно соединения не было / автоответчик / IVR / технический сбой"
managerWeakSpot: null
ropInsight: "Не оценивать. Проверить запись вручную если важно."
purchaseProbability: null
extractedCommitments: []
phraseCompliance: {}          # пустой объект, не null
scriptDetails: {}              # пустой объект
nextStepRecommendation: null
keyClientPhrases: []
clientEmotionPeaks: []
criticalDialogMoments: []
cleanedTranscript: <copy of raw transcript>  # короткий, не cleanup'им
tags: [no_speech, не_оценивается]
```

### Master Enrich нужен?
❌ **НЕТ** — skill skip Opus, заполняет шаблонно.

### UI render
Бейдж «Whisper не нашёл речи» в шапке. Все блоки скрыты.

### Эталона нет — создать `sample-A-no-speech-template.md`

---

## B: VOICEMAIL / IVR (автоответчик)

### Признак
- В transcript только МОП-реплики, нет КЛИЕНТ-реплик
- Фразы: "вызываемый абонент не отвечает", "оставайтесь на линии", "после сигнала"
- ИЛИ DeepSeek уже определил `callType=VOICEMAIL`

### callOutcome
`voicemail` | `ivr` | `hadRealConversation: false`

### Заполнение
```yaml
callOutcome: voicemail | ivr
hadRealConversation: false
callType: not_applicable
outcome: not_applicable
scriptScore: null
clientReaction: silent
managerStyle: not_applicable
summary: "Автоответчик/IVR. Менеджер не дозвонился до клиента."
ropInsight: "Засчитывается как НДЗ (попытка дозвона). Контролировать частоту повторных попыток."
purchaseProbability: null
extractedCommitments: []
tags: [voicemail, ндз]
```

### Master Enrich нужен?
❌ **НЕТ** — skip Opus.

### UI render
Бейдж «Автоответчик / IVR». Если есть commitment МОПа (например «перезвоню позже») — показать.

### Эталона нет — создать `sample-B-voicemail-template.md`

---

## C: HUNG_UP / NO_ANSWER (клиент сбросил)

### Признак
- duration < 30s, ультра-короткий
- Клиент не ответил вообще, или сбросил после "Алло"
- Нет содержательного контента

### callOutcome
`hung_up` | `no_answer` | `hadRealConversation: false`

### Заполнение
```yaml
callOutcome: hung_up | no_answer
hadRealConversation: false
callType: not_applicable
outcome: not_applicable
scriptScore: null
clientReaction: cold | not_engaged
managerStyle: not_applicable
summary: "Клиент сбросил / не ответил после короткого приветствия"
ropInsight: "НДЗ. Возможно неудачное время — проверить эффективность звонков в этот час."
purchaseProbability: null
extractedCommitments: []
tags: [hung_up | no_answer, ндз]
```

### Master Enrich нужен?
❌ **НЕТ** — skip Opus.

### UI render
Бейдж «Клиент сбросил» + НДЗ счётчик в карточке МОПа.

### Эталона нет — создать `sample-C-hungup-template.md`

---

## D: TECHNICAL (МОП и клиент не слышат друг друга)

### Признак
- В transcript обе стороны говорят
- Повторяются "Алло", "вы меня слышите?", "плохо слышно", "перезвоните"
- Нет содержательного диалога

### callOutcome
`technical_issue` | `hadRealConversation: false`

### Заполнение
```yaml
callOutcome: technical_issue
hadRealConversation: false
callType: not_applicable
outcome: not_applicable
scriptScore: null
clientReaction: confused
managerStyle: not_applicable
summary: "Технические проблемы связи — клиент и МОП не слышат друг друга. Звонок не состоялся как диалог."
ropInsight: "Проверить качество связи. Если повторяется у конкретного МОПа — проблема гарнитуры/SIP. Засчитать как НДЗ для отчёта."
purchaseProbability: null
extractedCommitments: []
tags: [technical_issue, тех_проблема, ндз]
```

### Master Enrich нужен?
❌ **НЕТ** — skip Opus.

### UI render
🚨 Алерт «тех. отдел проверь запись» в карточке. Счётчик технических у конкретного МОПа.

### Эталона нет — создать `sample-D-technical-template.md`

---

## E: SHORT_RESCHEDULE (короткий перенос)

### Признак
- duration **30-60 сек**, talk-time может быть и меньше
- callOutcome=real_conversation, но содержание — клиент попросил перенести
- Маркеры: "не сейчас / занят / перезвоните позже / завтра попробую"

### callOutcome
`real_conversation` | `hadRealConversation: true` | `outcome: scheduled_callback`

### Заполнение (упрощённое vs NORMAL)
```yaml
callOutcome: real_conversation
hadRealConversation: true
callType: квалификация_лида (или upsell — по контексту)
outcome: scheduled_callback
scriptScore: 1-2          # низкий, за 30 сек ничего не должна была сделать
criticalErrors: []          # за 30 сек нет критики
summary: "Клиент попросил перезвонить позже. Без выявления потребностей."

# Обязательно (даже для SHORT):
cleanedTranscript: <full text, compression ≥85%>
scriptDetails: {  # все 11 этапов, na разрешён для большинства
  "1_приветствие": { score: 1, na: false, comment: "..." }
  "2_причина_звонка": { score: 1 | 0.5, na: false, ... }
  "3_программирование": { na: true, ... }
  "4_квалификация": { na: true | score: 0, ... }
  "5_выявление_потребностей": { na: true, ... }
  "6_презентация": { na: true, ... }
  "7_возражения": { na: true, ... }
  "8_закрытие": { na: true, ... }
  "9_следующий_шаг": { score: 1, na: false, ... }  # callback назначен
  "10_ответы_на_вопросы": { na: true, ... }
  "11_прощание": { score: 1, na: false, ... }
}

# Опциональны для SHORT:
phraseCompliance: { ... }     # большинство 12 техник missed (короткий не до них)
psychTriggers: { ... }        # короткий, может быть пустой
extractedCommitments: [{
  speaker: МЕНЕДЖЕР,
  action: callback,
  deadline: "<когда клиент попросил>",
  target: "перезвонить с уточнениями"
}]
purchaseProbability: null     # нет данных за 30-60 сек
nextStepRecommendation: <1-2 шага = "перезвонить в Y времени"
ropInsight: "Норма для cold-calling. Проверить выполнен ли follow-up в назначенное время."
tags: [перенос, короткий_звонок]
```

### Master Enrich нужен?
✅ **ДА**, упрощённый. Меньше полей чем NORMAL, но cleanedTranscript + scriptDetails + extractedCommitments — обязательны.

### UI render
Полная карточка но компактная. Без блоков psychTriggers/criticalDialogMoments. Видно outcome=scheduled_callback и кому/когда callback.

### Эталона нет — **СОЗДАТЬ ПРИОРИТЕТНО** `sample-E-short-reschedule-template.md`

⚠️ **Это самая частая категория после NORMAL** — diva делает много cold-calls, большая часть = SHORT. Без эталона Opus будет рендерить либо как NORMAL (избыточно для 30-60s), либо как edge-case (не достаточно).

---

## F: NORMAL (полноценный диалог ≥60s)

### Признак
- duration ≥ 60 сек
- callOutcome=real_conversation
- Реальный содержательный диалог с темами

### callOutcome
`real_conversation` | `hadRealConversation: true`
**outcome:** `closed_won` | `closed_lost` | `objection_unresolved` | `scheduled_followup` | `nurture` | `not_interested`

### Заполнение
**Полный 14-блочный enrichment** по схеме `canon-master-enrich-card.md`. Все обязательные поля:

```yaml
cleanedTranscript: <compression ≥85%>
cleanupNotes: <что удалено и почему>
summary: <4 строки>
callType: <из анкеты раздел 5: продажи_новый | квалификация_лида | поддержка_ученика | ...>
callOutcome: real_conversation
outcome: <closed_won | closed_lost | objection_unresolved | ...>
hadRealConversation: true
isCurator: <bool>
isFirstLine: <bool>
possibleDuplicate: <bool>
purchaseProbability: <0-100%>

scriptScore: <0-22>
scriptScorePct: <0-1.0>
scriptDetails: { 11 этапов diva с per-stage комментариями, score, na=false для обязательных }
criticalErrors: [<6 enum diva>]

psychTriggers:
  positive: [{ time, technique, effect }, ... минимум 3]
  missed: [{ time, quote_client, should_have_said }, ... минимум 4]
clientReaction: <enum>
managerStyle: <enum: soft_seller | strong_closer | empathic | technical | aggressive>
clientEmotionPeaks: [{time, emotion}, ...]
keyClientPhrases: [{time, quote, note}, ... минимум 4]
criticalDialogMoments: [{time, what_happened, what_should_have_been}, минимум 1]

phraseCompliance: { 12 техник diva, каждая с used+evidence или missed+note }

ropInsight: <минимум 5 пунктов action items>
nextStepRecommendation: <4 шага с эмодзи 📲 📎 🗓️ 💌>
extractedCommitments: [{speaker, quote, action, deadline, target}, ... минимум 1]
managerWeakSpot: <текст>
enrichedTags: [<массив тегов>]

gcCallCardUrl: /user/control/contact/update/id/{gcCallId}
gcDeepLinkType: call_card
```

### Master Enrich нужен?
✅ **ДА — ПОЛНЫЙ.** Это основной режим работы skill.

### UI render
Все 14 блоков рендерятся (см. эталон sample-3 / sample-4).

### Эталон есть
- ✅ `sample-3-proper-cleanup-lara.md` — empathic_seller / closed_lost
- ✅ `sample-4-strong-closer-tech-block.md` — strong_closer / objection_unresolved

**Possibly need more эталонов под NORMAL подкатегории:**
- closed_won (нет эталона "as won") — нужен sample-F-closed-won
- nurture (info-call без продажи) — нужен sample-F-nurture
- aggressive_seller (negative pattern) — для контраста

---

## G: PIPELINE_GAP (карточка-сирота)

### Признак (множественный)
- `audioUrl IS NULL` (Whisper не запускался)
- ИЛИ `transcript IS NULL` (download/Whisper упал)
- ИЛИ нет PBX↔GC match (`gcCallId IS NULL` для `pbxUuid` есть)
- ИЛИ нет `managerId` (PBX звонок без матча на МОПа)

### callOutcome
`pipeline_gap` (новое значение)

### Заполнение
```yaml
callOutcome: pipeline_gap
hadRealConversation: null      # неизвестно
callType: null
outcome: not_applicable
scriptScore: null
# Все остальные блоки — null

summary: "Pipeline incomplete: <reason>. Не удалось обогатить."
ropInsight: null               # нечего советовать
managerWeakSpot: null

tags: [pipeline_gap, requires_manual]
diagnostic:
  - audioUrl: null | <url>
  - transcript: null | <bool>
  - gcCallId: null | <id>
  - managerId: null | <id>
  - reason: <почему gap — миссинг audioUrl / Whisper failed / no GC match>
```

### Master Enrich нужен?
❌ **НЕТ** — skip Opus.

### UI render
**Не показывать как звонок-карточку!** Это сирота. Вместо этого — счётчик в карточке МОПа: «N pipeline_gap звонков, требуют ручной проверки». РОП дальше идёт на конкретный pbxUuid и решает (записать запрос на Whisper retry, или удалить как фантом).

### Эталона нет — создать `sample-G-pipeline-gap-template.md`

⚠️ **Эта категория НЕ в SKILL.md v9.5** — упомянута только в `/tmp/ui-session-followups.md`. Skill v10 должен формализовать.

---

## 📊 Статистика по категориям (примерная для diva, 24-30.04)

Диапазон: ~3684 carteчек 24-30.04.

| Категория | Кол-во (примерно) | % | Master Enrich? |
|---|---|---|---|
| A: NO_SPEECH | ~1500 | 41% | ❌ |
| B: VOICEMAIL | ~400 | 11% | ❌ |
| C: HUNG_UP | ~600 | 16% | ❌ |
| D: TECHNICAL | ~50 | 1% | ❌ |
| E: SHORT_RESCHEDULE | ~300 | 8% | ✅ упрощённый |
| F: NORMAL | ~600 | 16% | ✅ полный |
| G: PIPELINE_GAP | ~234 | 6% | ❌ |
| **ИТОГО** | 3684 | 100% | ~24% Master Enrich |

**Точные цифры — смотри запросом:**
```sql
SELECT
  CASE
    WHEN length(transcript) <= 100 THEN 'A_NO_SPEECH'
    WHEN "callOutcome" IN ('voicemail','ivr') THEN 'B_VOICEMAIL'
    WHEN "callOutcome" IN ('hung_up','no_answer') THEN 'C_HUNG_UP'
    WHEN "callOutcome" = 'technical_issue' THEN 'D_TECHNICAL'
    WHEN "callOutcome" = 'real_conversation' AND duration < 60 THEN 'E_SHORT'
    WHEN "callOutcome" = 'real_conversation' AND duration >= 60 THEN 'F_NORMAL'
    WHEN "audioUrl" IS NULL OR transcript IS NULL OR "gcCallId" IS NULL THEN 'G_PIPELINE_GAP'
    ELSE 'UNKNOWN'
  END AS category,
  COUNT(*)
FROM "CallRecord"
WHERE "tenantId" = '<diva>' AND "startStamp" >= '2026-04-24'
GROUP BY 1 ORDER BY 2 DESC;
```

---

## 🔗 Связанные документы

- `CATALOG.md` — список существующих эталонов
- `EDGE-CASES.md` — decision tree + детальная логика обработки
- `../canon-master-enrich-card.md` — schema 14 блоков
- `../../handoffs/2026-05-03-skill-v10-progress.md` — статус skill v10
- `~/.claude/skills/enrich-calls/SKILL.md` — текущий skill v9.5 (заморожен)

---

**Last updated: 2026-05-03**
**7 категорий определено. Эталонов: 2 (только F NORMAL). Создать 5 + 1: A, B, C, D, E (priority!), G.**
