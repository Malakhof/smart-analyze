# Q9: Per-Category Etalons (Variant B) — Creation Report

**Date:** 2026-05-03
**Author:** Expert agent (sales call analytics + Master Enrich domain)
**Decision context:** User chose Variant B (per-category etalons) over universal+hide approach. Rationale: anti-hallucination through explicit templates per category. Each etalon teaches Opus exactly what to write (and what NOT to write — null/[]/not_applicable) for that category.

---

## Files created (5)

1. `/Users/kirillmalahov/smart-analyze/docs/canons/master-enrich-samples/sample-A-no-speech.md` — NO_SPEECH (Whisper не нашёл речь, ≤100 chars)
2. `/Users/kirillmalahov/smart-analyze/docs/canons/master-enrich-samples/sample-B-voicemail-ivr.md` — VOICEMAIL/IVR (только МОП-реплики)
3. `/Users/kirillmalahov/smart-analyze/docs/canons/master-enrich-samples/sample-C-hung-up-no-answer.md` — HUNG_UP / NO_ANSWER (<30s, клиент сбросил)
4. `/Users/kirillmalahov/smart-analyze/docs/canons/master-enrich-samples/sample-D-technical-issue.md` — TECHNICAL (МОП и клиент не слышат друг друга)
5. `/Users/kirillmalahov/smart-analyze/docs/canons/master-enrich-samples/sample-E-short-reschedule.md` — **SHORT_RESCHEDULE (priority — 30-60s real_conversation, callback)**

(Category G PIPELINE_GAP — skipped per task instructions, остаётся optional.)

---

## Common structure (matches sample-3 / sample-4 format)

Each etalon contains:

1. **Frontmatter title** with category letter + subtype
2. **Meta** table (pbxUuid synthetic, duration, category, archetype, scriptScore)
3. **Example transcript** (raw, что приходит из Whisper):
   - A: `Ого!` (Whisper hallucination на тишине)
   - B: МОП-реплики + `[АВТООТВЕТЧИК]: Вызываемый абонент не отвечает...`
   - C: `[МЕНЕДЖЕР] (приветствие)` → `[КЛИЕНТ] Алло.` → сброс
   - D: 5-7 повторяющихся «Алло, слышите?» с обеих сторон
   - E: 47-сек реалистичный обмен «за рулём, перезвоните после 20:00»
4. **CLEANUP NOTES** (для A-D: «не cleanup'им, копируем raw»; для E: compression 85%)
5. **Полная ENRICHED CARD** (YAML структура — что skill должен записать в БД)
6. **Какие поля заполнены** — explicit table с конкретными значениями
7. **Какие поля null / [] / {} / not_applicable + WHY** — anti-hallucination explicit explanations
8. **Что UI рендерит / скрывает** — cross-ref Q1 conditional matrix
9. **Validator assertions** — copy verbatim из EDGE-CASES.md
10. **Сравнение с sample-3/4 (NORMAL)** + другими категориями
11. **Заметки для автора skill v10** — implementation hints
12. **Footer** с датой и «Created for: skill v10 contract»

---

## Key decisions per etalon

### Sample A (NO_SPEECH)
- **Главная anti-hallucination guardrail:** для A `cleanedTranscript = raw copy`. Validator blocks if `len(cleaned) > len(raw)` — это ловит галлюцинации Opus'а который попытается «добавить» приветствие которого не было.
- **9 полей `null` / 6 полей `[]` / 3 поля `{}`** — все объяснены WHY.
- **Шаблонная строка ropInsight:** точное `"Не оценивать. Проверить запись вручную если важно."` (validator string match).
- **Не вызывать Opus** — детерминированное заполнение skill'ом.

### Sample B (VOICEMAIL/IVR)
- **Различение voicemail vs ivr:** voicemail — голосовая почта абонента; ivr — корпоративный robot-меню. Default: voicemail.
- **Опциональный commitment:** если МОП оставил голосовое типа «перезвоню в 16:00» — записать в `extractedCommitments` с `action: callback`. Цель: tracking МОПа выполнил ли обещание.
- `cleanedTranscript = raw copy` (не cleanup'им — содержит полезную диагностику для РОПа).

### Sample C (HUNG_UP / NO_ANSWER)
- **Различение через hangupCause:** `ORIGINATOR_CANCEL` → `hung_up`; `NO_ANSWER` / `USER_BUSY` → `no_answer`.
- **clientReaction:** `cold` для активного сброса, `not_engaged` для NO_ANSWER (alternatives in validator enum).
- **Anti-hallucination:** не записывать «Алло» в keyClientPhrases, не ставить `interrupted_client` в criticalErrors (это МОПа обрубили, не наоборот).

### Sample D (TECHNICAL)
- **clientReaction обязательно `confused`** (validator: assert).
- **ropInsight расширенный** — содержит **диагностический вопрос для РОПа** про hardware/гарнитуру/SIP. Это special clause из EDGE-CASES.md.
- **Алерт-логика:** если у МОПа >5% звонков с `callOutcome=technical_issue` — daily cron шлёт алерт тех. отделу.
- 🚨 **UI индикатор красная подложка** — отличает от других edge-cases по visibility.

### Sample E (SHORT_RESCHEDULE) — PRIORITY ⚠️
- **САМАЯ ВАЖНАЯ КАТЕГОРИЯ** — самая частая после NORMAL (~8% всех diva-звонков). Без эталона Opus путается NORMAL vs A-D template.
- **Упрощённый Master Enrich** — не полный 14-блок, не template-only.
- **Cleanup обязателен** — compression ≥85% (validator).
- **scriptDetails 11 этапов с na разрешён** — но 4 этапа `(1, 2, 9, 11)` обязательно не-na.
- **≥1 callback commitment** — validator явно требует `any(c.action == "callback")`.
- **scriptScore ≤ 3** — validator guard против inflated scores за 38 сек.
- **purchaseProbability=null** — anti-hallucination против Opus который захочет поставить «50% neutral».
- **managerStyle новые подтипы:** `polite_seller` / `passive_seller` (не нагружаем strong_closer / empathic_seller).
- Пример transcript полностью реалистичный (за рулём, callback на сегодня после 20:00) с реалистичным cleanup (Whisper-артефакты «за рулом»→«за рулём», «Дева»→«Дива»).

---

## Universal invariant across all 5 etalons

> **Anti-hallucination через explicit declaration:** каждый эталон содержит **отдельную секцию** «Какие поля null / [] / {} / not_applicable + WHY» где **для каждого пустого поля объяснено почему** оно пустое и **что Opus МОГ БЫ сгаллюцинировать** (e.g. «не записывать "Алло" как keyClientPhrase», «не ставить scriptScore=1/11 за приветствие в пустоту», «не записывать "приветствие = искренний_комплимент"»).

Это главное отличие от Variant A (universal+hide) — там Opus генерил бы значения для всех полей и UI скрывал бы. Здесь Opus **не генерит** для нерелевантных полей, что достоверно (validator блокирует если возникнут).

---

## Notes for skill v10 author

### 1. Pre-classification ОБЯЗАТЕЛЬНА
Skill v10 должен проверить категорию **до** вызова Opus:
- Категории A, B, C, D → **не вызывать Opus** (детерминированный template fill — 5-10 сек)
- Категория E → **упрощённый Opus prompt** (только cleanedTranscript + 11 этапов + commitment, ~30-60s thinking)
- Категория F (NORMAL) → полный prompt (~90-120s thinking)

Economy: ~70% звонков (A+B+C+D) идут без Opus → экономим $$$.

### 2. Validator runtime — independent code, not Opus
`validate-enrich-sql.ts` парсит UPDATE SQL и применяет per-category assertions из EDGE-CASES.md. **Echo chamber защита:** validator НЕ использует те же reasoning что генерило SQL.

Critical для категорий A, B, C, D: validator проверяет **точные строки** (`ropInsight == "Не оценивать..."`) и **shape constraints** (`scriptDetails == {}`, не null).

### 3. Различение E vs F-NORMAL
Главный риск: 30-60s `real_conversation` где клиент НЕ просил перенос (просто короткий полноценный диалог) — это всё ещё F NORMAL, не E. Pre-classification regex должен искать конкретные маркеры (`перезвон|не сейчас|занят|позже|за рулём|неудобно`).

### 4. Различение D vs B
- B: только МОП-реплики, нет КЛИЕНТ-реплик → voicemail/ivr
- D: реплики обеих сторон, но повторяющиеся tech_markers без content → technical_issue

### 5. UI conditional rendering matrix (см. Q1)
Для каждого эталона блок «Что UI рендерит / скрывает» содержит точную таблицу — какие из 14 блоков рендерить, какие скрывать на основе значений полей. Cross-reference с `ui-enrichment-contract.md`.

### 6. Управление managerStyle enum
Для E добавлены новые значения: `polite_seller`, `passive_seller`. Они **не входят** в текущий enum в `ui-enrichment-contract.md` (там перечислены `soft_seller/aggressive/empathic/neutral/technical/strong_closer/empathic_seller/tech_naive`). Skill v10 author должен либо **расширить enum**, либо **mapping** на ближайший существующий (`soft_seller`).

### 7. Эталоны как примеры в SKILL.md
Каждый эталон должен быть **доступен** Opus как example в момент enrichment. Возможный flow:
- Skill определяет категорию
- Skill читает `sample-{X}-*.md` под выбранную категорию
- Skill включает соответствующие YAML/markdown секции в prompt как «образец, по которому надо генерить»

Это разница от старого подхода когда Opus читал все 6+ эталонов и угадывал какой релевантен.

---

## Open issues / нерешённое

1. **Sample G (PIPELINE_GAP)** — skipped per task instructions. Optional follow-up.
2. **managerStyle enum extension** — нужно решить либо расширить enum, либо mapping (см. above).
3. **Boundary case 30s vs 31s.** Звонок 29s = категория C; 30s = категория E. Это hard cutoff в validator. Может стоит soft transition (29-32s = ambiguous, fallback на содержание transcript)?
4. **Boundary case 59s vs 60s.** Звонок 59s = категория E; 60s = NORMAL. Та же проблема.
5. **Validator for ropInsight string match (A)** — строгий match: `assert ropInsight == "Не оценивать. Проверить запись вручную если важно."`. Если в шаблоне опечатка — все A карточки fail. Возможно стоит `assert "Не оценивать" in ropInsight`?

---

**Last updated: 2026-05-03**
