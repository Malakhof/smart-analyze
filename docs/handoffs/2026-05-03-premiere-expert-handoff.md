# 🎯 Premiere Expert Handoff — 2026-05-03

**Для:** новой Claude сессии, которая будет работать с проектом до и после премьеры **4.05.2026**.
**От:** координирующей сессии (cron/worker pipeline) + parallel session UI + parallel session skill v10.
**Self-contained:** этот документ + указанные файлы — всё что нужно. Не пытайся искать context в предыдущих conversations.

---

## TL;DR (read first)

Премьера завтра, **4.05.2026 днём**. Pipeline (PBX → Whisper → DeepSeek → CallRecord) **live и стабилен** после 5 fix'ов сегодня. UI готов на 4/8 этапов (premiere-ready для GETCOURSE). Skill v10 **НЕ начат** — заморожен на v9.5/v9.6 за pivot на UI-driven contract. Эталоны: 2/7 категорий звонков (только NORMAL).

**Mission expert'а — 2 фазы:**

- **Phase 1 (до премьеры, 24 часа):** review всех 5 сегодняшних commits на code quality, опционально создать demo content (100-200 свежих enriched cards) для премьеры, проверить UI работает с реальными enriched cards.
- **Phase 2 (после премьеры):** довести skill v10 + дописать 5 недостающих эталонов (категории A/B/C/D/E/G) + закрыть 5 open issues из watch period + финализировать Master Enrich канон.

---

## 🚧 Self-contained guarantee

Этот документ ссылается **только** на файлы в репозитории и memory. Всё что нужно знать — внутри. Не предполагаются:

- Доступ к head'у предыдущих сессий (`.jsonl` files)
- Pre-existing context из conversation summaries
- Информация которую только user знает

Если что-то непонятно — **спроси user'а явно**, не придумывай.

---

## 📅 Premiere context (4.05.2026)

| Параметр | Значение |
|---|---|
| Дата | 2026-05-04 (завтра) |
| Tenant | `diva-school` (subdomain `web.diva.school`, GetCourse-based education) |
| Что показываем | Live UI dashboard с enriched call cards, метрики РОПа, demo flow звонков "до/после" обогащения |
| Production URL | dev.smart-analyze.ru (или см. `docs/canons/ui-inventory-2026-05-03.md` раздел "Demo URLs") |
| Готовность инфры | Pipeline live (5 commits 2.05–3.05), UI Stages 0-4 ready, drain 108 pending → 0 в течение часа |

**До премьеры остаётся:** ~24 часа.

---

## 📊 Repo state — 3 streams

### Stream 1: Cron + Worker pipeline (✅ live)

**Сегодня (3.05) исправлено 4 критических бага** + 1 commit data-fix (5 commits итого):

| Commit | Что |
|---|---|
| `bd2e9f6` | Shell wrapper `sh -c 'cmd' arg1` дропал args → producer cron 6h45m mute. Fix: `sh -c 'cmd "$@"' --` |
| `357b163` | Worker брал onPBX creds из пустого `process.env` → silent fail. Fix: `OnPbxAdapter.getCreds()` |
| `81e6146` | New script `backfill-audiourl-from-pbx.ts` — backfill 131 row с NULL audioUrl через onPBX API |
| `5e18bea` | Diagnostic handoff `docs/handoffs/2026-05-03-pipeline-watch-findings.md` |
| `e63464b` | Balance probe (DeepSeek + Intelion) + Telegram dedup + daily summary integration |

Plus **data fix:** 230 broken transcribed legacy rows (pbxUuid='') → archived в `_legacy_broken_transcribed`, marked `failed`.

**Pipeline state right now:**
- Producer cron `*/15`: 50+ green ticks подряд после wrapper fix
- Worker daemon: active, claim → Whisper → persist цикл работает
- 1-й successful Whisper batch после fix: 2026-05-03 10:36 UTC
- GpuRun started 10:29 UTC, processing
- Drain до 0 pending: ~30 мин (4-5 batches × 30 calls)

**5 open issues для review:** см. `docs/handoffs/2026-05-03-pipeline-watch-findings.md` раздел `## Open`.

### Stream 2: UI editor (✅ partial, premiere-ready)

**Готово (Stages 0-4):**
- Manager cards (карточки МОПов)
- Client cards (карточки клиентов)
- Call list page
- Call card details

**Откачено (Stage 5):** Quality Control / `/quality` dashboard — был too rich, нужен simpler design. См. last revert commits `9679085` + `67f17b9`.

**Backlog (Stages 6-8):** Settings, и т.д.

**Известный bug:** `keyClientPhrases` рендерится как JSON string (5 мин fix, frontend).

**Артефакты UI session save (commit `ca478d4`):**
- `docs/canons/ui-inventory-2026-05-03.md` — stack, routes, queries, 7 типов рендера, demo URLs, anti-patterns
- `docs/canons/ui-enrichment-contract.md` — data contract UI ↔ Master Enrich (per-field semantics, fallback chains, mixed formats, gotchas)
- Memory: `project-ui-state-2026-05-03.md` (snapshot) + `project-ui-rebuild-progress.md` (Этапы 0-4 done, 5 reverted, 6-8 pending)

### Stream 3: Skill enrichment v10 (⏳ NOT started)

**Заморожен на v9.5/v9.6** в соответствии с pivot-планом 30.04 (`docs/handoffs/2026-04-30-evening-pivot-ui-driven-contract.md`).

**Why pivot:** v9.3 → v9.4 → v9.5 → v9.6 цикл показал что текстовые assertions Opus игнорирует (compression bug в sample-1/sample-2). Решение: UI-driven contract сначала, skill после.

**Эталоны:** 2/7 категорий покрыто (только F: NORMAL ≥60s).
- ✅ `sample-3-proper-cleanup-lara.md` — closed_lost, empathic_seller, hypothyroidism context
- ✅ `sample-4-strong-closer-tech-block.md` — strong_closer, objection_unresolved, Kyrgyzstan context
- ❌ A: NO_SPEECH (тишина) — НЕТ эталона
- ❌ B: VOICEMAIL/IVR — НЕТ
- ❌ C: HUNG_UP/no_answer — НЕТ
- ❌ D: TECHNICAL (тех-проблема) — НЕТ
- ❌ E: SHORT_RESCHEDULE (перенос) — НЕТ (priority!)
- ❌ G: PIPELINE_GAP — НЕТ (новая категория)

**Артефакты skill session save (commits `0af394f` + `4b2f7a3`):**
- `docs/handoffs/2026-05-03-skill-v10-progress.md` — status (НЕ начат), roadmap, реалистичный таймлайн 2-3 дня
- `docs/canons/master-enrich-samples/CATALOG.md` — что есть/нет среди эталонов
- `docs/canons/master-enrich-samples/CATEGORIES.md` — 7 категорий A-G + decision tree + статистика
- `docs/canons/master-enrich-samples/EDGE-CASES.md` — runtime spec + per-category Python validators (для `validate-enrich-sql.ts`)
- Memory: `feedback-skill-v10-design.md` (lessons)

**Текущий v9.6 SKILL.md:** `~/.claude/skills/enrich-calls/SKILL.md` (≈800 строк). Edge-cases section lines 670-790 — основа для CATEGORIES.md.

---

## 📚 MUST READ FIRST (mandatory order)

Для общей картины **перед любым кодом**:

1. **Этот файл** (ты его уже читаешь)
2. `~/.claude/projects/-Users-kirillmalahov-smart-analyze/memory/MEMORY.md` — индекс всей "общей памяти" проекта
3. `docs/handoffs/2026-05-03-pipeline-watch-findings.md` — 4 bugs resolved сегодня + 5 open issues
4. `docs/canons/ui-inventory-2026-05-03.md` — что в UI, какие страницы, demo URLs
5. `docs/canons/ui-enrichment-contract.md` — data contract UI ↔ enrichment
6. `docs/canons/master-enrich-samples/CATEGORIES.md` — 7 типов звонков
7. `docs/canons/master-enrich-samples/EDGE-CASES.md` — runtime validators
8. `docs/handoffs/2026-05-03-skill-v10-progress.md` — что нужно сделать в v10

**После 8 файлов выше** ты будешь иметь полный context. Дальше — references по нужде.

---

## 📖 References (read as needed)

**Foundational handoffs:**
- `docs/handoffs/2026-04-28-cron-realtime-pipeline-handoff.md` — 786-строчный foundational doc по pipeline architecture (11 stages + safety canons)
- `docs/handoffs/2026-04-30-evening-pivot-ui-driven-contract.md` — pivot план на 7 дней (skill v9.6 freeze + UI-driven approach)
- `docs/handoffs/2026-04-30-known-bugs-and-fixes.md` — 6 known bugs с корнями + лечением
- `docs/handoffs/2026-04-30-skill-v96-quality-uplift-combo.md` — v9.6 (заморожен) + risk review appendix

**Эталоны:**
- `docs/canons/master-enrich-samples/sample-3-proper-cleanup-lara.md` — НОРМАЛЬНЫЙ диалог (closed_lost)
- `docs/canons/master-enrich-samples/sample-4-strong-closer-tech-block.md` — НОРМАЛЬНЫЙ диалог (strong_closer)
- `docs/canons/master-enrich-samples/CATALOG.md` — индекс всех эталонов
- `docs/canons/master-enrich-samples/archive_v8_with_compression_bug/` — **НЕ ИСПОЛЬЗОВАТЬ** (compression bug)

**Каноны системы (37+):**
- `docs/canons/canon-37-rop-dashboard-minimum.md` — что РОП должен видеть
- `docs/canons/canon-master-enrich-card.md` — schema 6 блоков + Block 7 commitments + 12 phraseCompliance
- `docs/canons/canon-call-record-states.md` — state machine `transcriptionStatus`
- `docs/canons/canon-38-reconciliation-in-cron.md` — Stage 9 reconcile логика
- `docs/canons/cron-safety-canons/` — 6 canons: lockfile, disk-cleanup, gpu-cost-cap, whisper-resume, gc-cookie-auto-refresh, daily-health-check
- `docs/canons/skill-enrich-calls.md` — skill canon (старая версия, может быть устаревший)

**Memory critical:**
- `feedback-skill-iteration-pivot.md` — главный урок: **НЕ патчить SKILL.md без UI-contract**
- `feedback-master-enrich-canon.md` (если существует) — schema 6 блоков
- `reference-prod-ssh.md` — `root@80.76.60.130 via ~/.ssh/timeweb`, `/root/smart-analyze`
- `reference-credentials-cron.md` — где живут creds (Intelion / onPBX / GC)
- `feedback-pipeline-producer-consumer-split.md` — producer cron vs worker daemon
- `feedback-pipeline-shellout-contract.md` — wrapper bug что мы починили сегодня

**Current SKILL.md:** `~/.claude/skills/enrich-calls/SKILL.md` (v9.6, заморожен).

---

## 🎯 Mission scope

### Phase 1: Pre-premiere (NOW — 4.05 днём)

**Приоритет 1 — Code review 5 commits сегодня:**

```
4b2f7a3 docs(skill-v10): обновил status — pre-flight #1 и #5 от UI-сессии
0af394f docs(skill-v10): pre-handoff save — progress + 7 категорий + edge-cases + catalog
ca478d4 docs(canons): UI pre-handoff snapshot — inventory + enrichment contract
e63464b feat(alerts): API balance probe + Telegram dedup + daily summary integration
5e18bea docs(handoffs): 2026-05-03 watch findings — 4 bugs resolved + 4 open
81e6146 feat(scripts): backfill audioUrl from onPBX API for legacy NULL rows
357b163 fix(worker): pull onPBX creds from tenant.adapter, not process.env
bd2e9f6 fix(cron): pass args through sh -c wrapper via "$@"
```

Что проверить:
- Соответствие плану в `2026-04-28-cron-realtime-pipeline-handoff.md`
- Coding standards (CLAUDE.md → AGENTS.md правила Next.js)
- Security (нет hardcoded secrets — был commit `9f3d064` который чистил их)
- Edge cases которые могли пропустить
- 5 open issues из watch findings — приоритезировать

**Приоритет 2 — Demo content для премьеры:**

После того как pipeline drain'ит pending до 0 (≈11:30 UTC сегодня):
- Запустить `/enrich-calls --tenant=diva-school --limit=200` на самые свежие звонки (по `startStamp DESC`)
- Это создаст 100-200 enriched cards для демо
- Manual review 5-10 random cards на качество (открыть в UI или прочитать БД record'ы)

**Приоритет 3 — UI smoke test с реальными cards:**
- Открыть premiere URL'ы из `docs/canons/ui-inventory-2026-05-03.md`
- Проверить что enriched cards отображаются корректно
- Если bug `keyClientPhrases` JSON string ещё не fixed — починить (5 мин)

**Приоритет 4 — Reviewer 4.05 утром (~04:00 UTC = 07:00 МСК):**
- ping #2 daily-health-check должен пройти green
- Если green → формальный code review всех 5 commits + 5 open issues
- Если red → разобрать причину ДО премьеры

### Phase 2: Post-premiere (5.05+)

**В порядке приоритета:**

1. **Закрыть 5 open issues** из `docs/handoffs/2026-05-03-pipeline-watch-findings.md`:
   - Stage 7.5b regression root cause (cookie age 308h на 2.05 — почему refresh не сработал?)
   - `claimPersistOnlyBatch` без `pbxUuid IS NOT NULL AND != ''` filter
   - Silent-exit detector для cron tsx wrappers (mtime-of-log alert в health-check)
   - `transcriptionError` column в CallRecord (сейчас reason живёт только в archive table comment)

2. **Создать 5 недостающих эталонов:** A, B, C, D, E priority + опционально G
   - См. `docs/canons/master-enrich-samples/EDGE-CASES.md` для structure
   - Каждый: 1 sample транскрипт + правильно заполненная enriched card + объяснение почему
   - Сохранить в `docs/canons/master-enrich-samples/sample-{A,B,C,D,E,G}-*.md`

3. **Skill v10:** переписать SKILL.md под `ui-enrichment-contract.md` + per-category из `EDGE-CASES.md`
   - Не текстовые assertions, а runtime validator (`scripts/validate-enrich-sql.ts`)
   - Тест 10 свежих → backfill `--limit=10` в одном окне

4. **UI Stage 5 redesign:** Quality Control dashboard simpler version

5. **UI Stages 6-8:** Settings + остальное

6. **Финализация Master Enrich канона** — последняя очередь, после стабилизации flow

---

## 🛑 What NOT to do

1. **НЕ применяй v9.6 пока pre-flight не закрыт.** Reread `feedback-skill-iteration-pivot.md` — стоило 5 ч лимитов 30.04.
2. **НЕ запускай `/loop /enrich-calls` без подготовки** — это пожгёт DeepSeek balance ($14/день baseline) + Opus subscription rate limits. Только manual `--limit=200` после drain'а.
3. **НЕ патчь cron pipeline scripts на горячую** — изменения требуют SCP + worker restart. См. `feedback-cron-pipeline-shellout-contract.md`.
4. **НЕ трогай прод базу через `docker exec smart-analyze-db psql` без явного user'ского OK** — каждое UPDATE/DELETE может cascadить.
5. **НЕ переписывай Master Enrich канон** до стабилизации flow (это последняя очередь — после премьеры + после стабильного skill v10 + после 7 эталонов).
6. **НЕ удаляй worker filter `audioUrl IS NOT NULL`** — это legitimate guard, регрессия Stage 7.5b backfill'нута через одноразовый script `backfill-audiourl-from-pbx.ts`.
7. **НЕ ставь sample-1 / sample-2 как образец.** Они в archive (compression bug). Используй только sample-3 / sample-4.
8. **НЕ пиши новые memory или canon файлы без явной нужды** — их уже 37+, добавляй только когда есть конкретный урок которого нет в существующих.
9. **НЕ ТРОГАЙ 3 GC deep-link'а** в `src/app/(dashboard)/_components/gc/call-card.tsx:160-168` (`gcCallId` / `gcContactId` / `Deal.crmId` через JOIN). Они работают корректно. Любой редизайн header'а карточки звонка — verify deep-link'и до commit'а. Whitelist в `src/lib/crm/getcourse/urls.ts`. Подробности: `~/.claude/projects/-Users-kirillmalahov-smart-analyze/memory/feedback-gc-deeplinks-invariant.md`.
10. **НЕ ЧИНИ cron Stage 7.5b** — он функционален. Реальное покрытие 1330/5324 (25%) dealId с 24.04, 493 distinct deals. 75% NULL = норма для cold-prospecting (сделка создаётся позже первого контакта), НЕ bug. Старая memory "1 distinct deal per 5038" устарела.

---

## 🔑 Production endpoints / credentials

**SSH:** `ssh -i ~/.ssh/timeweb root@80.76.60.130` → `/root/smart-analyze`
**DB:** `docker exec smart-analyze-db psql -U smartanalyze -d smartanalyze`
**Tenant ID diva:** найти через `SELECT id FROM "Tenant" WHERE name LIKE 'diva%' LIMIT 1;`

**Creds (per-tenant):**
- Intelion API token, onPBX KEY_ID/KEY (TTL 7-9d, auto-refresh) — в `Tenant.pbxConfig` (encrypted, decrypted via `loadOnPbxAuth`)
- GC cookie (PHPSESSID5) — auto-refresh каждые 6h (см. `canon-gc-cookie-auto-refresh.md`)
- DeepSeek API key, Telegram bot token — в `.env` на prod (НЕ в git)

**Кill switches:**
- `touch /tmp/disable-cron-pipeline` → producer cron exit 0
- `systemctl stop whisper-worker@diva-school` → worker graceful stop

См. полный список в `reference-credentials-cron.md` (memory).

---

## ✅ Done criteria

**Phase 1 (до премьеры):**
- [ ] Code review 5 commits + 5 open issues приоритизированы
- [ ] 100-200 свежих enriched cards в БД (`processed` count grew by ~150-200)
- [ ] UI smoke test passed на premiere URL'ах
- [ ] `keyClientPhrases` JSON bug fixed (если ещё актуален)
- [ ] Reviewer 4.05 утром: ping #2 green

**Phase 2 (после премьеры):**
- [ ] 5 open issues from watch period — fixed
- [ ] 5 эталонов недостающих категорий (A/B/C/D/E + опц. G) — written
- [ ] Skill v10 + validator — operational, тест 10 свежих passed
- [ ] UI Stage 5 redesigned + Stages 6-8 done
- [ ] Master Enrich канон — финализирован

---

## 🚀 Agent invocation prompt (для new session)

Пользователь должен открыть **новую** Claude Code сессию в `/Users/kirillmalahov/smart-analyze` и paste'ить:

```
Прочитай файл `docs/handoffs/2026-05-03-premiere-expert-handoff.md` целиком.
Это твой установочный handoff.

После того как прочитаешь — пройдись по разделу "MUST READ FIRST" по порядку
(8 файлов). После 8-го файла подытожь в 5 предложений:
1. Что делает pipeline сейчас
2. Что готово в UI
3. Что в skill v10 (статус)
4. Какие 5 open issues
5. Какой next step ты предлагаешь начать (Phase 1 или Phase 2 priority?)

Не пиши код пока я не одобрю предложенный next step.
Сегодня дата 2026-05-03, премьера 2026-05-04.
Production prod: root@80.76.60.130 via ~/.ssh/timeweb.
```

После того как expert ответит — user одобряет план или корректирует. Дальше expert работает по фазам.

---

## 🔄 Status check (2026-05-03 11:00 UTC)

**Pipeline:**
- Producer cron: green (50+ ticks)
- Worker daemon: active, 1-й successful Whisper batch 10:36 UTC
- Drain: 108 pending → 0 в течение 30 мин
- Reviewer 4.05 04:00 UTC ping #2 — pending

**Saves done сегодня:**
- ✅ Cron/worker (наша сессия): 5 commits + handoff `2026-05-03-pipeline-watch-findings.md`
- ✅ UI session: 4 артефакта + memory pointers (commit `ca478d4`)
- ✅ Skill session: 4 артефакта + memory `feedback-skill-v10-design.md` (commits `0af394f` + `4b2f7a3`)
- ✅ Этот handoff (composing session)

**Что осталось до открытия новой сессии:**
- User должен paste'ить Agent invocation prompt в новую Claude Code session
- Expert прочитает 8 must-read файлов
- Expert предложит next step
- User одобрит → expert работает

**Premiere завтра. Pipeline live. Ready.**
