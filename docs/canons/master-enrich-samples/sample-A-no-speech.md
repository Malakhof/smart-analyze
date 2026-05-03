# Эталон A: NO_SPEECH — звонок без речи / placeholder Whisper

**Категория:** A (NO_SPEECH) | **Master Enrich нужен?** ❌ НЕТ — skill skip Opus thinking, заполняет шаблонно.
**Created for:** skill v10 contract
**Anti-hallucination role:** этот эталон учит Opus **что НЕ генерить** для звонков без речи. 90% полей null/[]/not_applicable.

---

## Meta

| Поле | Значение |
|---|---|
| `pbxUuid` | `a1111111-aaaa-4aaa-aaaa-aaaaaaaaaaaa` (синтетический) |
| `gcCallId` | `null` (часто отсутствует — звонок не дошёл до карточки в GC) |
| `duration` | 4 sec |
| `talkDuration` | 0 sec |
| `category` | A — NO_SPEECH |
| `archetype` | not_applicable (нет диалога — нет архетипа) |
| `scriptScore` | `null` (нечего оценивать) |
| `Pre-classification trigger` | `len(transcript) <= 100 chars` |

---

## Пример transcript (raw — что пришло из Whisper)

```
Ого!
```

(Альтернативные варианты что попадает в категорию A:)
- `Продолжение следует...` (типичная Whisper-галлюцинация на тишине)
- `[Музыка]` (placeholder в служебном формате)
- ` ` (одинарный пробел, transcript NULL практически)
- `Спасибо за просмотр.` (галлюцинация YouTube-промпта Whisper)

**Признак для skill:** `len(transcript or "") <= 100`. Не важно что внутри — если коротко, классифицируем A.

---

## CLEANUP NOTES

**Не cleanup'им.** Для категории A `cleanedTranscript = raw transcript` (копия без изменений). Validator в EDGE-CASES.md явно требует:

> «Validator must REJECT if cleanedTranscript длиннее transcript (для A копируем raw, не cleanup'им)»

Причина: cleanup эхо/глюков предполагает наличие диалога. В категории A диалога нет — есть placeholder. Любая «нормализация» Opus'а здесь = галлюцинация (например, дописать «Алло, здравствуйте» которого не было).

---

## Полная ENRICHED CARD (что skill ДОЛЖЕН записать в БД)

```yaml
# === Classification ===
callOutcome: no_speech_or_silence
hadRealConversation: false
callType: not_applicable
outcome: not_applicable
isCurator: null              # неизвестно — нет диалога чтобы определить
isFirstLine: null
possibleDuplicate: null
purchaseProbability: null

# === Script (нечего оценивать) ===
scriptScore: null
scriptScorePct: null
scriptDetails: {}             # пустой объект, НЕ null
criticalErrors: []            # пустой массив, НЕ null

# === Psychology (нет данных) ===
psychTriggers:
  positive: []
  missed: []
clientReaction: silent
managerStyle: not_applicable
clientEmotionPeaks: []
keyClientPhrases: []
criticalDialogMoments: []

# === Phrase compliance (12 техник diva — нечего оценивать) ===
phraseCompliance: {}          # пустой объект, НЕ null

# === Content ===
cleanedTranscript: "Ого!"     # raw copy, не cleanup'им
cleanupNotes: null            # нечего cleanup'ить
callSummary: "Whisper не нашёл речь — возможно соединения не было / автоответчик / IVR / технический сбой. Звонок не подлежит оценке."
managerWeakSpot: null
ropInsight: "Не оценивать. Проверить запись вручную если важно."
nextStepRecommendation: null

# === Commitments ===
extractedCommitments: []
commitmentsCount: 0
commitmentsTracked: false

# === Tags & status ===
enrichedTags: [no_speech, не_оценивается]
enrichmentStatus: enriched
enrichedBy: claude-opus-4-7-v10
```

---

## Какие поля заполнены (explicit list with values)

| Поле | Значение | Почему именно так |
|---|---|---|
| `callOutcome` | `no_speech_or_silence` | Единственный валидный enum для A — отличает от voicemail (B) и hung_up (C) |
| `hadRealConversation` | `false` | Нет даже одной реплики — не было диалога |
| `callType` | `not_applicable` | Не ставим `прочее` — это явное «нечего классифицировать» |
| `outcome` | `not_applicable` | Не `closed_lost` — лида не было |
| `clientReaction` | `silent` | Единственное допустимое значение для A — клиент не говорил |
| `managerStyle` | `not_applicable` | МОП тоже не успел проявить стиль |
| `cleanedTranscript` | `<copy of raw>` | Копия. **Не пытаться реконструировать диалог.** |
| `callSummary` | `"Whisper не нашёл речь — возможно соединения не было / автоответчик / IVR / технический сбой. Звонок не подлежит оценке."` | Заранее сформулированный шаблон, не Opus generation |
| `ropInsight` | `"Не оценивать. Проверить запись вручную если важно."` | **Точная строка из EDGE-CASES.md validator** — assertion `assert ropInsight == "Не оценивать. Проверить запись вручную если важно."` |
| `enrichedTags` | `[no_speech, не_оценивается]` | Validator проверяет наличие обоих тегов (`assert "no_speech" in tags` и `assert "не_оценивается" in tags`) |
| `enrichmentStatus` | `enriched` | Карточка обработана (skip Opus, но не fail) |

---

## Какие поля null / [] / {} / not_applicable + WHY (anti-hallucination)

Это **самая важная секция эталона** — учит Opus не выдумывать для пустого звонка.

| Поле | Значение | WHY |
|---|---|---|
| `scriptScore` | `null` | За 50 ms тишины МОП не мог отработать ни один из 11 этапов. **Не ставить 0** — 0 значит «провалил этап», а тут не было этапа. null = «не оценивается». |
| `scriptScorePct` | `null` | Производное от scriptScore. |
| `scriptDetails` | `{}` (пустой объект) | **НЕ null.** Validator: `assert scriptDetails == {}`. UI ожидает объект (даже пустой) для безопасного `Object.entries()`. |
| `criticalErrors` | `[]` (пустой массив) | **НЕ null.** Не было возможности совершить ошибку — нечего записывать. |
| `phraseCompliance` | `{}` (пустой объект) | **НЕ null.** Validator: `assert phraseCompliance == {}`. UI ожидает объект (даже пустой). |
| `psychTriggers.positive` | `[]` | **Нет ни одной реплики МОПа** — не на что навесить «приём». Не выдумывать «приветствие = искренний_комплимент». |
| `psychTriggers.missed` | `[]` | Чтобы определить «упущенный триггер», нужна реплика клиента — её нет. **Не пушить туда «должен был сказать здравствуйте»** (это не упущение psych-trigger'а). |
| `clientEmotionPeaks` | `[]` | Нет эмоций в одном слове `Ого!`. Не выдумывать «(00:00) confusion». |
| `keyClientPhrases` | `[]` | Whisper-галлюцинация ≠ цитата клиента. Никогда не записывать `Ого!` как `keyClientPhrase`. |
| `criticalDialogMoments` | `[]` | Не было диалога — нет моментов. |
| `extractedCommitments` | `[]` | Никто ничего не обещал. Не записывать commitment типа «МОП должен перезвонить» (его не было в звонке). |
| `nextStepRecommendation` | `null` | **Не выдумывать «🔁 Перезвонить клиенту»** — мы не знаем, был ли это вообще валидный лид. РОП решит вручную. |
| `purchaseProbability` | `null` | За 50 ms нечего оценивать. **НЕ ставить 0** — 0 значит «точно не купит», тут просто нет данных. |
| `managerWeakSpot` | `null` | Не было возможности проявить слабость. |
| `cleanupNotes` | `null` | Не делали cleanup → notes тоже null (или пустая строка). |
| `isCurator`, `isFirstLine`, `possibleDuplicate` | `null` | Без диалога невозможно определить. Не угадывать `false`. |

**Главное правило для категории A:**
> Если для поля нужен ввод из транскрипта — а транскрипта нет — поле должно быть `null` (для скаляров), `[]` (для массивов), `{}` (для объектов). Никогда не «придумать заглушку».

---

## Что UI рендерит / скрывает (cross-ref ui-enrichment-contract.md)

| UI элемент | Рендерится для A? | Что показывает |
|---|---|---|
| **Шапка карточки** | ✅ Да | Бейдж «🔇 Whisper не нашёл речи» + duration + managerName + clientPhone (last 4) |
| **Плеер `<audio>`** | ⚠️ Только если `audioUrl` есть | РОП может прослушать вручную (validator не блокирует если audioUrl пустой) |
| **GC deep-link** | ⚠️ Только если `gcCallId` не null | Часто отсутствует |
| Block: callSummary | ✅ Да | Шаблонная строка «Whisper не нашёл речь...» |
| Block: cleanedTranscript | ✅ Да | Показываем raw `Ого!` чтобы РОП видел почему скипнули |
| Block: scriptDetails (11 этапов) | ❌ **СКРЫТЬ** | UI conditional: если `scriptScore IS NULL` → не рендерить блок |
| Block: phraseCompliance (12 техник) | ❌ **СКРЫТЬ** | UI conditional: если `Object.keys(phraseCompliance).length === 0` → скрыть |
| Block: psychTriggers | ❌ **СКРЫТЬ** | Оба массива пустые — скрыть весь блок |
| Block: criticalDialogMoments | ❌ **СКРЫТЬ** | Пустой массив |
| Block: keyClientPhrases | ❌ **СКРЫТЬ** | Пустой массив |
| Block: extractedCommitments (Block 7) | ❌ **СКРЫТЬ** | commitmentsCount=0 → скрыть весь Block 7 |
| Block: ropInsight | ✅ Да | Шаблонная строка «Не оценивать. Проверить запись вручную если важно.» |
| Block: nextStepRecommendation | ❌ **СКРЫТЬ** | null → не рендерить |
| Block: enrichedTags | ✅ Да | Чипы `no_speech` `не_оценивается` |
| Счётчик «N звонков без речи» в карточке МОПа | ✅ Да | Агрегат по managerId WHERE callOutcome='no_speech_or_silence' |

**Главный UX-индикатор:** в шапке вместо обычных метрик — **single badge «🔇 Whisper не нашёл речи»**. РОП понимает за 0.5 сек что это не звонок для разбора.

---

## Validator assertions (verbatim из EDGE-CASES.md)

```python
# Pre-check (skill определяет категорию ДО Opus):
if len(transcript or "") <= 100:
    category = "A"

# После генерации SQL — validate-enrich-sql.ts проверяет:
assert callOutcome == "no_speech_or_silence"
assert hadRealConversation == False
assert callType == "not_applicable"
assert scriptScore is None
assert criticalErrors == []
assert psychTriggers == {"positive": [], "missed": []}
assert phraseCompliance == {}     # empty object, not null
assert scriptDetails == {}
assert nextStepRecommendation is None
assert keyClientPhrases == []
assert clientEmotionPeaks == []
assert criticalDialogMoments == []
assert extractedCommitments == []
assert ropInsight == "Не оценивать. Проверить запись вручную если важно."
assert "no_speech" in tags
assert "не_оценивается" in tags

# Validator must REJECT if:
# - cleanedTranscript длиннее transcript (для A копируем raw, не cleanup'им)
# - Любое не-null поле кроме summary/cleanedTranscript/tags/clientReaction
```

**Что произойдёт при fail:** UPDATE SQL не выполнится, карточка вернётся в `needs_rerun_v10` пул, skill в следующей сессии перегенерирует.

---

## Сравнение с sample-3 / sample-4 (NORMAL)

| Параметр | sample-3 (Лариса, F NORMAL) | sample-A (NO_SPEECH) |
|---|---|---|
| Длительность | 12:00 | 4 sec |
| transcript size | ~11 642 chars | ≤ 100 chars |
| Заполненных блоков | 14 (все) | 4 (callOutcome, summary, cleanedTranscript, tags + clientReaction) |
| `scriptDetails` | 11 этапов с per-stage комментариями | `{}` |
| `phraseCompliance` | 12 техник, 2 used:true | `{}` |
| `psychTriggers.positive` | 3 приёма с time/technique/effect | `[]` |
| `psychTriggers.missed` | 5 упущений с full shape | `[]` |
| `extractedCommitments` | 2 (МОП обещал отправить, клиент попросил) | `[]` |
| `ropInsight` | 5 пунктов action items | Шаблонная строка |
| `nextStepRecommendation` | 4 шага с эмодзи 📲 📎 🗓️ 💌 | `null` |
| `purchaseProbability` | 35% (обоснованно) | `null` |
| Opus вызывается? | ✅ Да, ~90-120s thinking | ❌ Нет, fast template fill 5-10s |

**Ключевая разница:** в NORMAL мы заполняем все 14 блоков потому что есть данные. В A — мы **намеренно оставляем 90% полей пустыми** потому что заполнять их = галлюцинировать.

---

## Заметки для автора skill v10

1. **Pre-classification обязательна.** Skill v10 должен проверить `len(transcript) <= 100` ДО запуска Opus. Это economy: ~1500 звонков из 3684 (41%) попадают в A — экономим $$$ на Opus thinking.
2. **Не вызывать Opus вообще.** Шаблонное заполнение делает skill сам (Python/TypeScript util), без LLM. Чисто детерминированный код.
3. **Validator runtime обязателен.** Если Opus случайно сгенерирует SQL для A-карточки (например, мы забыли pre-classification) — `validate-enrich-sql.ts` ловит и отвергает.
4. **Counter в карточке МОПа** — агрегировать `COUNT(*) WHERE callOutcome='no_speech_or_silence'` per managerId. Это диагностика качества PBX/Whisper, не оценка МОПа.

---

**Last updated: 2026-05-03**
**Created for: skill v10 contract**
