# 📊 Skill v10 Progress (3.05.2026)

**Status: НЕ НАЧАТ.** Skill заморожен на v9.5 с 30.04 в соответствии с pivot-планом (`2026-04-30-evening-pivot-ui-driven-contract.md`).

---

## TL;DR

| Aspect | State |
|---|---|
| Текущая версия в продакшн | `claude-opus-4-7-v9.5` (с 30.04, 24-26% partial rate) |
| v9.6 handoff (E+D+A+B fixes) | 🛑 ЗАМОРОЖЕН (пред-применение признано преждевременным) |
| v10 design | 📋 Roadmap есть, реализация — НЕ начата |
| Blocking dependency | UI-driven enrichment contract — НЕ создан |
| Эталонов в наличии | **2** (sample-3, sample-4) — оба категория **F (NORMAL)** |
| Эталонов отсутствует | **5+** (категории A, B, C, D, E, G — никаких эталонов) |
| Что сделано после v9.6 freeze | **Ничего по skill** — все ресурсы 1-3.05 ушли на cron/pipeline стабилизацию |

---

## 🛑 Что было сделано после freeze v9.6 (30.04 вечер → 3.05)

**По skill: ноль работы.** Pivot-план соблюдён.

**По cron/pipeline (другие сессии 1-3.05):**
- whisper-worker daemon + state machine canon (`55e3e22`)
- GC cookie hourly probe + new GC UI login fix (`2c32547`)
- canon-#8 filter + saturation cap + onPBX auto-refresh (`0caa45c`)
- Telegram alerts integration (`2f249b9`, `4825206`, `e63464b`)
- Hardcoded secrets cleanup (`9f3d064`)
- onPBX KEY rotation feedback (memory `feedback-onpbx-key-rotation.md`)
- Producer/consumer split понимание ($14/день DeepSeek burn — memory `feedback-pipeline-producer-consumer-split.md`)
- 3.05 watch findings (`5e18bea`) — 4 bugs resolved + 4 open

Skill вопрос остался ровно где был 30.04: **заморожен, ожидает UI-contract.**

---

## 📐 Design decisions (что было решено)

### 1. Skill assertions = текст в промпте, не runtime block

Все итерации v9.3 → v9.4 → v9.5 → v9.6 пытались усиливать **текстовые** assertions в SKILL.md:
```python
assert compression >= 0.85, "..."
assert len(missed) >= 4, "..."
```

**Opus их игнорирует** когда контекст устаёт в batch. 24-64% partial rate — стабильный результат. v9.6 (E+D+A+B) пытался добавить runtime валидатор `validate-enrich-sql.ts` — но без UI-contract нельзя точно описать what to validate (по категориям звонка разные требования).

**Решение для v10:** runtime validator обязателен (не optional self-review), но shape проверки приходят из UI-contract, не из домыслов.

### 2. UI-driven enrichment contract — корневой блокер

Skill оптимизировался без понимания что UI реально использует. Поля типа `purchaseProbability`, `phraseCompliance` — может рендерятся, может нет, может для одних типов звонка нужны, для других нет.

**Решение для v10:** контракт `docs/canons/canon-ui-enrichment-contract.md` (НЕ создан) описывает:
- На какой странице UI какие поля нужны
- Per category (A-G) какие обязательны / опциональны / запрещены
- Минимальный shape поля (например `psychTriggers.missed[].quote_client + .should_have_said`)

Skill v10 ссылается на контракт в STEP 0. Validator проверяет соответствие контракту перед записью.

### 3. Per-category эталоны — обязательны до v10

Сейчас 2 эталона, оба NORMAL. Opus импровизирует на A/B/C/D/E/G → партиал.

**Решение для v10:** до начала переписывания skill — собрать **по 1 эталону на каждую из 7 категорий** (см. `CATALOG.md` и `CATEGORIES.md`).

### 4. Backfill стратегия после v10

- Прежде всего: тест на **10 свежих звонках разных категорий** (через cron auto-update, не historical).
- При 9-10 / 10 эталон: запускать backfill в **одном окне `--limit=10`** (не 5 параллельных).
- Через сутки если стабильно: --limit=20. Через 3 дня: --limit=40. Параллелить только при подтверждённой стабильности.

### 5. v9.6 fixes к интеграции в v10

В `2026-04-30-skill-v96-quality-uplift-combo.md` лежат полезные элементы которые надо подхватить в v10 (с поправками из risk review):

| Опция | Лекарство | Включить в v10 |
|---|---|---|
| **B (validator)** | `validate-enrich-sql.ts` runtime блок | ✅ обязательно, до `psql -f`, не post-hoc |
| **D (auto-detect partial)** | SQL фильтр для needs_rerun | ✅ но per-category условия (см. контракт) |
| **A (self-review)** | Skill перечитывает свой SQL | ⚠️ опционально, дополнение к B (echo chamber risk) |
| **E (--limit=5 default)** | Меньшие batch'и | ✅ ещё меньше → --limit=10 после v10 |

---

## 📋 Что осталось делать (roadmap для нового expert'а)

### Pre-flight (что должно быть готово ДО skill v10)

| # | Артефакт | Файл | Status |
|---|---|---|---|
| 1 | UI inventory (что криво/не хватает на каждой странице) | `docs/canons/canon-ui-pages-current-state.md` | НЕ начат |
| 2 | Эталоны 7 категорий звонка (по 1 на каждую) | `docs/canons/master-enrich-samples/sample-{A,B,C,D,E,F,G}-*.md` | 2 из 7 (только F) |
| 3 | Эталон карточки МОПа (агрегация) | `docs/canons/canon-manager-card.md` | НЕ создан |
| 4 | Эталон карточки клиента (timeline касаний) | `docs/canons/canon-client-card.md` | НЕ создан |
| 5 | UI-enrichment contract (страница ↔ обязательные поля per category) | `docs/canons/canon-ui-enrichment-contract.md` | НЕ создан |

### Skill v10 (после pre-flight)

| # | Шаг | Эстимат |
|---|---|---|
| 1 | Переписать SKILL.md per-category sections (с явным per-category обязательным набором полей) | 2-3 ч |
| 2 | Написать `scripts/validate-enrich-sql.ts` (runtime блок, regex shape проверки) | 1-2 ч |
| 3 | Интегрировать validator в skill flow (между gen и `psql -f`) | 30 мин |
| 4 | Тест на 10 свежих разных категорий | 30 мин |
| 5 | Если ≥9/10 эталон → разрешить backfill `--limit=10` | — |

### Backfill (после прохождения теста)

| Очередь | Кол-во | Заметка |
|---|---|---|
| 24-27.04 partial v9.3 | ~143 | over-compressed cleanedTranscript |
| 24-27.04 partial v9.5 | ~55 | те же compression проблемы |
| 28.04 partial v9.5 | ~34 | те же |
| 29.04 первый Master Enrich | ~187 | cron сделал только Whisper+score |
| 30.04 первый Master Enrich | ~49 | те же |
| 1-3.05 первый Master Enrich | ? | проверить через `5e18bea` watch findings |

**ИТОГО:** ~470 + новые с 1-3.05 = **~600+ обогащений ждут v10**.

---

## 🐛 Связанные баги (полная карта в `2026-04-30-known-bugs-and-fixes.md`)

| # | Баг | Лечится в v10 как |
|---|---|---|
| 1 | v9.3 over-compressed cleanedTranscript | Validator блокирует compression < 0.85 (для NORMAL/SHORT) |
| 2 | UI keyClientPhrases как JSON-строка | UI fix отдельно от skill |
| 3 | psychTriggers.missed без quote_client/should_have_said | Validator проверяет shape `missed[*]` |
| 4 | phraseCompliance "missed —" без evidence | Validator + per-category requirement |
| 5 | DeepSeek scriptScore дублирует Opus scriptDetails | Архитектурный — после демо |
| 6 | persist-pipeline exit≠0 при успешной записи | Cron fix, не skill |

---

## 🔗 Связанные документы

- `docs/handoffs/2026-04-30-evening-pivot-ui-driven-contract.md` — master pivot план
- `docs/handoffs/2026-04-30-known-bugs-and-fixes.md` — 6 багов с корнями
- `docs/handoffs/2026-04-30-skill-v96-quality-uplift-combo.md` — заморожен, элементы для v10
- `docs/canons/master-enrich-samples/CATALOG.md` — каталог эталонов (что есть/нет)
- `docs/canons/master-enrich-samples/CATEGORIES.md` — 7 категорий с правилами различения
- `docs/canons/master-enrich-samples/EDGE-CASES.md` — decision tree обработки
- `~/.claude/.../memory/feedback-skill-iteration-pivot.md` — урок: не патчить skill без UI-contract
- `~/.claude/.../memory/feedback-skill-v10-design.md` — design lessons (этот save)

---

## 🚦 Для нового expert'а

**Не начинай skill v10 пока pre-flight артефакты #1-#5 не готовы.** Любая попытка переписать SKILL.md без UI-contract повторит цикл v9.3 → v9.4 → v9.5 → v9.6.

Порядок:
1. Inventory UI (день 1 утро) — пользователь говорит, ты записываешь
2. Эталоны 5 недостающих категорий (день 1 день) — собрать примеры из БД, подписать как должны выглядеть
3. UI-enrichment contract (день 1 вечер) — связь страница ↔ обязательные поля
4. Skill v10 (день 2) — переписать SKILL.md под контракт
5. Validator (день 2) — runtime блок
6. Тест 10 свежих (день 2 вечер)
7. Backfill (день 3+)

Реалистичный таймлайн: **3-5 дней до стабильного автоматического enrichment.**
