# Эталон E: SHORT_RESCHEDULE — короткий перенос (30-60 сек)

**Категория:** E (SHORT_RESCHEDULE) | **Master Enrich нужен?** ✅ ДА — упрощённый.
**Created for:** skill v10 contract
**Anti-hallucination role:** учит Opus, что **30-60 сек реального разговора с просьбой переноса требует упрощённого enrichment** — НЕ полные 14 блоков (избыточно), но И НЕ template fill (недостаточно). Cleanup + 11 этапов scriptDetails (с na=true для большинства) + ≥1 callback commitment.

⚠️ **САМАЯ ЧАСТАЯ КАТЕГОРИЯ ПОСЛЕ NORMAL** — diva делает много cold-calls, ~8% от 3684 звонков (2026-04-24…30) попадают сюда. Без эталона Opus будет рендерить либо как NORMAL (избыточно), либо как edge-case A-D (недостаточно).

---

## Meta

| Поле | Значение |
|---|---|
| `pbxUuid` | `e5555555-eeee-4eee-eeee-eeeeeeeeeeee` (синтетический) |
| `gcCallId` | `208999001` (звонок зарегистрирован в GC) |
| `gcUserId` | `4521133` |
| `duration` | 47 sec |
| `talkDuration` | 38 sec |
| `category` | E — SHORT_RESCHEDULE |
| `archetype` | `polite_seller` (вежливо принял перенос) или `passive_seller` (не пытался удержать) |
| `outcome` | `scheduled_callback` |
| `scriptScore` | 2 / 11 (низкий — не должна была дойти до полных этапов за 38 сек) |
| `Pre-classification trigger` | callOutcome=real_conversation AND duration 30-60s AND есть маркеры переноса |

---

## Пример transcript (raw — 47 сек)

```
[МЕНЕДЖЕР 00:00] (Приветствие. ПД. ФИО)

[КЛИЕНТ 00:04] Алло.

[МЕНЕДЖЕР 00:05] Алло, Лариса, здравствуйте! Меня Наталья зовут, звоню вам из школы Дива. Вы у нас вчера на мастер-классе были, помните?

[КЛИЕНТ 00:13] А, да-да, помню. Извините, я сейчас за рулём, не могу разговаривать.

[МЕНЕДЖЕР 00:18] Поняла, Лариса. А когда вам удобно перезвонить — может быть вечером, после семи?

[КЛИЕНТ 00:25] Да, давайте после восьми вечера. Сегодня. После восьми.

[МЕНЕДЖЕР 00:30] Хорошо, договорились — сегодня после восьми вечера. Я вам наберу. Хорошего дня!

[КЛИЕНТ 00:38] Спасибо. И вам.

[МЕНЕДЖЕР 00:41] До свидания.

[КЛИЕНТ 00:42] До свидания.
```

(Альтернативные формулировки маркеров переноса:)
- «не сейчас»
- «занят / занята»
- «перезвоните позже / завтра / на следующей неделе»
- «попробую завтра»
- «давайте через час»

**Признак для skill:**
```python
if (callOutcome == "real_conversation"
    and duration >= 30 and duration < 60
    and re.search(r"перезвон|не\s+сейчас|занят|позже|завтра\s+попробу|за\s+рулём|сейчас\s+неудобно",
                  transcript, re.I)):
    category = "E"
```

---

## CLEANUP NOTES (раw 624 chars → cleaned ~530 chars = compression 85%)

Удалено / нормализовано:

1. **[КЛИЕНТ 00:25] перепрослушка** — Whisper местами повторял «после восьми, после восьми» дважды (echo). Удалён повтор, оставлено единственное «после восьми вечера».
2. **Whisper-артефакты:**
   - `«за рулом»` → `«за рулём»` (буква ё)
   - `«Дева»` → `«Дива»` (имя школы)
3. **Имена унифицированы:** `«Натали»/«Наталье»` → `«Наталья»` (как назвалась МОП).

Восстановлений порядка не требовалось — диалог короткий, последовательность чистая.

Сохранено: **все реплики МОПа (4)** и **все реплики клиента (4)** — это материал для оценки 4 обязательных этапов скрипта (1, 2, 9, 11).

---

## Полная ENRICHED CARD (упрощённый Master Enrich для SHORT)

```yaml
# === Classification ===
callOutcome: real_conversation
hadRealConversation: true
callType: квалификация_лида        # из анкеты раздел 5: классификация контакт-точки
outcome: scheduled_callback
isCurator: false
isFirstLine: false
possibleDuplicate: false
purchaseProbability: null          # за 38 сек нет данных для оценки

# === Script (упрощённый — 11 этапов, na разрешён для большинства) ===
scriptScore: 2                     # 2 из 11 (только этапы 1, 2, 9 — частично; 11 — ок)
scriptScorePct: 0.18

scriptDetails:
  "1_приветствие":
    score: 1
    na: false
    comment: "Корректное приветствие с ПД и ФИО, представилась полностью."
  "2_причина_звонка":
    score: 1
    na: false
    comment: "Связала звонок с мастер-классом — клиент сразу узнал контекст."
  "3_программирование":
    score: 0
    na: true
    comment: "Не успела — клиент сразу попросил перенести."
  "4_квалификация":
    score: 0
    na: true
    comment: "Не успела — клиент за рулём."
  "5_выявление_потребностей":
    score: 0
    na: true
    comment: "Не дошли до этапа."
  "6_презентация":
    score: 0
    na: true
    comment: "Не дошли до этапа."
  "7_возражения":
    score: 0
    na: true
    comment: "Не было возражений по продукту — только по времени."
  "8_закрытие":
    score: 0
    na: true
    comment: "Не дошли до этапа."
  "9_следующий_шаг":
    score: 1
    na: false
    comment: "Назначила конкретное время — 'сегодня после восьми вечера'. ✅ Чёткий callback."
  "10_ответы_на_вопросы":
    score: 0
    na: true
    comment: "Клиент не задавал вопросов."
  "11_прощание":
    score: 1
    na: false
    comment: "Тёплое прощание, пожелание хорошего дня."

criticalErrors: []                  # за 38 сек нет критики

# === Psychology (опциональны — обычно пусто/минимум для SHORT) ===
psychTriggers:
  positive: []                       # за 38 сек не было приёмов нейропродаж
  missed: []                         # короткий, не до них
clientReaction: warm                 # клиент дружелюбно перенёс, не отказал
managerStyle: polite_seller          # вежливо приняла перенос
clientEmotionPeaks: []               # нет пиков на 38 сек
keyClientPhrases: []                 # короткий, не накопилось цитат-триггеров
criticalDialogMoments: []            # нет упущенных моментов

# === Phrase compliance (опциональна для SHORT — большинство techniques missed) ===
phraseCompliance: {}                  # либо пустой, либо ниже минимальный набор
# Альтернативно — можно заполнить с note "не дошли до этапа":
# phraseCompliance:
#   программирование_звонка:
#     used: false
#     missed: "не дошли до программирования — клиент попросил перенести"
#   ...

# === Content ===
cleanedTranscript: |
  [МЕНЕДЖЕР 00:00] (Приветствие. ПД. ФИО)
  [КЛИЕНТ 00:04] Алло.
  [МЕНЕДЖЕР 00:05] Алло, Лариса, здравствуйте! Меня Наталья зовут, звоню вам из школы Дива. Вы у нас вчера на мастер-классе были, помните?
  [КЛИЕНТ 00:13] А, да-да, помню. Извините, я сейчас за рулём, не могу разговаривать.
  [МЕНЕДЖЕР 00:18] Поняла, Лариса. А когда вам удобно перезвонить — может быть вечером, после семи?
  [КЛИЕНТ 00:25] Да, давайте после восьми вечера. Сегодня. После восьми.
  [МЕНЕДЖЕР 00:30] Хорошо, договорились — сегодня после восьми вечера. Я вам наберу. Хорошего дня!
  [КЛИЕНТ 00:38] Спасибо. И вам.
  [МЕНЕДЖЕР 00:41] До свидания.
  [КЛИЕНТ 00:42] До свидания.
cleanupNotes: |
  Удалено эхо «после восьми, после восьми» (Whisper-повтор).
  Whisper-артефакты исправлены: «за рулом» → «за рулём», «Дева» → «Дива», «Натали» → «Наталья».
  Compression: raw 624 chars → cleaned 530 chars = 85%.
callSummary: "Клиент попросил перезвонить позже (за рулём). МОП назначила callback на сегодня после 20:00. Без выявления потребностей — короткий перенос."
managerWeakSpot: "Не уточнила что обсудим при follow-up — клиент может забыть зачем звонят (мастер-класс был 'вчера', завтра уже не вспомнит)."

ropInsight: |
  Норма для cold-calling — клиент за рулём, перенос корректный.
  Проверить выполнен ли follow-up в назначенное время (сегодня после 20:00).
  Если МОП не перезвонит — это потерянный лид, добавить в дисциплинарную выборку.

nextStepRecommendation: |
  📲 Сегодня после 20:00 — перезвонить Ларисе.
  📎 Подготовить short pitch: «вчера мастер-класс, есть подарок — упражнение под ваши боли». 30 сек.

# === Commitments (ОБЯЗАТЕЛЬНО для SHORT — клиент попросил callback) ===
extractedCommitments:
  - speaker: МЕНЕДЖЕР
    quote: "договорились — сегодня после восьми вечера. Я вам наберу"
    timestamp: "00:30"
    action: callback
    deadline: "сегодня после 20:00"
    target: "перезвонить с уточнениями про мастер-класс"
commitmentsCount: 1
commitmentsTracked: false

# === Tags & status ===
enrichedTags: [перенос, короткий_звонок, scheduled_callback]
enrichmentStatus: enriched
enrichedBy: claude-opus-4-7-v10
```

---

## Какие поля заполнены (explicit list with values)

| Поле | Значение | Почему именно так |
|---|---|---|
| `callOutcome` | `real_conversation` | Был обмен реплик, в отличие от A-D |
| `hadRealConversation` | `true` | Несмотря на 38 сек |
| `callType` | `квалификация_лида` | Cold-call после мастер-класса = квалификация. Альтернативно `продажи_новый` если контекст явно sales. |
| `outcome` | `scheduled_callback` | Validator: assertion на callback в commitments. Это единственный legitimate outcome для SHORT. |
| `scriptScore` | `2` (≤ 3) | Validator: `assert scriptScore <= 3`. За 38 сек нельзя получить высокий скор. |
| `scriptScorePct` | `0.18` | 2/11 = 0.18 |
| `scriptDetails` | 11 этапов, 4 не-na (1, 2, 9, 11), 7 с `na: true` | Validator: `assert len(scriptDetails) == 11` AND обязательные 4 этапа не-na |
| `cleanedTranscript` | 530 chars (compression 85%) | Validator: `assert len(cleaned) >= len(raw) * 0.85`. Главное отличие от A-D — здесь cleanup делаем. |
| `cleanupNotes` | Текст про что удалили | Compression % явно указан |
| `callSummary` | 1-2 предложения | Краткое описание ситуации + назначенный callback |
| `managerWeakSpot` | 1 фраза | За 38 сек можно отметить что МОП не уточнил тему follow-up |
| `clientReaction` | `warm` | Клиент дружелюбно перенёс — не cold (как в C). Альтернативы: `engaged` если активно ответил, `confused` если запутался. |
| `managerStyle` | `polite_seller` | Новый под-стиль для SHORT — вежливо приняла. Альтернативно `passive_seller` если не пыталась удержать. |
| `extractedCommitments` | `[1 callback]` | Validator: `assert len >= 1` AND `any(c.action == "callback")`. **Обязательно для SHORT.** |
| `nextStepRecommendation` | 2 шага с эмодзи 📲 📎 | Меньше чем NORMAL (там 4), но не null |
| `ropInsight` | 3 короткие строки | «Норма для cold-calling. Проверить follow-up. Дисциплина если не перезвонил.» |
| `enrichedTags` | `[перенос, короткий_звонок, scheduled_callback]` | UI badges |
| `purchaseProbability` | `null` | За 38 сек нет данных. **НЕ ставить 50** — нет признаков ни «купит» ни «не купит». |
| `criticalErrors` | `[]` | За 38 сек нет критики. МОП не успел совершить ошибку. |

---

## Какие поля null / [] / {} + WHY (anti-hallucination)

| Поле | Значение | WHY |
|---|---|---|
| `purchaseProbability` | `null` | Не хватает данных для оценки за 38 сек. **Не выдумывать число.** |
| `criticalErrors` | `[]` | Нечего критиковать. |
| `psychTriggers.positive` | `[]` | За 38 сек МОП не успела применить нейроприёмы. **НЕ записывать «приветствие = искренний_комплимент»** (галлюцинация). |
| `psychTriggers.missed` | `[]` | Клиент не сделал buying signals — нечего «пропускать». **НЕ записывать «не уточнил мастер-класс = упущенный триггер»** (это в managerWeakSpot, не в psychTriggers). |
| `clientEmotionPeaks` | `[]` | На 38 сек один уровень эмоции — нет пиков. |
| `keyClientPhrases` | `[]` | Цитаты-триггеры обычно вокруг buying signals. Здесь их нет. **НЕ записывать «я за рулём» как key phrase** — это блокер, не триггер. |
| `criticalDialogMoments` | `[]` | Не было упущенных «золотых моментов» — звонок прошёл нормально для своего жанра. |
| `phraseCompliance` | `{}` или с `used: false` для всех 12 | За 38 сек ни одна из 12 техник diva не применима. Если заполняем — все `used: false` с `missed: "не дошли до этапа"`. По v10-контракту допустимо `{}`. |
| `psychTriggers.positive` per-element | shape full если непустой | Если попадётся редкий случай (МОП успела сделать комплимент за 38 сек) — заполняем full shape `{time, technique, effect}`. |

**Главное правило для E:** упрощённый enrichment = **есть данные для cleanup + 4 обязательных этапа + 1 callback commitment**. Всё остальное опционально.

---

## Что UI рендерит / скрывает (cross-ref ui-enrichment-contract.md)

| UI элемент | Рендерится для E? | Что показывает |
|---|---|---|
| **Шапка карточки** | ✅ Да | duration + talkDuration + managerName + clientPhone + бейдж «📅 Перенос — callback назначен» |
| **Плеер `<audio>`** | ✅ Да | РОП может прослушать тон |
| **GC deep-link** | ✅ Да (gcCallId есть) | `/user/control/contact/update/id/{gcCallId}` |
| Block: callSummary | ✅ Да | 1-2 предложения |
| Block: cleanedTranscript | ✅ Да | Полный очищенный transcript |
| Block: scriptDetails (11 этапов) | ✅ Да | UI показывает все 11, для na=true делает grey-out (не fail). Знаменатель **ВСЕГДА 11** в UI. |
| Block: phraseCompliance (12 техник) | ⚠️ **Условно** | Если `Object.keys(phraseCompliance).length === 0` → скрыть. Если заполнено `{used: false для всех}` → показать в свёрнутом виде с пометкой «не дошли до этапа». |
| Block: psychTriggers | ❌ **СКРЫТЬ** | Оба массива пусты → скрыть весь блок |
| Block: criticalDialogMoments | ❌ **СКРЫТЬ** | Пустой массив |
| Block: keyClientPhrases | ❌ **СКРЫТЬ** | Пустой массив |
| Block: clientEmotionPeaks | ❌ **СКРЫТЬ** | Пустой массив |
| **Block: extractedCommitments (Block 7)** | ✅ Да | Показать 1 callback с deadline, alert «выполнен ли follow-up?» |
| Block: ropInsight | ✅ Да | 3 короткие строки |
| Block: nextStepRecommendation | ✅ Да | 2 шага с эмодзи |
| Block: managerWeakSpot | ✅ Да | 1 фраза |
| Block: enrichedTags | ✅ Да | Чипы `перенос` `короткий_звонок` `scheduled_callback` |
| **Compact mode toggle** | ⚠️ Per-card | UI применяет «компактную версию карточки» — без panels с psych/critical |
| **Алерт «follow-up через 24h?»** | ✅ Да | Если callback deadline прошёл, флаг в карточке МОПа «не выполнен callback» |

**Главный UX-индикатор:** **бейдж «📅 Перенос — callback назначен»** + видимый deadline + Block 7 commitment с tracking-флагом для РОПа.

---

## Validator assertions (verbatim из EDGE-CASES.md)

```python
# Pre-check:
if (callOutcome == "real_conversation"
    and duration >= 30 and duration < 60
    and re.search(r"перезвон|не\s+сейчас|занят|позже|завтра\s+попробу", transcript, re.I)):
    category = "E"

# Validator (validate-enrich-sql.ts):

# Cleanup MUST be done (это real_conversation)
assert cleanedTranscript is not None
assert len(cleanedTranscript) >= len(transcript) * 0.85, "compression too low"

# Script details — все 11 этапов, na разрешён
assert isinstance(scriptDetails, dict)
assert len(scriptDetails) == 11
required_non_na_for_short = ["1_приветствие", "2_причина_звонка", "9_следующий_шаг", "11_прощание"]
for stage in required_non_na_for_short:
    s = scriptDetails.get(stage, {})
    assert not s.get("na"), f"{stage} обязателен для SHORT"

# Commitment — обязателен для SHORT (клиент попросил callback)
assert len(extractedCommitments) >= 1
assert any(c.get("action") == "callback" for c in extractedCommitments)

# nextStep — 1-2 шага, должен содержать когда callback
assert nextStepRecommendation is not None

# scriptScore — низкий
assert scriptScore is not None and scriptScore <= 3

# Опциональны (могут отсутствовать):
# - phraseCompliance (большинство techniques missed)
# - psychTriggers (короткий не до them)
# - purchaseProbability (нет данных за 30-60s)
# - criticalDialogMoments
```

**Tags:** `[перенос, короткий_звонок, scheduled_callback]`

**Что произойдёт при fail:** UPDATE SQL отвергается. Типичные fails:
- `compression too low` → Opus сжал слишком сильно (это NORMAL bug — повторяется и для SHORT)
- `9_следующий_шаг обязателен для SHORT` → Opus поставил `na: true`, но ведь callback назначен!
- `len(extractedCommitments) >= 1` → Opus забыл записать callback в commitments

---

## Сравнение с sample-3 / sample-4 (NORMAL) и A-D (template)

| Параметр | sample-3 (F NORMAL) | sample-A (NO_SPEECH) | sample-E (SHORT) |
|---|---|---|---|
| Длительность | 12:00 | 4 sec | 47 sec |
| Заполненных блоков (из 14) | 14 (все) | 4 (минимум) | 8-10 (упрощённый) |
| Opus вызывается? | ✅ ~90-120s | ❌ template | ✅ ~30-60s (упрощённо) |
| Cleanup? | ✅ compression 21% | ❌ raw copy | ✅ compression 85% |
| `scriptDetails` | 11 этапов, все не-na | `{}` | 11 этапов, **4 не-na, 7 na** |
| `phraseCompliance` | 12 техник, used:true где есть | `{}` | `{}` или 12 с used:false |
| `psychTriggers.positive` | ≥3 | `[]` | `[]` (опционально) |
| `psychTriggers.missed` | ≥4 | `[]` | `[]` (опционально) |
| `extractedCommitments` | ≥1 | `[]` | **≥1 (обязателен callback)** |
| `nextStepRecommendation` | 4 шага с 📲📎🗓️💌 | null | 2 шага |
| `ropInsight` | 5 пунктов | Шаблон 1 строка | 3 короткие строки |
| `purchaseProbability` | обоснованное число | null | null |
| `clientReaction` | engaged/cold/etc | silent | warm/engaged |
| `managerStyle` | empathic_seller/strong_closer | not_applicable | polite_seller/passive_seller |

**Ключевая позиция E:** между NORMAL и edge-cases. Минимум обязательных полей для tracking callback'а, но без галлюцинации полей про psych/phraseCompliance которые «не дошли до».

---

## Заметки для автора skill v10

1. **Pre-classification критично.** Если pre-classification ошибётся и пошлёт E на полный NORMAL flow — Opus попробует генерить psychTriggers/phraseCompliance из 38 сек = галлюцинация. Skill v10 должен жёстко: `30 ≤ duration < 60` AND markers → categoryE → simplified prompt.
2. **Упрощённый prompt для Opus.** Не передавать в Opus полный SKILL.md (там 14 блоков). Передать только: «cleanedTranscript + 11 этапов scriptDetails + ≥1 callback commitment + summary + managerWeakSpot». Сокращает thinking time с ~120s до ~30-60s.
3. **scriptDetails 11 этапов с na=true** — главная ловушка. Opus может попытаться поставить score за этапы которые на самом деле не были (например «6_презентация: score=0, comment="не презентовал продукт"» — это **wrong**, нужно `na: true` потому что этапа просто не было). v10 prompt должен явно: «если МОП не дошёл до этапа из-за переноса — ставь `na: true`».
4. **Commitment extraction** для E — главный value. Без него follow-up tracking сломан. Validator явно блокирует если нет callback.
5. **purchaseProbability=null** — anti-hallucination guard. Opus захочет поставить «50% — neutral», но за 38 сек этого знать нельзя.
6. **clientReaction различение от C/D:**
   - C: `cold` (клиент сбросил)
   - D: `confused` (тех. срыв)
   - E: `warm` (вежливо перенёс) или `engaged` (активно ответил)

---

## 🔗 GC Deep-link

🎯 **Карточка звонка в GC:** `https://web.diva.school/user/control/contact/update/id/{gcCallId}`
🎵 **Аудиозапись:** `audioUrl` (заполнен sync-pipeline'ом)
👤 **Профиль клиента:** `https://web.diva.school/user/control/user/update/id/{gcUserId}`

`gcDeepLinkType: 'call_card'` (для E gcCallId обычно есть, в отличие от A/B/C/D где часто null).

---

**Last updated: 2026-05-03**
**Created for: skill v10 contract**
**⚠️ CRITICAL — это самая частая категория после NORMAL (≈8% от всех diva-звонков). Без эталона Opus путается между NORMAL и template-fill режимами.**
