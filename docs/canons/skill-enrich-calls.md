---
name: enrich-calls
description: "Master Enrich для звонков SalesGuru. Обогащает batch 40-50 звонков по 6-блочной схеме (callType, callOutcome, criticalErrors, psychology, ropInsight). Используется при подключении нового клиента (backfill) и для вечернего batch enrichment ежедневного потока. Работает через Claude Pro подписку — $0."
---

# /enrich-calls — Master Enrich

Обогащает звонки в БД SalesGuru до полной enriched-карточки. **100% покрытие анкеты клиента + наш слой нейропродаж.**

---

## 🛑 STEP 0 — ОБЯЗАТЕЛЬНЫЙ ПЕРВЫЙ TOOL-CALL (фикс #1+#2)

**Перед любым SQL/Bash в этой сессии — выполни БУКВАЛЬНО:**

```
Read("/Users/kirillmalahov/smart-analyze/docs/canons/master-enrich-samples/sample-3-proper-cleanup-lara.md")
```

**Это ЕДИНСТВЕННЫЙ актуальный эталон** (v9, после cleanup-инцидента 29.04.2026):
- ✅ Правильный cleanup (compression ~80%) — только мусор удалён, содержание сохранено
- ✅ Все markdown-таблицы (психология / скрипт-скоринг / критические ошибки)
- ✅ Эмодзи в nextStep (📲 📎 🗓️ 💌)
- ✅ phraseCompliance с 12 техниками diva
- ✅ Block 7 commitments

**Старые sample-1 и sample-2 АРХИВИРОВАНЫ** в `docs/canons/master-enrich-samples/archive_v8_with_compression_bug/`. Они имеют дефект сжатия (15-30% компрессии вместо 80%+) — **НЕ читать их**, путают.

Без Read sample-3 в новой сессии **весь дальнейший вывод считается некорректным**. Не «я знаю эту структуру» — **Read обязателен**, даже если думаешь что помнишь.

Эталоны лежат **в репо** (не на ~/Desktop) — воспроизводимо на любой машине / production / в worktree.

---

## 🔴 CRITICAL — ПРОЧИТАЙ ПЕРЕД ЛЮБЫМ ENRICH

### 0. ⛔ DIVA CUT-OFF: ≥ 2026-04-24 (всё что раньше — НЕ обрабатывать)

**Аналитика для diva-school ведётся СТРОГО с 24 апреля 2026.**

- Первый легитимный звонок: `pbxUuid=3d811959-3994-4387-bd91-a143e4f99ae1` от `2026-04-24 05:46:55 UTC` (08:46 МСК)
- В БД лежит **5269 старых CallRecord** для diva с `startStamp IS NULL` (legacy syncs до schema migration) — **их НЕ обогащать**
- Master Enrich ОБЯЗАТЕЛЬНО фильтрует:
  ```sql
  AND "startStamp" >= '2026-04-24 00:00:00'
  AND "startStamp" IS NOT NULL
  ```

**Без этого фильтра skill сожрёт 80 quota-токенов на legacy без startStamp вместо актуального backfill 857 (24-27.04).**

Если пользователь явно хочет старые → передаёт флаг `--include-legacy` (по умолчанию **выкл**).

---

### 1. Эталоны — два, разные роли
- **Visual benchmark = sample-2** (`master-enrich-samples/sample-2-empathic-win-back-brackets.md`) — markdown таблицы для каждой секции, эмодзи в nextStep. Это **визуальный стиль** который нужно повторять.
- **Field reference = sample-1** (`master-enrich-samples/sample-1-soft-seller-no-offer.md`) — YAML-style, для понимания **набора полей**.

**Стиль вывода = sample-2 (таблицы). Набор полей = sample-1 (YAML reference).**

**НЕ копировать YAML-стиль sample-1 в финальный output.** Карточка должна выглядеть как sample-2 (table-rich, markdown).

В эталоне:
- 🧼 Очищенный транскрипт (cleanedTranscript) с заметками cleanup
- 📝 Резюме звонка (summary) — 4 строки
- 🧠 Психология и нейропродажи — **table** удачных приёмов (time / приём / эффект) + **table** упущений + 4-5 missed triggers с цитатами + clientReaction + managerStyle + clientEmotionPeaks + 4-5 keyClientPhrases + criticalDialogMoments (отдельный анализ ключевых моментов с цитатами клиента и предложением "что должна была сказать МОП")
- 📊 Скрипт-скоринг — **table** all 11 stages с оценкой и комментарием
- 🚨 Критические ошибки — **table** all 6 ошибок (✅/⚠️/❌)
- 💡 Инсайт для РОПа — **5 пунктов** конкретных action items + паттерн (soft_seller / empathic / etc) + purchaseProbability с обоснованием
- 🛠️ nextStepRecommendation — **4 конкретных шага** с каналами и временами
- 🏷️ Tags
- 🎯 Категория и исход — **table**
- ✅ Соответствие требованиям — **table** анкета diva → покрыто

**Если ты делаешь карточку без таблиц / без 4+ missed triggers / без criticalDialogMoments — ты НЕ в эталоне. Переделывай.**

### 2. AUTO-MODE с escape hatch (фикс #6)
**Дефолт = auto без подтверждений. Escape — только через явные флаги.**

- Не спрашивать "продолжать?" / "как форматировать?" / "сколько обрабатывать?"
- **Сразу делать batch согласно --limit и применять к БД**
- Только системная ошибка (БД недоступна, schema колонок нет) → остановиться

**Escape hatch для калибровки качества:**
- `--uuids=<один UUID>` (ровно 1) → показать карточку **БЕЗ commit** и остановиться
- `--dry-run` → показать batch **БЕЗ записи в БД**
- В обоих случаях НЕ спрашивать подтверждение — просто вывод и stop

Это сохраняет защитный паттерн «покажи 1 для калибровки» (тот что спас сегодняшний batch), не ломая auto-mode по умолчанию.

### 3. Глубина = эталон, не "краткий формат"
- Если выдаёшь карточку короче эталона — ошибка
- Если пропускаешь criticalDialogMoments — ошибка
- Если выдаёшь ropInsight в 1-2 строки — ошибка (нужно 5 пунктов)
- Если в `psychTriggers.missed` менее 3 элементов — ошибка (норма 4-5)

### 4. Self-check ПЕРЕД UPDATE в БД (фикс #7) — count-based
**Перед каждым commit карточки в БД считай явно:**

```python
# Только для полноценных NORMAL звонков (Тип F):
# Тип E (30-60 сек "перезвоните позже") и edge-case (Тип A-D) проверяются мягче.
if callOutcome == "real_conversation" and duration >= 60:
    # ПОЛНЫЙ NORMAL — все проверки
    assert len(psychTriggers["missed"]) >= 4, "missed triggers < 4 — переделать"
    assert len(psychTriggers["positive"]) >= 3, "positive triggers < 3 — переделать"
    assert ropInsight.count("\n") + 1 >= 5, "ropInsight < 5 пунктов — переделать"
    assert len(scriptDetails) == 11, "scriptDetails != 11 stages diva — переделать"
    assert len(criticalDialogMoments) >= 1, "criticalDialogMoments пуст — переделать"
    assert len(nextStepRecommendation.split("\n")) >= 4, "nextStep < 4 шагов — переделать"
    assert len(keyClientPhrases) >= 4, "keyClientPhrases < 4 цитат — переделать"
    assert purchaseProbability is not None, "purchaseProbability = null для NORMAL — переделать"
    assert len(extractedCommitments) >= 1, "extractedCommitments пуст для NORMAL — переделать (Block 7 killer feature)"
    assert len(phraseCompliance) >= 12, "phraseCompliance < 12 техник — переделать (новое v8 поле)"
elif callOutcome == "real_conversation" and duration < 60:
    # Тип E (SHORT_RESCHEDULE) — мягкие проверки, без assert на purchaseProbability/commitments
    assert len(scriptDetails) == 11, "scriptDetails != 11 stages — переделать"
    # extractedCommitments может быть пуст (клиент просто "перезвоните позже")
    # purchaseProbability может быть null (нет данных за 30-60 сек)
    # nextStepRecommendation может быть короче (1-2 шага = "перезвонить в Y времени")

# Для edge-case Тип A-D (voicemail/no_answer/hung_up/technical) — assertions не применяются
# extractedCommitments может быть пуст для edge-case — это норма
# criticalErrors может быть пуст если МОП всё сделал правильно
```

Если хоть одно AssertionError → **карточка переделывается**, не коммитится.

---

## Использование

```
/enrich-calls --tenant=diva --limit=50
/enrich-calls --tenant=diva --since="2026-04-28T00:00"
/enrich-calls --tenant=diva --uuids="<u1>,<u2>,..."
/enrich-calls --tenant=diva --limit=50 --rescore
/enrich-calls --tenant=diva --limit=5 --dry-run
```

## Аргументы

- `--tenant` (обязательный): `diva-school | vastu | reklama | coral | shumoff`
- `--limit` (default 50): максимум звонков за batch
- `--since` (ISO timestamp): фильтр `startStamp >= since`
- `--uuids` (csv): явные UUIDs для обогащения
- `--rescore`: re-enrich уже обогащённые
- `--dry-run`: вывести результат, не писать в БД
- `--auto-continue`: после batch если pending>0 — recursive call (для /loop)

## Что я делаю при вызове skill

### Шаг 1: Auto-discover контекст клиента (один раз в начале сессии)

**Принцип:** skill полностью автономный — user только говорит `/enrich-calls --tenant=diva --limit=50`, всё остальное skill находит сам.

1. **Tenant ID:**
   ```sql
   SELECT id, "name", subdomain FROM "Tenant" WHERE name LIKE '<tenant>%' LIMIT 1
   ```

2. **Анкета:** `/Users/kirillmalahov/smart-analyze/docs/demo/<tenant>-anketa-answers.md`
   - Раздел 2: список МОПов / кураторов / первой линии
   - Раздел 4: что считать продажей
   - Раздел 5: категории звонков
   - Раздел 6: 6 критических ошибок
   - Раздел 8: правила дублей
   - Раздел 9: РОП-боли (callOutcome счётчики)

3. **Скрипт продаж:** `/Users/kirillmalahov/smart-analyze/docs/demo/<tenant>-sales-script.md`
   - 11 этапов (для diva), маппинг на критические ошибки

4. **Schema enriched card:** `~/.claude/projects/-Users-kirillmalahov/memory/feedback-master-enrich-canon.md`

5. **Pipeline canon:** `~/.claude/projects/-Users-kirillmalahov/memory/feedback-pipeline-canon-with-opus-enrich.md`

6. **Phone resolve (canon #8):** `~/.claude/projects/-Users-kirillmalahov/memory/feedback-upsert-call-canon8-mandatory.md`
   - 3-этапная цепочка: phone → GC `/pl/api/account/users?phone=X` → user_id → `Deal.clientCrmId` → `Deal.id`
   - НЕТ поля `phone` в нашей БД — bridge через GC API (per-tenant различия)

7. **🔥 Эталон enriched card (ОБЯЗАТЕЛЬНО прочитать ПОЛНОСТЬЮ):**
   `/Users/kirillmalahov/smart-analyze/docs/canons/master-enrich-samples/sample-1-soft-seller-no-offer.md`
   - **Это benchmark глубины.** Каждая твоя карточка = эта структура с тем же уровнем детализации.
   - НЕ сокращать таблицы, НЕ упрощать формулировки, НЕ пропускать секции
   - Если skill грузит мало контекста → перечитать ПОЛНОСТЬЮ перед каждым batch (даже если думаешь "уже знаю")

8. **Список менеджеров tenant:**
   ```sql
   SELECT id, name, "internalExtension", role FROM "Manager" WHERE "tenantId" = '<tenantId>'
   ```
   - Кураторы = `role='curator'` OR fuzzy match по фамилиям из анкеты раздел 2
   - Первая линия = list из анкеты раздел 2

### Шаг 2: Получить batch звонков (с готовыми linker'ами)

```sql
SELECT
  cr.id, cr."pbxUuid", cr."clientPhone", cr."startStamp", cr.duration,
  cr."userTalkTime", cr.gateway, cr."hangupCause", cr.direction,
  cr."managerId", m.name as managerName, m."internalExtension",
  cr.transcript, cr."transcriptRepaired",
  cr."gcContactId", cr."dealId",      -- ← АВТОМАТИЧЕСКИ из Stage 3.5
  d."crmId" as dealCrmId,              -- ← для deep-link на сделку
  cc.subdomain as gcSubdomain          -- ← из CrmConfig (Tenant.subdomain НЕ существует — фикс #4)
FROM "CallRecord" cr
LEFT JOIN "Manager" m ON cr."managerId" = m.id
LEFT JOIN "Deal" d ON cr."dealId" = d.id
LEFT JOIN "CrmConfig" cc ON cc."tenantId" = cr."tenantId" AND cc.provider='GETCOURSE'
WHERE cr."tenantId" = '<tenantId>'
  AND cr.transcript IS NOT NULL
  AND cr."startStamp" IS NOT NULL                  -- ⛔ legacy без stamp ИГНОРИРОВАТЬ
  AND cr."startStamp" >= '2026-04-24 00:00:00'    -- ⛔ DIVA CUT-OFF (см. секцию 0)
  AND (
    cr."enrichmentStatus" IS NULL
    OR cr."enrichmentStatus" = 'needs_rerun_v9'    -- v9: помеченные для re-run после cleanup-bug
    OR (
      -- v9 concurrent: stale lock recovery (если сессия упала с in_progress)
      cr."enrichmentStatus" = 'in_progress'
      AND cr."enrichmentLockedAt" < NOW() - INTERVAL '30 minutes'
    )
    OR --rescore
  )
  AND (--since: cr."startStamp" >= --since)
  AND (--uuids: cr."pbxUuid" IN (--uuids))
ORDER BY cr."startStamp" ASC                       -- старые-в-периоде первыми (хронология)
LIMIT --limit
```

### 🆕 v9 Concurrent-safe pattern (для запуска N сессий параллельно)

**Каждая сессия Claude Code должна получить уникальный session_id** в начале работы:
```python
import uuid
SESSION_ID = f"session-{uuid.uuid4().hex[:8]}"  # например session-a3f9b2c1
```

**Шаг 2 v9 — атомарная резервация batch'а** (заменить SELECT на этот pattern):

```sql
-- Атомарно резервирует 40 строк под текущую сессию
-- FOR UPDATE SKIP LOCKED — другие сессии skip их и берут следующие 40
WITH batch_to_claim AS (
  SELECT id
  FROM "CallRecord" cr
  WHERE cr."tenantId" = '<tenantId>'
    AND cr.transcript IS NOT NULL
    AND cr."startStamp" IS NOT NULL
    AND cr."startStamp" >= '2026-04-24 00:00:00'
    AND (
      cr."enrichmentStatus" IS NULL
      OR cr."enrichmentStatus" = 'needs_rerun_v9'
      OR (cr."enrichmentStatus" = 'in_progress'
          AND cr."enrichmentLockedAt" < NOW() - INTERVAL '30 minutes')
    )
  ORDER BY cr."startStamp" ASC
  LIMIT <limit>
  FOR UPDATE SKIP LOCKED
)
UPDATE "CallRecord"
SET "enrichmentStatus" = 'in_progress',
    "enrichmentLockedAt" = NOW(),
    "enrichmentLockedBy" = '<SESSION_ID>'
FROM batch_to_claim
WHERE "CallRecord".id = batch_to_claim.id
RETURNING
  "CallRecord".id, "CallRecord"."pbxUuid", "CallRecord"."clientPhone",
  "CallRecord"."startStamp", "CallRecord".duration, "CallRecord"."userTalkTime",
  "CallRecord".transcript, "CallRecord"."transcriptRepaired",
  "CallRecord"."gcContactId", "CallRecord"."dealId",
  "CallRecord"."managerId";
-- + докрутить JOIN'ы для manager_name, dealCrmId, gcSubdomain через дополнительные queries
```

**После успешного UPSERT карточки:** `enrichmentStatus = 'enriched'` + `enrichmentLockedBy = NULL`.

**Если сессия упала** на конкретном звонке: запись осталась `in_progress` с lockedAt. Через 30 мин любая другая сессия её подхватит автоматически (stale recovery в WHERE clause выше).

### Запуск N сессий параллельно (5 сессий = 5x ускорение)

```bash
# Терминал 1
cd /Users/kirillmalahov/smart-analyze && claude --permission-mode bypassPermissions
# В сессии: /loop /enrich-calls --tenant=diva-school --limit=40

# Терминал 2 (повторить в окнах 3, 4, 5)
cd /Users/kirillmalahov/smart-analyze && claude --permission-mode bypassPermissions
# В сессии: /loop /enrich-calls --tenant=diva-school --limit=40
```

Каждая сессия атомарно берёт свои 40 через `FOR UPDATE SKIP LOCKED` — пересечений нет.

855 pending / 5 сессий / 27 сек на звонок = **~75 минут** вместо 6+ часов.

**Stale recovery:** если одна сессия зависнет/закроется — её 40 in-flight звонков через 30 мин подхватит другая сессия.

**Per-tenant cut-off** (если меняется tenant — обновить):
- `diva-school`: `>= '2026-04-24'`
- остальные tenants: cut-off из `Tenant.analyticsStartDate` (если поле есть) или анкеты onboarding

**Важно:** для diva subdomain в `CrmConfig.subdomain` (`web.diva.school`). `Tenant.subdomain` НЕ существует — не использовать.

**Применять ТОЛЬКО через ssh + docker exec (фикс #5):**
```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 "docker exec smart-analyze-db psql -U smartanalyze -d smartanalyze -c '<SQL>'"
```
**НЕ использовать MCP soldout-db** — это другая БД (WB-аналитика), там нет таблиц SalesGuru.

### Шаг 3: Для каждого звонка — обогатить через Opus reasoning

Используй **полный контекст звонка** (transcript + transcriptRepaired + metadata + анкета + скрипт + список менеджеров) и сгенерируй 6-блочную карточку по schema `feedback-master-enrich-canon.md`.

**Принципы обогащения (КРИТИЧНО):**

1. **🔴 Cleanup transcript — ЖЁСТКИЕ ПРАВИЛА (v9, после инцидента 29.04.2026)**

   **КОНТЕКСТ:** Whisper-pipeline СПЕЦИАЛЬНО оптимизирован для дословной транскрипции (params PROB=0.20, GAP=3.0, hotwords из БД). Каждое слово клиента и менеджера — **ценность для анализа**. Cleanup должен **уважать дословность**, не уничтожать её.

   **ЧТО МОЖНО УДАЛИТЬ:**
   - ✅ Эхо реплик в чужом канале (Whisper транскрибирует фразу клиента в треке менеджера и наоборот — это галлюцинация stereo split)
   - ✅ Whisper-галлюцинации — бессмысленные слова («творчество на ледяная подворота», «братья-борщики», «шейфилизировал»)
   - ✅ Повторы Whisper (один и тот же кусок транскрибирован дважды подряд)

   **ЧТО МОЖНО ИСПРАВИТЬ:**
   - ✅ Имена (Илнура → Эльнура, унификация)
   - ✅ Термины (гипотериоз → гипотиреоз, плосизма → платизма)
   - ✅ Восстановить порядок реплик если Whisper склеил неверно
   - ✅ Использовать hotwords из анкеты для правильной транскрипции

   **🚫 АБСОЛЮТНЫЙ ЗАПРЕТ:**
   - ❌ **НЕ суммаризировать** диалог — каждое слово сохраняется
   - ❌ **НЕ заменять** монологи на пересказ типа «клиент рассказала про возраст и боли»
   - ❌ **НЕ выкидывать** «технические» куски диалога типа «10 минут — попытки доставить ссылку»
   - ❌ **НЕ сжимать** длинные реплики в короткие фразы
   - ❌ **НЕ искажать** слова клиента или менеджера
   - ❌ **НЕ выдумывать** контент которого нет в raw

   **ПРАВИЛО КОМПРЕССИИ (assert):**
   ```python
   if duration >= 60:
       compression = len(cleanedTranscript) / len(transcript)
       assert compression >= 0.85, f"❌ Cleanup сжал {compression:.0%} — переделать"
   ```
   На длинных звонках **85-100% объёма raw должно остаться**. Меньше — это суммаризация, не cleanup.

   **САМОСВЕРКА:** если в raw есть фраза-цитата клиента — она ДОЛЖНА быть в cleaned дословно. Цитаты в `keyClientPhrases`, `psychTriggers.missed.quote_client`, `criticalDialogMoments.client_quote` берутся ИЗ cleaned, не из raw — поэтому cleaned обязан содержать их полностью.

   **Эталон proper cleanup:** `/Users/kirillmalahov/smart-analyze/docs/canons/master-enrich-samples/sample-3-proper-cleanup-lara.md` — звонок Лары 12 мин, raw 11642→cleaned 11000+ chars (90%+).

2. **Классификация:**
   - `isCurator` — match по фамилиям из анкеты раздел 2 (для diva — список выше)
   - `isFirstLine` — match по фамилиям из анкеты (для diva — Жихарев, Чернышова)
   - `callType` — по содержимому transcript (анкета п.5)
   - `callOutcome` — по содержимому: real_conversation если есть полноценный диалог, voicemail если только автоинформер, no_answer если короткий разговор без слов клиента, hung_up если резкий обрыв, ivr если IVR-меню
   - `outcome` — по итогу разговора (анкета п.4)
   - `possibleDuplicate` — `SELECT COUNT(*) FROM "CallRecord" WHERE "clientPhone"=X AND "tenantId"=Y AND id != current_id` — если есть другой звонок с тем же phone — true

3. **Script compliance** (анкета п.6):
   - 6 фиксированных criticalErrors enum
   - **scriptScoreMax (фикс #10):** теоретический максимум diva = 11 этапов, но фактически = 11 - count(N/A stages). На практике **max = 9 для большинства звонков** (этапы 7 «возражения» и 10 «ответы на вопросы» часто N/A — клиент не возражает / не задаёт вопросов). Не считать N/A в общую сумму.
   - `scriptScore` = сумма баллов по non-N/A stages
   - `scriptScorePct` = scriptScore / scriptScoreMax
   - `scriptDetails` per-stage (jsonb со всеми 11)

4. **Психология (наш слой):**
   - psychTriggers.positive — приёмы которые МОП использовала (искренний_комплимент, выбор_без_выбора, эмоциональный_подхват, юмор_забота, эхо_ритуала, программирование, маленькая_просьба)
   - psychTriggers.missed — упущенные триггеры клиента (по словам клиента "бесит", "вечно борюсь", "не получается", возраст, обстоятельства типа "больничный")
   - clientReaction по тону клиента
   - managerStyle (soft_seller / aggressive / empathic / neutral / technical)
   - clientEmotionPeaks — когда клиент включился / закрылся
   - keyClientPhrases — цитаты-триггеры

4.5. **🆕 phraseCompliance (v8 — машинно-читаемая агрегация техник из анкеты)**

   **Цель:** дать РОПу агрегацию «топ-3 фразы которые МОПы чаще всего НЕ используют» (по 100+ звонкам).

   `phraseCompliance` — jsonb, **12 техник из скрипта diva** с boolean + context:

   ```yaml
   phraseCompliance:
     программирование_звонка:        # Этап 2 скрипта diva
       used: true
       evidence: "несколько вопросов задам, не для решения"
     искренние_комплименты:          # 2-3 за разговор !!!
       used: false
       expected_count: 2-3
       actual_count: 0
     эмоциональный_подхват:          # "понимаю", "поняла"
       used: true
       examples: ["поняла", "ага"]
     юмор_забота:                    # "зарядку не буду заставлять"
       used: false
     крюк_к_боли:                    # связка с выявленной болью
       used: false
       missed_opportunity: "гипотиреоз → диетолог в программе"
     презентация_под_боль:           # НЕ абстрактно про продукт
       used: false
       should: "связать гипотиреоз+12ч с конкретными модулями"
     попытка_сделки_без_паузы:       # сразу после презентации
       used: false
     выбор_без_выбора:               # "полностью или в рассрочку?"
       used: false
       missed: "не дошли до этапа закрытия"
     бонусы_с_дедлайном:             # "до завтра — открою бонусы"
       used: false
     повторная_попытка_после_возражения:  # после каждого возражения
       used: false
       evidence: "после 'не починю' отступила, не попробовала рассрочку"
     маленькая_просьба:              # Этап 7 — "пришлите скрин оплаты"
       used: false
       context: "не дошли до оплаты"
     следующий_шаг_с_временем:       # "пишу 4 мая в 19:00" не "позже"
       used: false
       evidence: "WhatsApp без точного времени follow-up"
   ```

   **Правила:**
   - Все 12 техник ОБЯЗАТЕЛЬНО присутствуют в jsonb (даже если `used: false` — это сигнал РОПу)
   - `evidence` — точная цитата если used=true, или explanation что упущено если used=false
   - Для edge-case (Тип A-D) — phraseCompliance может быть null (нечего оценивать)
   - Для Тип E (короткий перенос) — заполняется только применимое (программирование/следующий_шаг)
   - Для Тип F (NORMAL) — все 12 техник заполнены

   **Self-check:** для NORMAL `assert len(phraseCompliance) >= 12`.

   **Дашборд РОПа** (Канон #37 Block 7) сможет агрегировать:
   ```sql
   SELECT
     COUNT(*) FILTER (WHERE "phraseCompliance"->'выбор_без_выбора'->>'used' = 'false') AS missing_choice,
     COUNT(*) FILTER (WHERE "phraseCompliance"->'искренние_комплименты'->>'used' = 'false') AS missing_compliments
   FROM "CallRecord" WHERE "tenantId"=...
   ```
   → видно какую технику тренировать всем МОПам.

5. **ropInsight для РОПа:**
   - 3-5 конкретных action items
   - Указать паттерн МОПа (soft_seller / robot_script / overselling / no_close / etc)
   - Конкретные тренинги или правила
   - purchaseProbability 0-100

6. **nextStepRecommendation:**
   - Что МОП должна сделать ДО следующего звонка
   - Конкретный канал (WhatsApp/Telegram/email/звонок)
   - Конкретное время

7. **🔗 GC Deep-link (АВТОМАТИЧЕСКИ из БД):**
   ```python
   subdomain = row['gcSubdomain']  # web.diva.school
   if row['dealId'] and row['dealCrmId']:
       gcCallCardUrl = f"https://{subdomain}/sales/control/deal/update/id/{row['dealCrmId']}"
       gcDeepLinkType = 'call_card'
   elif row['gcContactId']:
       gcCallCardUrl = f"https://{subdomain}/pl/user/contact/update/id/{row['gcContactId']}"
       gcDeepLinkType = 'contact_fallback'
   else:
       gcCallCardUrl = None
       gcDeepLinkType = None
   ```
   **Не нужно ничего "выдумывать"** — данные уже в БД (Stage 3.5 заполняет до enrich).
   Для **новых звонков** в production: cron sync-pipeline автоматически делает phone resolve + deal link → к моменту enrich оба поля готовы.

8. **🔥 extractedCommitments (Block 7 — KILLER FEATURE):**
   Вытаскиваешь ВСЕ обещания и договорённости из звонка — отдельно для МОПа и клиента.
   Каждое обещание — структурированный объект:
   ```yaml
   - speaker: МЕНЕДЖЕР | КЛИЕНТ
     quote: "Прислать формат курса"   # точная цитата из транскрипта
     timestamp: "03:49"
     action: send_whatsapp | send_email | callback | send_offer | meeting | task | bring_documents | other
     deadline: "end_of_day" | "+1_day" | "+7_days" | "2026-08-28" | "after_event:брекеты_4_мес" | "unspecified"
     target: "КП на Дива 5D"           # что отправить / сделать
     evidence: "Не касается рта. Прислать формат?"   # контекст
   ```
   **Что считать обещанием:**
   - "пришлю", "отправлю", "напишу", "перезвоню", "наберу"
   - "запишу", "поставлю в группу", "зарезервирую"
   - "проверю", "согласую", "уточню"
   - со стороны клиента: "напишу скрин", "пришлю документы", "посмотрю и решу"
   **НЕ считать:** общие фразы "будем на связи", "до свидания", "хорошо".
   **Deadline:** если не назван явно — выводить из контекста ("сегодня", "после брекетов 4 мес" → +4 мес).
   `commitmentsCount` = длина массива.
   `commitmentsTracked` = false (default — sync в CRM в отдельной фазе).

### Шаг 4: Записать в БД

Для каждой карточки сделать UPDATE:
```sql
UPDATE "CallRecord" SET
  "enrichmentStatus" = 'enriched',
  "enrichedAt" = NOW(),
  "enrichedBy" = 'claude-opus-4-7-v1',
  "callType" = '...',
  "callOutcome" = '...',
  "hadRealConversation" = ...,
  "outcome" = '...',
  "isCurator" = ...,
  "isFirstLine" = ...,
  "possibleDuplicate" = ...,
  "scriptScore" = ...,
  "scriptScorePct" = ...,
  "criticalErrors" = '[...]'::jsonb,
  "scriptDetails" = '{...}'::jsonb,
  "psychTriggers" = '{...}'::jsonb,
  "phraseCompliance" = '{...}'::jsonb,    -- v8: 12 техник из анкеты
  "clientReaction" = '...',
  "managerStyle" = '...',
  "clientEmotionPeaks" = '[...]'::jsonb,
  "keyClientPhrases" = '[...]'::jsonb,
  "cleanedTranscript" = '...',
  "callSummary" = '...',
  "managerWeakSpot" = '...',
  "criticalDialogMoments" = '[...]'::jsonb,
  "ropInsight" = '...',
  "enrichedTags" = '[...]'::jsonb,
  "nextStepRecommendation" = '...',
  "purchaseProbability" = ...,
  "extractedCommitments" = '[...]'::jsonb,
  "commitmentsCount" = ...,
  "commitmentsTracked" = false
WHERE "pbxUuid" = '...'
```

### ⚠️ ТОЧНЫЕ имена колонок (фикс #3 — синхронизировано с prod БД 29.04.2026)

**Не путать camelCase / underscore_case:**

| Правильно | НЕ писать |
|---|---|
| `possibleDuplicate` | ❌ `possible_duplicate` |
| `callSummary` (есть от detect-call-type) | ❌ `summary` (такой колонки нет) |
| `enrichedTags` | ❌ `tags` (есть отдельная связь CallTag) |
| `cleanedTranscript` | (правильно, только camelCase) |
| `psychTriggers` | (правильно, только camelCase) |
| `scriptDetails` | (есть от scoring) |
| `scriptScorePct` | (правильно) |
| `criticalDialogMoments` | (правильно) |
| `nextStepRecommendation` | (правильно) |
| `extractedCommitments` | (правильно) |

**Полный список колонок CallRecord (60 штук, проверено):**
id, tenantId, managerId, dealId, crmId, clientName, clientPhone, direction, category, audioUrl, transcript, duration, createdAt, type, callType, transcriptRepaired, scriptScore, scriptDetails, pbxUuid, managerExt, startStamp, userTalkTime, hangupCause, gateway, qualityScore, pbxMeta, **callSummary**, sentiment, objections, hotLead, hotLeadReason, gcContactId, **enrichmentStatus**, enrichedAt, enrichedBy, callOutcome, hadRealConversation, outcome, isCurator, isFirstLine, **possibleDuplicate**, scriptScorePct, criticalErrors, psychTriggers, clientReaction, managerStyle, clientEmotionPeaks, keyClientPhrases, cleanedTranscript, cleanupNotes, managerWeakSpot, criticalDialogMoments, ropInsight, **enrichedTags**, nextStepRecommendation, purchaseProbability, gcCallCardUrl, gcDeepLinkType, extractedCommitments, commitmentsCount.

При сомнении — `\d "CallRecord"` через psql.

**Если в БД нет нужных колонок** — сгенерировать миграцию:
```sql
ALTER TABLE "CallRecord" ADD COLUMN IF NOT EXISTS "enrichmentStatus" TEXT;
ALTER TABLE "CallRecord" ADD COLUMN IF NOT EXISTS "callType" TEXT;
-- ... и т.д.
```
И сначала применить миграцию, потом UPDATE'ы.

### Шаг 5: Отчёт + Auto-continue

После batch — короткий отчёт:
- Обогащено N/total в этом batch
- Cumulative прогресс: enriched/total для tenant (через SQL count)
- Распределение callType (квалификация_лида: 12, продажи_новый: 5, ...)
- Распределение outcome (no_offer_made: 8, scheduled_callback: 4, ...)
- Top managerStyle паттерны (soft_seller: 7, ...)
- Top critical errors (no_close_attempt: 9, monolog_not_pain_tied: 4, ...)

### Шаг 6 — Auto-loop (только если работаем с /loop или --auto-continue)

После отчёта SQL:
```sql
SELECT COUNT(*) FROM "CallRecord"
WHERE "tenantId" = '<tenantId>'
  AND transcript IS NOT NULL
  AND ("enrichmentStatus" IS NULL OR "enrichmentStatus" != 'enriched')
```

### Auto-continue через ScheduleWakeup (фикс #8 — РАБОЧИЙ механизм)

**`/loop` в dynamic mode НЕ сканирует строки `[CONTINUE]/[DONE]` — он ждёт `ScheduleWakeup` от тебя.**

**В конце каждого batch ответа:**

```python
if pending > 0:
    ScheduleWakeup(
        delaySeconds=120,
        prompt="/enrich-calls --tenant=diva-school --limit=40",
        reason="continue enrichment, pending=N"
    )
    print(f"⏸ Batch done. Pending {pending}. Next wake in 2 min.")
else:
    # просто НЕ вызывать ScheduleWakeup — loop остановится
    print("✅ Backfill complete: N/N enriched")
```

**Никаких `[CONTINUE]`/`[DONE]` строк не нужно.** `ScheduleWakeup` (или его отсутствие) — единственный сигнал.

**Если skill вызван НЕ через `/loop`, а с `--auto-continue`:**
- pending > 0 → recursive вызов `/enrich-calls` сам через tool-call

**Старт всего:** `/loop /enrich-calls --tenant=diva-school --limit=40` → loop крутится через ScheduleWakeup пока pending > 0.

## 🛑 Edge-cases — звонки БЕЗ нормального разговора

Не все 857 звонков — настоящий диалог. Skill должен корректно классифицировать эти случаи:

### Тип A: Звонок без речи / Whisper-галлюцинация (фикс #9)
**Признак:** transcript ≤ 100 chars **независимо от типа содержимого** (placeholder, Whisper-галлюцинация типа "Ого!" / "Продолжение следует...", шум). Признак: невозможно реконструировать диалог из текста.

**Заполнить:**
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
tags: [no_speech, не_оценивается]
```

### Тип B: Автоответчик / IVR / голосовое меню
**Признак:** в transcript `callType=VOICEMAIL` (уже определено DeepSeek classifier ранее) ИЛИ репликам только МОПа, нет КЛИЕНТ-реплик, фразы типа "вызываемый абонент не отвечает", "оставайтесь на линии".

**Заполнить:**
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

### Тип C: Гудки / абонент сбросил (HUNG_UP)
**Признак:** очень короткий transcript (< 30 секунд), нет содержательного диалога — клиент сбросил после "Алло" или вообще не ответил.

**Заполнить:**
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

### Тип D: Менеджер и клиент НЕ слышат друг друга (тех. проблема)
**Признак:** в transcript обе стороны говорят, но повторяют "Алло", "вы меня слышите?", "плохо слышно", "перезвоните" — нет содержательного диалога.

**Заполнить:**
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

### Тип E: Очень короткий разговор без сути
**Признак:** длительность 30-60 сек, клиент сказал "не сейчас / занят / перезвоните позже" → перенос.

**Заполнить почти как обычно**, но scriptScore низкий (1-2/9):
```yaml
callOutcome: real_conversation
hadRealConversation: true
callType: квалификация_лида (или upsell — по контексту)
outcome: scheduled_callback
scriptScore: 1-2
criticalErrors: []                 # за 30 сек ничего не должна была сделать
summary: "Клиент попросил перезвонить позже. Без выявления потребностей."
ropInsight: "Норма для cold-calling. Проверить выполнен ли follow-up в назначенное время."
extractedCommitments: [{speaker: МЕНЕДЖЕР, action: callback, deadline: ...}]
tags: [перенос, короткий_звонок]
```

### Правило различения

| Признак | Тип |
|---|---|
| transcript ≤ 100 chars (любое содержимое — placeholder / Whisper-галлюцинация типа "Ого!" / "Продолжение следует..." / шум) | A: NO_SPEECH |
| только МОП реплики, voicemail-фразы | B: VOICEMAIL/IVR |
| < 30 сек, "Алло" сбросил | C: HUNG_UP |
| повторяющиеся "Алло, слышите?" | D: TECHNICAL |
| 30-60 сек, "перезвоните" | E: SHORT_RESCHEDULE |
| ≥ 60 сек, диалог с темами | F: NORMAL → полный 6-блочный enrich |

**Skill сам определяет тип ПЕРЕД enrich** через быстрый анализ длины transcript и ключевых маркеров. Edge-case = быстрая обработка (5-10 секунд), нет смысла думать 30 секунд над пустым звонком.

---

## Важные правила

1. **Дочитывай канон каждый раз** — `feedback-master-enrich-canon.md` определяет все 6 блоков. Не пропускай поля даже если данных нет (null).
2. **Используй per-tenant анкету** — критические ошибки и категории звонков могут отличаться для разных клиентов.
3. **Не суммаризируй** — cleanedTranscript должен быть полным, summary только в отдельном поле.
4. **Не галлюцинируй** — если в transcript нет данных для поля → null. НЕ додумывай.
5. **Cost gate:** для текущих 5 клиентов работаешь через подписку. Если объёмы > 1000/день per tenant — попроси user запустить через API.

## Интеграция с другими канонами

- Schema: `feedback-master-enrich-canon.md`
- Pipeline upstream: `feedback-pipeline-v213-final-settings.md`
- Pipeline canon: `feedback-pipeline-canon-with-opus-enrich.md`
- Flow: `feedback-onboarding-and-daily-enrich-flow.md`
- View layer: `feedback-rop-dashboard-minimum.md` (Канон #37)
- Образец: `/Users/kirillmalahov/smart-analyze/docs/canons/master-enrich-samples/sample-1-soft-seller-no-offer.md`
