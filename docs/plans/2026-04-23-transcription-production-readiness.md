# Transcription Production Readiness Plan

**Date:** 2026-04-23
**Status:** READY TO EXECUTE
**Total estimated time:** ~5 часов до full production
**Cost estimate:** Intelion ~30₽ + DeepSeek ~50-100₽/итерация

---

## Context

После сессии тюнинга channel-first merge (v2.3 pipeline) и валидации на 30 звонках (15 diva onPBX + 15 vastu Sipuni) с 5-агентной QA проверкой получили:
- **Главное:** channel-first merge решает фрагментацию (429→139 lines на 26-мин звонке)
- **Найдено:** 2 не-merge проблемы — Sipuni outbound role inversion + Whisper repetition loops
- **Стратегическое решение:** добавить **LLM-layer** поверх ASR (паттерн Gong/Chorus) вместо погони за 100% ASR accuracy

**Provider role status (verified by 5 QA agents):**
- ✅ **Diva onPBX:** ролей не путает, LEFT=МЕНЕДЖЕР работает
- ❌ **Vastu Sipuni:** outbound звонки — role inversion (RIGHT=МЕНЕДЖЕР для исходящих)
- ⚠️ **Coral МегаПБХ:** mono only, нет каналов, не релевантно
- ⚠️ **Reklama Sipuni:** аналогично vastu (когда токен оживёт)

---

## Goal

Production-ready транскрипция + анализ pipeline для 5 клиентов SalesGuru. Принять что ASR ~88-92% accuracy — норма; компенсировать LLM-слоем который выполняет: voicemail filter + transcript repair + sales-script scoring.

---

## Deliverables

1. ✅ Channel-first merge (DONE in v2.3)
2. Sipuni outbound role-detection patch
3. Whisper repetition_penalty config
4. Voicemail/autoresponder detector (DeepSeek)
5. Sales-script scorer для diva 11-step (DeepSeek)
6. Transcript repair pass (DeepSeek context-aware)
7. Re-validation на 30 звонках после fixes

---

## Steps

### Step 1: Sipuni outbound role detection (~30 мин) [P0 BLOCKER]

**Проблема:** для исходящих vastu Sipuni звонков LEFT=КЛИЕНТ, RIGHT=МЕНЕДЖЕР (inverted vs текущей конвенции).

**Files:**
- `scripts/intelion-transcribe-v2.py` — основной pipeline
- `prisma/schema.prisma` — `CallRecord.direction` поле проверить (есть/нет)

**Implementation:**
1. Проверить наличие `direction` в `CallRecord` schema. Если нет — добавить миграцию (но скорее всего есть, т.к. amoCRM/Sipuni при sync проставляют).
2. Расширить batch JSONL формат: добавить поле `direction: "in"|"out"|null` и `provider: "sipuni"|"onpbx"|"megapbx"`.
3. В `process_one()`:
   ```python
   # Provider-aware role mapping
   provider = row.get("provider", "onpbx")
   direction = row.get("direction", "in")
   
   if provider == "sipuni" and direction == "out":
       mgr_label, cli_label = "МЕНЕДЖЕР", "КЛИЕНТ"
       mgr_words = extract_words(rs, mgr_label)  # SWAPPED: RIGHT
       cli_words = extract_words(ls, cli_label)  # SWAPPED: LEFT
   else:
       # Default: LEFT=МЕНЕДЖЕР (onPBX, Sipuni inbound)
       mgr_words = extract_words(ls, "МЕНЕДЖЕР")
       cli_words = extract_words(rs, "КЛИЕНТ")
   ```
4. Update `scripts/build-test-batch-diva.ts` and Sipuni batch builder to emit `direction` + `provider` fields.

**Verification:**
- Re-run на тех же 30 звонках
- Vastu outbound звонки (cmo5ha8v, cmo36cga) — проверить что менеджерская речь теперь под МЕНЕДЖЕР label
- Spawn 1 QA agent на каждый исправленный — должен сказать "channel swap fixed"

**Risk:** Если в `CallRecord` нет `direction` — fallback heuristic: первый говорящий (>1s utterance) = МЕНЕДЖЕР для outbound. Менее надёжно.

---

### Step 2: Whisper repetition_penalty config (~10 мин) [P1]

**Проблема:** Whisper иногда зацикливается ("вот, вот, вот ×80") на длинных однообразных участках.

**Files:**
- `scripts/intelion-transcribe-v2.py` — функция `transcribe_one_channel()`

**Implementation:**
```python
def transcribe_one_channel(model: WhisperModel, fp: Path):
    segments_iter, info = model.transcribe(
        str(fp),
        language=LANGUAGE,
        word_timestamps=True,
        vad_filter=False,
        condition_on_previous_text=False,
        beam_size=5,
        temperature=[0.0, 0.2, 0.4],
        no_repeat_ngram_size=3,        # NEW: prevent "вот, вот, вот..." loops
        repetition_penalty=1.1,         # NEW: discourage immediate repeats
    )
    return list(segments_iter), info
```

Добавить также halluc patterns в `HALLUCINATION_PATTERNS`:
```python
r"^\s*звонок\s+(дверь|телефон)\s*$",  # "ЗВОНОК ДВЕРЬ" caps hallucination
```

**Verification:**
- Re-run на long diva 5a662d50 (где было "вот×80" на L52)
- Grep транскрипт на повторения 5+ одинаковых слов подряд → должно быть 0

---

### Step 3: Combined re-validation (~15 мин) [P0]

**Files:** N/A (запуск)

**Implementation:**
1. Поднять Intelion server (status=2)
2. Регенерировать diva URLs через onPBX API (URLs истекают за ~30 мин)
3. SCP обновлённый pipeline + batch
4. Run 30 calls с new pipeline (RMS=2.5 + provider-aware roles + repetition_penalty)
5. SCP результат вниз
6. Score через `/tmp/tuning/score_transcript.py`
7. Spawn 5 QA agents на bottom-5 + 1 на vastu outbound (validate role fix)
8. **Stop server**

**Verification:**
- Avg agent score ≥7.5/10 (vs 6.5 в предыдущей итерации)
- 0 calls с role-swap reported by agents
- Diva long no longer has "вот×80" pattern

**Stop condition:** если agents reportят new regressions → revert и отдельный debug.

---

### Step 4: Voicemail/autoresponder detector (~1ч) [P1]

**Проблема:** многие звонки — менеджер говорит с автоответчиком/секретарём/ассистентом телефона. Анализировать как реальный диалог = false signal.

**Files (new):**
- `src/lib/llm/voicemail-detector.ts` — DeepSeek wrapper
- `scripts/detect-voicemail-batch.ts` — batch processor для CallRecord

**Implementation:**
1. DeepSeek prompt:
   ```
   You are analyzing a phone call transcript. Determine if this is a real two-way conversation or one of:
   - VOICEMAIL: автоответчик ("оставьте сообщение после сигнала")
   - SECRETARY: секретарь/помощник, не целевой клиент
   - IVR: голосовое меню ("нажмите 1 для...")
   - HUNG_UP: клиент сразу повесил трубку (<5s real interaction)
   - REAL: настоящий диалог продаж
   
   Output JSON: {type: "REAL"|"VOICEMAIL"|...,confidence: 0-100, reason: "..."}
   ```
2. Apply на все 1000 transcripts → category column в `CallRecord.callType`
3. Filter pipeline: только `callType="REAL"` идут в analysis

**Verification:**
- Manually label 20 calls (real/voicemail/etc) → проверить что DeepSeek dahcatches >90%
- В UI добавить filter chip "Только реальные диалоги"

---

### Step 5: Sales-script scorer для diva 11-step (~2ч) [P1]

**Цель:** для каждого diva звонка автоматически оценить соответствие 11 этапам скрипта продаж (`docs/demo/2026-04-22-diva-sales-script.md`).

**Files (new):**
- `src/lib/llm/script-scorer-diva.ts`
- `scripts/score-diva-scripts.ts`

**Implementation:**
1. Извлечь 11 этапов из sales-script doc
2. DeepSeek prompt per call:
   ```
   Below is a transcript of diva sales call. Score each of 11 stages 0-2 (0=missed, 1=partial, 2=done well):
   
   Stages:
   1. Установление контакта
   2. Программирование разговора
   3. Сбор информации (диагностика боли)
   4. Презентация продукта
   ... (full 11)
   
   Return JSON: {stages: [{n: 1, score: 2, evidence: "цитата из звонка"}, ...], total: X/22, weak_stages: [3, 7]}
   ```
3. Save into `CallRecord.scriptScore` (0-22) and `CallRecord.scriptDetails` (JSON)
4. UI: на странице звонка показать checklist 11 этапов с зелёными/жёлтыми/красными статусами

**Verification:**
- Manually score 5 calls → cross-check с DeepSeek
- Top-scoring менеджеры по `scriptScore` должны коррелировать с deal conversion

**Reuse existing:** `scripts/run-deepseek-pipeline.ts` (есть DeepSeek wrapper) — extend его, не дублировать.

---

### Step 6: Transcript repair pass (~1ч) [P2]

**Цель:** LLM правит явные ASR mistranscriptions используя контекст продукта.

**Files (new):**
- `src/lib/llm/transcript-repair.ts`
- `scripts/repair-transcripts.ts`

**Implementation:**
1. DeepSeek prompt с product glossary per tenant:
   ```
   Tenant: vastu (Школа Юли Морозовой)
   Product vocabulary: Васту, Гуру, Звёздный, стипендия, Юлия, Светлана
   
   Below is ASR transcript. Common ASR errors: "Гуру" → "Буру"/"гору", "Васту" → "Васьту"/"Васт".
   
   Fix obvious ASR errors using product context. Do NOT change meaning. Output corrected transcript with same [SPEAKER MM:SS] format.
   ```
2. Save original + repaired in `CallRecord` (transcript + transcriptRepaired)
3. Display repaired by default, original on toggle

**Verification:**
- Diff before/after на 10 calls — должно быть только domain-specific corrections
- Manual spot-check: repaired не должен hallucinate новый контент

**Risk:** LLM может "поправить" реальные слова на ожидаемые. Mitigate: ограничить changes на slovах из glossary.

---

### Step 7: Production deploy decision (~15 мин)

После steps 1-6 + re-validation:
- Если avg agent score ≥8/10 + 0 BROKEN + voicemail filter работает → **SHIP на 1000 retranscriptions**
- Если нет — детальный triage

**Files:**
- `memory/STATUS.md` — update текущего состояния
- `memory/feedback-pipeline-tuning-rms.md` — финальный verdict

---

## Out of scope (отложено)

1. RMS dB-калибровка per-call noise floor (roadmap из external review) — overkill для текущих данных
2. Cross-channel correlation+delay match — добавить если scale-up на coral/shumoff покажет проблему
3. Hysteresis/smoothing для merge — channel-first уже это решает
4. Speaker re-identification ML model — слишком сложно, gain маленький
5. Multi-language support — все клиенты RU
6. Empty-channel retry-with-mono fallback — edge case 3%, мониторим в production

---

## Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| `CallRecord.direction` поля нет в БД | Medium | Step 1 блокируется | Migration или fallback heuristic |
| Whisper repetition_penalty ломает legitимные повторы | Low | Минор | Тест на 30 звонках, threshold 1.1 (умеренный) |
| DeepSeek voicemail detector false-negatives | Medium | Часть мусора в анализе | Conservative threshold + manual sampling |
| LLM repair hallucination | Medium | Искажение контента | Glossary-only changes, оригинал сохраняется |
| Sipuni Statistics API key не выдан клиентом | High | Можем использовать только cached audioUrl path | Уже работает через `CallRecord.audioUrl` |

---

## Success criteria

- ✅ Step 1+2+3: Avg agent score ≥7.5/10 на 30-call re-validation
- ✅ Step 4: Voicemail detection accuracy ≥90% на 20 manually labeled
- ✅ Step 5: Script scorer correlation с deal conversion >0.4
- ✅ Step 6: Repair pass меняет <5% слов, все из glossary
- ✅ Step 7: 0 BROKEN из 30 calls → SHIP

---

## Cost & timeline

| Step | Time | Cost (₽) | Blocking |
|---|---|---|---|
| 1 — Sipuni outbound | 30 мин | 0 | P0 |
| 2 — Repetition penalty | 10 мин | 0 | P1 |
| 3 — Re-validation | 15 мин | ~15 | P0 |
| 4 — Voicemail detector | 1 ч | ~50 | P1 |
| 5 — Sales-script scorer | 2 ч | ~80 | P1 |
| 6 — Transcript repair | 1 ч | ~50 | P2 |
| 7 — Deploy decision | 15 мин | 0 | P0 |
| **TOTAL** | **~5 ч** | **~195** | — |

После — full retranscription 1000 звонков diva: ~9 ч Intelion (~430₽) + ~500₽ DeepSeek voicemail+script+repair = ~930₽ один прогон.
