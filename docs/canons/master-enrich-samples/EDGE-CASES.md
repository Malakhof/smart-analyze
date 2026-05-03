# 🔀 Edge-Cases Decision Tree & Processing Logic

**Что должна делать обогащающая логика для каждого типа звонка.** Связан с `CATEGORIES.md` (определение типов) и `CATALOG.md` (эталоны).

Это **runtime spec для skill v10** — не для текстовых assertions, а для прямого кода `validate-enrich-sql.ts` + skill flow.

---

## 🔀 Pre-classification flow (skill v10)

```
1. SELECT batch under SESSION_ID  (atomic FOR UPDATE SKIP LOCKED)
       │
       ▼
2. For each call in batch:
   ├─ Read transcript + duration + callOutcome (from DeepSeek)
   ├─ Determine category via decision tree
   └─ Branch:
       ├─ A/B/C/D/G → fast template fill (5-10s, no Opus thinking)
       ├─ E → simplified Opus enrichment (less fields, ~60s)
       └─ F → full Opus enrichment (~90-120s)
       │
       ▼
3. validate-enrich-sql.ts checks shape per category
   ├─ Pass → psql -f /tmp/batch.sql
   └─ Fail → return to needs_rerun_v10 pool
       │
       ▼
4. UPDATE enrichmentStatus='enriched' + enrichedBy='claude-opus-4-7-v10'
```

---

## ✅ Per-Category Validation Rules (v10)

### Category A: NO_SPEECH

**Pre-check (before any Opus):**
```python
if len(transcript or "") <= 100:
    category = "A"
```

**Validator must pass these checks:**
```python
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
```

**Validator must REJECT if:**
- cleanedTranscript длиннее transcript (для A копируем raw, не cleanup'им)
- Любое не-null поле кроме summary/cleanedTranscript/tags/clientReaction

---

### Category B: VOICEMAIL/IVR

**Pre-check:**
```python
# Только МОП-реплики, нет КЛИЕНТ-реплик
manager_lines = re.findall(r"\[МЕНЕДЖЕР", transcript)
client_lines = re.findall(r"\[КЛИЕНТ", transcript)
voicemail_markers = re.search(r"вызываемый\s+абонент|оставайтесь\s+на\s+линии|после\s+сигнала", transcript, re.I)

if (manager_lines and not client_lines) or voicemail_markers:
    category = "B"
```

**Validator:**
```python
assert callOutcome in ("voicemail", "ivr")
assert hadRealConversation == False
assert callType == "not_applicable"
assert scriptScore is None
assert clientReaction == "silent"
assert "voicemail" in tags or "ivr" in tags
assert "ндз" in tags
```

**Optional поля (могут быть):**
- extractedCommitments — если МОП оставил голосовое сообщение типа "перезвоню в 14:00", фиксировать как commit_to_callback

---

### Category C: HUNG_UP / NO_ANSWER

**Pre-check:**
```python
if duration < 30 and (hangup_cause in ("ORIGINATOR_CANCEL", "NO_ANSWER", "USER_BUSY")):
    category = "C"
elif duration < 30 and len(transcript) < 200 and "Алло" in transcript and not has_dialogue:
    category = "C"
```

**Validator:**
```python
assert callOutcome in ("hung_up", "no_answer")
assert hadRealConversation == False
assert clientReaction in ("cold", "not_engaged")
assert "ндз" in tags
```

---

### Category D: TECHNICAL

**Pre-check:**
```python
tech_markers = re.findall(r"вы\s+меня\s+слышите|алло[\s,.!]+алло|плохо\s+слышно|перезвоните", transcript, re.I)
content_substantial = len(transcript) > 200 and not all(line_is_short_phatic(l) for l in transcript.splitlines())

if len(tech_markers) >= 2 and not content_substantial:
    category = "D"
```

**Validator:**
```python
assert callOutcome == "technical_issue"
assert hadRealConversation == False
assert clientReaction == "confused"
assert "тех_проблема" in tags or "technical_issue" in tags
assert "ндз" in tags
```

**Special:** ropInsight должен включать **диагностический вопрос** для РОПа:
- «Если у этого МОПа повторяется → проблема гарнитуры/SIP»
- Cron daily summary считает D-звонков per МОП — если у одного >5%, alert.

---

### Category E: SHORT_RESCHEDULE

**Pre-check:**
```python
if (callOutcome == "real_conversation"
    and duration >= 30 and duration < 60
    and re.search(r"перезвон|не\s+сейчас|занят|позже|завтра\s+попробу", transcript, re.I)):
    category = "E"
```

**Validator (ОБЯЗАТЕЛЬНЫЕ для SHORT):**
```python
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

---

### Category F: NORMAL

**Pre-check:**
```python
if (callOutcome == "real_conversation" and duration >= 60):
    category = "F"
```

**Validator (ПОЛНЫЙ — все 14 блоков):**

```python
# Cleanup mandatory
assert cleanedTranscript is not None
compression = len(cleanedTranscript) / len(transcript)
assert 0.85 <= compression <= 1.15, f"compression {compression:.2f} вне [0.85, 1.15]"
assert cleanupNotes is not None

# Summary
assert summary is not None and len(summary) >= 100

# Classification
assert callType is not None and callType not in ("not_applicable", None)
assert outcome in ("closed_won","closed_lost","objection_unresolved","scheduled_followup","nurture","not_interested")
assert hadRealConversation == True
assert isCurator is not None
assert isFirstLine is not None
assert possibleDuplicate is not None
assert purchaseProbability is not None and 0 <= purchaseProbability <= 100

# Script
assert scriptScore is not None
assert scriptScorePct is not None
assert isinstance(scriptDetails, dict) and len(scriptDetails) == 11
required_stages_normal = [
    "1_приветствие", "2_причина_звонка",
    "4_квалификация", "5_выявление_потребностей", "6_презентация",
    "9_следующий_шаг", "11_прощание"
]
for stage in required_stages_normal:
    s = scriptDetails.get(stage, {})
    assert not s.get("na"), f"v10: {stage} обязателен для NORMAL — score=0/0.5/1, не na"
assert isinstance(criticalErrors, list)

# Psychology — full shape
assert "positive" in psychTriggers and "missed" in psychTriggers
assert len(psychTriggers["positive"]) >= 3
assert len(psychTriggers["missed"]) >= 4
for m in psychTriggers["missed"]:
    assert "time" in m and "quote_client" in m and "should_have_said" in m, "missed shape incomplete"
assert clientReaction is not None
assert managerStyle is not None
assert isinstance(clientEmotionPeaks, list) and len(clientEmotionPeaks) >= 1
assert isinstance(keyClientPhrases, list) and len(keyClientPhrases) >= 4
for p in keyClientPhrases:
    assert "time" in p and "quote" in p, "phrase shape incomplete"
assert isinstance(criticalDialogMoments, list) and len(criticalDialogMoments) >= 1

# phraseCompliance — 12 техник, каждая с used+evidence или missed+note
assert isinstance(phraseCompliance, dict)
expected_techniques = [
    "программирование_звонка","искренние_комплименты","эмоциональный_подхват",
    "юмор_забота","крюк_к_боли","презентация_под_боль","попытка_сделки_без_паузы",
    "выбор_без_выбора","бонусы_с_дедлайном","повторная_попытка_после_возражения",
    "маленькая_просьба","следующий_шаг_с_временем"
]
for t in expected_techniques:
    assert t in phraseCompliance, f"phraseCompliance missing technique: {t}"
    pc = phraseCompliance[t]
    assert "used" in pc, f"{t} missing used flag"
    if pc["used"]:
        assert pc.get("evidence") or pc.get("examples"), f"{t} used=true but no evidence/examples"
    else:
        assert pc.get("missed") or pc.get("note"), f"{t} used=false but no missed/note explanation"

# Insights
assert ropInsight is not None
assert ropInsight.count("\n") + 1 >= 5, "ropInsight нужно ≥5 пунктов"
assert nextStepRecommendation is not None
assert nextStepRecommendation.count("\n") + 1 >= 4, "nextStep нужно ≥4 шага"
assert isinstance(extractedCommitments, list) and len(extractedCommitments) >= 1
for c in extractedCommitments:
    assert "speaker" in c and "quote" in c and "action" in c, "commitment shape incomplete"
assert managerWeakSpot is not None
assert isinstance(enrichedTags, list) and len(enrichedTags) >= 3

# GC deep-link (если gcCallId есть)
if gcCallId is not None:
    assert gcCallCardUrl == f"{baseUrl}/user/control/contact/update/id/{gcCallId}"
    assert gcDeepLinkType == "call_card"
```

**Все assertions выше блокируют запись через `validate-enrich-sql.ts` BEFORE `psql -f`.**

---

### Category G: PIPELINE_GAP

**Pre-check (этот flag ставится BEFORE classification):**
```python
if (audioUrl is None
    or transcript is None
    or gcCallId is None
    or managerId is None):
    category = "G"
    skip_master_enrich = True
```

**Validator:**
```python
assert callOutcome == "pipeline_gap"
assert hadRealConversation is None       # неизвестно
assert all(field is None for field in [
    callType, outcome, scriptScore, scriptDetails,
    psychTriggers, ropInsight, nextStepRecommendation
])
assert "pipeline_gap" in tags
assert "requires_manual" in tags
assert diagnostic is not None             # обязательно показать что отсутствует
```

**UI behaviour:**
- **НЕ показывать как call card** в `/calls/[pbxUuid]`
- Показать в карточке МОПа `/managers/[id]` секция «N pipeline_gap звонков»
- Drill-down → diagnostic info, не enriched fields

---

## 🛡️ Validator контракт (validate-enrich-sql.ts)

**Расположение:** `scripts/validate-enrich-sql.ts`
**Когда вызывается:** между `Opus generates SQL` и `psql -f`. **Не post-hoc.**

**Flow:**
```bash
# Skill flow (concept):
opus_generate_batch_sql > /tmp/batch-${SESSION_ID}.sql
tsx scripts/validate-enrich-sql.ts /tmp/batch-${SESSION_ID}.sql || exit 1
psql -f /tmp/batch-${SESSION_ID}.sql
```

**Что делает скрипт:**
1. Парсит каждый `UPDATE "CallRecord" SET ... WHERE "id" = '<id>'` из файла
2. Достаёт jsonb-поля и числовые поля
3. Загружает category по pbxUuid через quick query (need transcript + duration)
4. Применяет соответствующий validator из этого файла
5. Если хоть один UPDATE fail — exit 1 + вывод reasons
6. Skill при exit 1 возвращает carteчки в `needs_rerun_v10`

**Echo chamber защита:**
- Validator — независимый код, не Opus
- Не использует те же reasoning что генерило SQL
- Regex/JSON shape — детерминированно, без LLM

---

## 🚨 Failure modes & recovery

### Случай 1: Validator rejects 30-50% batch'а

**Возможно:**
- Skill ещё не успел адаптироваться (первые batch'и v10)
- UI-contract пропустил какие-то поля

**Действие:** не паниковать. Carteчки идут в needs_rerun_v10. После 2-3 итераций rejection rate должен упасть < 10% (Opus learns from validator feedback if errors встроены в context).

### Случай 2: Validator rejects всё подряд

**Возможно:**
- Bug в validator (например, перепутал поле в shape check)
- Schema БД изменилась (новое jsonb поле без backward compat)

**Действие:** roll back validator commit, проверить test fixtures.

### Случай 3: Stale lock + двойная трата

**Не баг validator'а** — это уже решено через `enrichmentLockedAt < NOW() - INTERVAL '30 minutes'` + `FOR UPDATE SKIP LOCKED`. Но если Opus упёрся в лимит mid-batch, валидация для уже сгенерированных carteчек НЕ выполнится (skill завис), они останутся `in_progress`. Stale recovery после 30 мин подхватит их → новая сессия с свежим контекстом → validator ловит, retry.

---

## 📋 Acceptance test plan для skill v10

Перед разрешением backfill, прогнать на **10 свежих звонках разных категорий** (через cron auto-update, не historical):

| Категория | Кол-во в тесте | Pass criterion |
|---|---|---|
| A: NO_SPEECH | 1-2 | Validator accepts, поля заполнены шаблонно, нет Opus thinking |
| B: VOICEMAIL | 1-2 | Validator accepts, callOutcome=voicemail, ndz tag |
| C: HUNG_UP | 1-2 | Validator accepts, hadRealConversation=false |
| D: TECHNICAL | 0-1 | Validator accepts (если попадётся) |
| E: SHORT | 2-3 | Cleanup ≥85%, all 11 stages, ≥1 callback commitment |
| F: NORMAL | 2-3 | All 14 blocks, all asserts pass |
| G: PIPELINE_GAP | 0-1 | Skip Master Enrich, diagnostic заполнен |

**Threshold:** **≥9/10 pass** (90%+) → разрешить backfill `--limit=10` в одной сессии.

---

## 🔗 Связанные документы

- `CATEGORIES.md` — детали 7 категорий (правила различения)
- `CATALOG.md` — что есть из эталонов (sample-3, sample-4) + что нужно создать
- `../../handoffs/2026-05-03-skill-v10-progress.md` — статус и roadmap
- `../../handoffs/2026-04-30-skill-v96-quality-uplift-combo.md` — заморожен, элементы для v10 validator
- `~/.claude/skills/enrich-calls/SKILL.md` — текущий v9.5 (заморожен)

---

**Last updated: 2026-05-03**
