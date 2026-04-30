# 🎯 Handoff: Skill v9.6 Quality Uplift Combo (E + D + A + B)

**Контекст (30.04.2026 вечер):** Master Enrich skill v9.5 имеет 24-26% partial rate — Opus иногда забывает `cleanedTranscript` или `phraseCompliance` в SQL UPDATE при batch обработке (особенно --limit=40). Это даёт текущее покрытие 76% эталона из 182 carteчек v9.5.

**Цель:** 4 точечных fix'а суммарно дают ~95% эталон + 100% БД-целостность (никаких partial в enriched). Делается за ~50 минут разработки. Скрипт после применения работает на ВСЕХ будущих /loop /enrich-calls сессиях.

**Не делать:** strict-classifier v9.7 (недели работы, для 95→99% gain — отдельная итерация после стабилизации).

---

## 📊 Состояние ДО применения (baseline)

```sql
-- Запусти ДО патчей чтобы зафиксировать стартовую точку
ssh -i ~/.ssh/timeweb root@80.76.60.130 "docker exec smart-analyze-db psql -U smartanalyze -d smartanalyze -c \"
SELECT 
  \\\"enrichedBy\\\",
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE \\\"cleanedTranscript\\\" IS NOT NULL) AS has_cleaned,
  COUNT(*) FILTER (WHERE \\\"phraseCompliance\\\" IS NOT NULL) AS has_phrase
FROM \\\"CallRecord\\\"
WHERE \\\"tenantId\\\"='cmo4qkb1000000jo432rh0l3u'
  AND \\\"enrichmentStatus\\\"='enriched'
  AND \\\"callOutcome\\\"='real_conversation'
GROUP BY 1 ORDER BY 2 DESC;\""
```

Ожидаемое до: ~74-76% has_cleaned для v9.5.

---

## 🛠 4 ФИКСА (применять в порядке E → D → A → B)

### ⚡ E. Snanger batches (1 минута)

**Что:** Уменьшить размер batch'а в `/loop /enrich-calls` с 40 до 5.

**Почему:** Opus сохраняет качество на маленьких batch'ах — context не устаёт. На --limit=40 partial rate 24-26%, на --limit=5 ожидается ~5-8%.

**Где менять:** В команде запуска юзером:
```
СТАРОЕ:  /loop /enrich-calls --tenant=diva-school --limit=40
НОВОЕ:   /loop /enrich-calls --tenant=diva-school --limit=5
```

Это **поведенческое изменение, без правки кода**. Просто документировать в SKILL.md что recommended limit = 5 для quality.

**В файле `~/.claude/skills/enrich-calls/SKILL.md`** — найти секцию «Использование» и заменить:
```
СТАРОЕ:
/enrich-calls --tenant=diva --limit=50
/enrich-calls --tenant=diva --limit=5 --dry-run

НОВОЕ:
/enrich-calls --tenant=diva --limit=5     # рекомендуется по умолчанию (v9.6 quality uplift)
/enrich-calls --tenant=diva --limit=10    # если опытная сессия и контекст свежий
/enrich-calls --tenant=diva --limit=40    # ⚠️ только для backfill, partial rate растёт
/enrich-calls --tenant=diva --limit=5 --dry-run
```

**Verify:** запустить `/loop /enrich-calls --tenant=diva-school --limit=5`, посмотреть один цикл — Opus должен делать чище.

---

### 🔄 D. Auto-detect partial (5 минут)

**Что:** Skill в начале каждой /loop iteration **сам находит** свои partial carteчки (cleanedTranscript=NULL у NORMAL real_conversation) и помечает их `needs_rerun_v9` ДО pickup нового batch.

**Зачем:** Self-healing цикл. Не нужны ручные UPDATE через psql когда обнаружишь partial — skill чистит за собой.

**Где менять:** В файле `~/.claude/skills/enrich-calls/SKILL.md` найти секцию «Шаг 2: Получить batch звонков» — вставить ПЕРЕД ним:

```markdown
### Шаг 1.5: Auto-detect partial v9.5 carteчек (v9.6 self-heal)

**В начале каждой /loop iteration — ОБЯЗАТЕЛЬНО** detect partial и пометить для rescore:

```sql
UPDATE "CallRecord"
SET "enrichmentStatus" = 'needs_rerun_v9',
    "enrichmentLockedAt" = NULL,
    "enrichmentLockedBy" = NULL
WHERE "tenantId" = $tenantId
  AND "enrichmentStatus" = 'enriched'
  AND "callOutcome" = 'real_conversation'
  AND duration >= 60                          -- только NORMAL
  AND ("cleanedTranscript" IS NULL OR "phraseCompliance" IS NULL)
  AND "enrichedBy" LIKE 'claude-opus-4-7-v9%' -- только наши версии
LIMIT 5;                                       -- max 5 за iteration, не флудить
```

Это — **5 carteчек на каждый /loop**. Self-healing цикл: партиал → re-rescore → эталон.
Не блокирует основную работу — после auto-detect skill идёт в Шаг 2 (батч новых).
```

**Verify:** после применения patch'а посмотреть логи /loop — должна быть строчка:
```
[auto-detect-partial] marked N partial cards for rerun
```

---

### 📝 A. Skill v9.6 self-review (10 минут)

**Что:** Усилить инструкцию Opus'у в self-check блоке: «после генерации SQL ОБЯЗАТЕЛЬНО перечитай свой UPDATE и проверь все 14 полей».

**Зачем:** Opus в спешке забывает поля — текстовая force-проверка помогает.

**Где менять:** В файле `~/.claude/skills/enrich-calls/SKILL.md` найти секцию «🚨 v9.4 АТОМАРНОСТЬ» (~строка 142). После неё добавить новый блок:

```markdown
🚨 **v9.6 SELF-REVIEW (ОБЯЗАТЕЛЬНО):**

ПОСЛЕ генерации SQL UPDATE для ОДНОЙ carteчки — НЕ применяй сразу:

1. **ПЕРЕЧИТАЙ** свой UPDATE statement.
2. **ПРОВЕРЬ список полей** против чек-листа ниже.
3. Если хоть одно обязательное поле отсутствует → **ПЕРЕПИШИ полный UPDATE**, не applying партиал.
4. ТОЛЬКО ПОСЛЕ verify — добавляй UPDATE в SQL файл.

**Чек-лист обязательных полей для NORMAL real_conversation ≥60s** (14 шт):

| Поле | Тип |
|---|---|
| cleanedTranscript | text — ≥85% от raw |
| cleanupNotes | jsonb |
| callSummary | text |
| psychTriggers | jsonb (positive≥3, missed≥4) |
| clientReaction | text |
| managerStyle | text |
| clientEmotionPeaks | jsonb (≥1) |
| keyClientPhrases | jsonb (≥4) |
| scriptDetails | jsonb (11 stages) |
| criticalErrors | jsonb (array, может быть пустой) |
| criticalDialogMoments | jsonb (≥1) |
| ropInsight | text (≥5 пунктов через \n) |
| nextStepRecommendation | text (≥4 шага через \n) |
| extractedCommitments | jsonb (≥1) |
| phraseCompliance | jsonb (12 техник) |
| purchaseProbability | int |
| enrichedTags | jsonb |

**Если опускаешь хоть одно для NORMAL — это нарушение канона. Лучше не записать вообще, чем записать partial.**

Этот self-review снижает Opus partial rate с 24% до ~10-12%.
Combined с D (auto-detect) и B (validator) — финал 95-98% эталон.
```

**Verify:** Поднять версию в шапке SKILL.md — `(v9.6)` + добавить описание в раздел про версии.

```python
# Также обновить enrichedBy в Шаге 4 (UPDATE template):
"enrichedBy" = 'claude-opus-4-7-v9.6',
```

---

### 🛡 B. Apply-wrapper validator (30-40 минут)

**Что:** Новый script `scripts/validate-enrich-sql.ts` который **парсит SQL файл** Opus'а и проверяет presence обязательных полей. Если какой-то UPDATE неполный — **отклоняет весь файл**, возвращает carteчки в pool.

**Зачем:** Runtime block. Никаких partial carteчек в БД физически невозможно даже если Opus всё равно ошибся.

**Файл:** `scripts/validate-enrich-sql.ts`

```typescript
/**
 * validate-enrich-sql.ts — pre-apply validator for Master Enrich SQL files.
 *
 * Reads SQL generated by Opus, parses each UPDATE, verifies all required
 * fields per call type are present. If any UPDATE is partial — rejects
 * the WHOLE batch (better than letting partial carteчки into DB).
 *
 * Usage:
 *   tsx scripts/validate-enrich-sql.ts <sql-file-path>
 *   exit code 0 = all valid → can apply
 *   exit code 1 = at least one UPDATE partial → reject all
 */
import { readFileSync, writeFileSync } from "node:fs"
import { argv, exit } from "node:process"

interface UpdateStmt {
  pbxUuid: string
  fields: Set<string>
  callType: string | null
  callOutcome: string | null
  duration: number | null
}

const REQUIRED_FOR_NORMAL = [
  "cleanedTranscript", "cleanupNotes", "callSummary",
  "psychTriggers", "clientReaction", "managerStyle",
  "clientEmotionPeaks", "keyClientPhrases",
  "scriptDetails", "criticalErrors", "criticalDialogMoments",
  "ropInsight", "nextStepRecommendation",
  "extractedCommitments", "phraseCompliance",
]

const REQUIRED_FOR_SHORT = [
  "callSummary", "scriptDetails", "criticalErrors",
  // cleanedTranscript / phraseCompliance — допустимо null для SHORT
]

const REQUIRED_FOR_EDGE = [
  "callSummary",
  // edge_case (voicemail/hung_up/no_speech) — почти всё может быть null
]

function parseSql(sql: string): UpdateStmt[] {
  const stmts: UpdateStmt[] = []
  // Split by `WHERE "pbxUuid"=` markers
  const updateBlocks = sql.split(/UPDATE\s+"CallRecord"\s+SET/i).slice(1)
  for (const block of updateBlocks) {
    const fields = new Set<string>()
    const fieldMatches = block.matchAll(/"(\w+)"\s*=/g)
    for (const m of fieldMatches) fields.add(m[1])

    const uuidMatch = block.match(/"pbxUuid"\s*=\s*'([0-9a-f-]+)'/i)
    if (!uuidMatch) continue

    const callTypeMatch = block.match(/"callType"\s*=\s*'([^']+)'/)
    const outcomeMatch = block.match(/"callOutcome"\s*=\s*'([^']+)'/)
    
    stmts.push({
      pbxUuid: uuidMatch[1],
      fields,
      callType: callTypeMatch?.[1] ?? null,
      callOutcome: outcomeMatch?.[1] ?? null,
      duration: null, // duration придется получить из БД отдельно если нужно
    })
  }
  return stmts
}

function validateStmt(stmt: UpdateStmt): { ok: boolean; missing: string[]; reason: string } {
  // Determine call type bucket
  const isReal = stmt.callOutcome === "real_conversation"
  const isEdge = ["voicemail", "hung_up", "no_speech_or_silence", "ivr", "no_answer", "technical_issue"]
                 .includes(stmt.callOutcome ?? "")
  
  let required: string[]
  let bucket: string
  if (isReal) {
    // For real_conversation, we assume NORMAL unless explicitly callType=Type-E.
    // Без duration в SQL — pragmatic assume NORMAL. Если хотите strict — fetch from DB.
    required = REQUIRED_FOR_NORMAL
    bucket = "NORMAL"
  } else if (isEdge) {
    required = REQUIRED_FOR_EDGE
    bucket = "EDGE_CASE"
  } else {
    required = REQUIRED_FOR_SHORT
    bucket = "UNKNOWN/SHORT"
  }
  
  const missing = required.filter(f => !stmt.fields.has(f))
  return {
    ok: missing.length === 0,
    missing,
    reason: `${bucket}: ${missing.length} fields missing`,
  }
}

function main() {
  const file = argv[2]
  if (!file) {
    console.error("Usage: tsx scripts/validate-enrich-sql.ts <sql-file>")
    exit(1)
  }
  
  const sql = readFileSync(file, "utf-8")
  const stmts = parseSql(sql)
  
  console.log(`[validate] Found ${stmts.length} UPDATE statements`)
  
  let valid = 0
  let invalid: Array<{ pbxUuid: string; missing: string[] }> = []
  
  for (const stmt of stmts) {
    const r = validateStmt(stmt)
    if (r.ok) {
      valid++
    } else {
      invalid.push({ pbxUuid: stmt.pbxUuid, missing: r.missing })
    }
  }
  
  console.log(`[validate] Valid: ${valid}/${stmts.length}`)
  if (invalid.length) {
    console.error(`[validate] ❌ INVALID — rejecting batch:`)
    for (const inv of invalid) {
      console.error(`  ${inv.pbxUuid}: missing ${inv.missing.join(", ")}`)
    }
    
    // Optional: write rejection log
    const logPath = file + ".rejected"
    writeFileSync(logPath, JSON.stringify(invalid, null, 2))
    console.error(`[validate] Rejection details: ${logPath}`)
    
    exit(1) // блокирует apply
  }
  
  console.log(`[validate] ✅ All ${valid} UPDATEs are valid. Safe to apply.`)
  exit(0)
}

main()
```

**Где использовать:** В шаге «применение SQL» (когда Opus делает `scp + docker cp + psql -f`):

```bash
# СТАРАЯ цепочка:
scp file.sql server:/tmp/
docker cp /tmp/file.sql container:/tmp/
docker exec container psql -f /tmp/file.sql

# НОВАЯ цепочка с validator:
npx tsx scripts/validate-enrich-sql.ts file.sql || { echo "❌ Validation failed"; exit 1; }
scp file.sql server:/tmp/
docker cp /tmp/file.sql container:/tmp/
docker exec container psql -f /tmp/file.sql

# Если validator вернул exit 1 — apply не происходит, carteчки 
# остаются in_progress, через 30 мин TTL вернутся в needs_rerun_v9 
# → следующая сессия попробует ещё раз с улучшенным SQL.
```

**Где интегрировать в skill:** В SKILL.md в Шаг 4 «Записать в БД» добавить заметку:

```markdown
🛡 **v9.6 PRE-APPLY VALIDATION:**

Перед `psql -f` ОБЯЗАТЕЛЬНО прогон через validator:

  npx tsx scripts/validate-enrich-sql.ts /tmp/batch.sql

Если exit 1 → НЕ применять. Carteчки останутся in_progress, 
через 30 мин TTL stale-recovery вернёт их в pool — следующая 
сессия попробует с лучшим SQL.

Это runtime block: гарантия что в БД НЕ попадёт partial.
```

**Verify:** Создать тестовый SQL с пропущенным полем → запустить validator → должен exit 1.

```bash
# Тест
echo 'UPDATE "CallRecord" SET "enrichedBy"='"'"'test'"'"', "callOutcome"='"'"'real_conversation'"'"' WHERE "pbxUuid"='"'"'fake-uuid'"'"';' > /tmp/bad.sql
npx tsx scripts/validate-enrich-sql.ts /tmp/bad.sql
# Ожидаем: exit 1, log "fake-uuid: missing cleanedTranscript, ..."
```

---

## 📋 Порядок применения

```
1. E (1 мин) — обновить SKILL.md рекомендации по --limit
2. D (5 мин) — добавить Шаг 1.5 в SKILL.md (auto-detect partial)
3. A (10 мин) — добавить v9.6 SELF-REVIEW в SKILL.md
4. B (30-40 мин) — написать validate-enrich-sql.ts + интеграция в Шаг 4 SKILL.md

Все вместе ~50 минут.
```

---

## ✅ Verify ПОСЛЕ применения

### Step 1: Проверить SKILL.md изменён

```bash
grep -n "v9.6\|SELF-REVIEW\|Auto-detect partial\|--limit=5" ~/.claude/skills/enrich-calls/SKILL.md | head -10
```

### Step 2: Проверить validator работает

```bash
ls /Users/kirillmalahov/smart-analyze/scripts/validate-enrich-sql.ts
npx tsx scripts/validate-enrich-sql.ts --help 2>&1 | head -3
```

### Step 3: Прогнать /loop через 1 цикл, замерить partial rate

```bash
# Открой 1 свежее окно
cd /Users/kirillmalahov/smart-analyze && claude --permission-mode bypassPermissions

# В нём:
/loop /enrich-calls --tenant=diva-school --limit=5

# Подождать 30-40 минут (5 carteчек × ~5 мин), потом проверить:
ssh -i ~/.ssh/timeweb root@80.76.60.130 "docker exec smart-analyze-db psql -U smartanalyze -d smartanalyze -c \"
SELECT COUNT(*) AS total,
  COUNT(*) FILTER (WHERE \\\"cleanedTranscript\\\" IS NOT NULL) AS has_cleaned,
  COUNT(*) FILTER (WHERE \\\"phraseCompliance\\\" IS NOT NULL) AS has_phrase
FROM \\\"CallRecord\\\"
WHERE \\\"tenantId\\\"='cmo4qkb1000000jo432rh0l3u'
  AND \\\"enrichedBy\\\"='claude-opus-4-7-v9.6'
  AND \\\"callOutcome\\\"='real_conversation';\""
```

**Ожидаемое:** has_cleaned/total ≥ 95%, has_phrase/total ≥ 95%.

Если меньше → значит self-review недостаточно силён, нужно усилить promрt в A или сделать B обязательным.

---

## 🚫 Что НЕ делать

❌ **Не выкатывать v9.6 на ВСЕ tenants одновременно** — сначала тест на diva-school 1-2 циклами, потом другие.

❌ **Не отключать v9.4 atomic правила** — v9.6 их расширяет, не заменяет.

❌ **Не делать --limit=1** — слишком медленно, скилл не оптимизирован под одиночные carteчки.

❌ **Не игнорировать validator exit 1** — если он отклонил батч, значит Opus не справился, надо чтобы карты вернулись в pool через TTL, **не применять partial**.

---

## 🎯 Ожидаемый результат

```
ДО:    24-26% partial rate
       76% эталон в БД

ПОСЛЕ E+D+A+B:
  partial rate at write:        5-8% (E + A снижает)
  partial after auto-detect:    2-3% (D перезапускает auto)
  partial in DB:                 0% (B блокирует)
  Время до 100% эталон любого batch: 2-3 цикла rescore
  
ИТОГ через ~3 цикла:    ~98-99% эталон в БД
                        + 0 partial в любой момент времени
```

---

## 🔗 Связанные документы

- `~/.claude/skills/enrich-calls/SKILL.md` — основной skill, патчится для E/D/A
- `scripts/validate-enrich-sql.ts` — новый файл (B)
- `docs/canons/master-enrich-samples/sample-3-proper-cleanup-lara.md` — эталон уровня для self-review
- `docs/canons/master-enrich-samples/sample-4-strong-closer-tech-block.md` — эталон уровня

---

## 📝 Commit message при применении

```
fix(enrich-skill): v9.6 quality uplift combo (E+D+A+B)

Reduces Master Enrich partial rate from 24-26% → ~3-5%
+ 100% DB integrity (validator blocks partial writes).

Changes:
- SKILL.md: recommend --limit=5 default (E)
- SKILL.md: Шаг 1.5 auto-detect partial → needs_rerun_v9 (D)
- SKILL.md: v9.6 SELF-REVIEW after SQL generation (A)
- SKILL.md: pre-apply validator integration (B)
- scripts/validate-enrich-sql.ts: new — parses SQL, validates 
  required fields per call type, exit 1 if partial found

Test:
  /loop /enrich-calls --tenant=diva-school --limit=5
  expect: 95%+ has_cleaned + has_phrase for v9.6 enriched cards
```

---

## 🚀 Готов к запуску

Этот хэндофф — single-document с полной инструкцией. Открыть свежую сессию Claude Code, дать ей этот файл, попросить применить все 4 фикса → готово за 50 минут.

**Команда для старта:**
```
Прочитай docs/handoffs/2026-04-30-skill-v96-quality-uplift-combo.md и
примени 4 фикса (E + D + A + B). Каждый фикс отдельным коммитом.
После применения — verify по чек-листу в конце документа.
```

---

## 🛑 STATUS: ЗАМОРОЖЕНО (30.04.2026 вечер)

**НЕ применять без обновления.** Этот handoff заморожен после pivot-решения работать через UI-driven contract (см. `2026-04-30-evening-pivot-ui-driven-contract.md`).

Финальная форма этих фиксов будет понятна **после** утверждения наполнения платформы (inventory UI → эталоны 7 категорий → contract). Часть фиксов (особенно B — validator) переедет в skill v10 в адаптированном виде.

---

## 📌 Risk review & доработки (от 30.04 вечер) — учесть при разморозке

Сессия-ревьюер прислала 3 нюанса перед применением. Зафиксированы здесь чтобы не потерять.

### 🟡 Нюанс 1 — Фикс A (self-review) дополняет B, не заменяет

**Опасность:** если skill сам проверяет свой SQL и сам говорит «всё ОК» — это echo chamber. LLM плохо ловит свои же ошибки если использует ту же логику reasoning. Self-review с тем же контекстом который генерил SQL — Opus подтвердит свой output как правильный.

**Решение:**
- A (self-review в промпте) — слабая защита, дополнение
- **B (external validator validate-enrich-sql.ts)** — сильная защита, **обязательная**
- При интеграции в skill v10: B обязательно, A опционально как «попытка #1 фикса до validator'а»

Если B убран в пользу только A — защита слабее.

### 🟡 Нюанс 2 — Фикс D (auto-detect partial): точные SQL-критерии обязательны

**Опасность:** если SQL-условие partial detection слишком широкое — пометит и edge-cases (voicemail/no_speech) для перегона = пустая трата лимитов. Если слишком узкое — пропустит реальные partial.

**Минимальное условие для NORMAL ≥60s:**
```sql
WHERE callOutcome = 'real_conversation'
  AND duration >= 60
  AND (
    cleanedTranscript IS NULL
    OR LENGTH(cleanedTranscript)::float / LENGTH(transcript) < 0.85
    OR phraseCompliance IS NULL
    OR psychTriggers IS NULL
  )
```

Для skill v10 — условия будут разные **per category** (NORMAL / SHORT / VOICEMAIL / etc.), потому что обязательные поля у категорий разные. Без UI-contract'а правильное условие написать нельзя — отсюда логика заморозки.

### 🟡 Нюанс 3 — Фикс B (validator): где именно вызывается?

**Опасность:** если validator запускается отдельным cron'ом утром — поздно, плохой SQL уже в БД.

**Правильный flow:**
```
Skill генерирует SQL → /tmp/batch.sql
↓
tsx scripts/validate-enrich-sql.ts /tmp/batch.sql
  → если invalid: exit ≠ 0, SQL не применяется,
    enrichmentStatus возвращается в pool
↓ (только если valid)
psql -f /tmp/batch.sql
↓
UPDATE СallRecord SET enrichmentStatus='enriched'
```

Validator должен быть **встроен в skill flow между SQL generation и `psql -f`**. Не post-hoc отчёт, не утренний cron.

В skill v10 — это runtime gate, не optional review.

---

## 🛡️ Pre-apply safety checklist (когда разморозим)

Перед запуском любой версии этого handoff:

1. **Backup БД** (30 секунд):
   ```bash
   ssh -i ~/.ssh/timeweb root@80.76.60.130 "docker exec smart-analyze-db pg_dump -U smartanalyze smartanalyze | gzip > /root/backup-pre-v96-$(date +%F-%H%M).sql.gz"
   ```
   Если фикс D перетрёт лишнее (broad partial detection) — откат.

2. **Покажи точное SQL-условие D** до запуска. Если слишком широкое (захватывает edge-cases) — поправь до применения.

3. **Verify B вызывается ВНУТРИ skill flow** перед UPDATE, не как post-hoc cron.

4. **После применения — verify-чек-лист обязателен.** Если хоть один пункт красный → `git revert` этого коммита.

---

## 🔗 Связано

- Master pivot: `2026-04-30-evening-pivot-ui-driven-contract.md`
- Баги: `2026-04-30-known-bugs-and-fixes.md`
- Memory: `feedback-skill-iteration-pivot.md`
