# 🔄 Pivot: UI-driven Enrichment Contract (30.04.2026 вечер)

**Это master-документ для следующей сессии.** Контекст одного дня (5+ часов) на одних и тех же звонках в попытках починить skill через v9.6 — приведено к решению **сменить порядок работы**.

---

## 🎯 TL;DR

**Стоп оптимизации skill в вакууме.** Сначала UI → контракт → skill v10. Не наоборот.

**Замороженно сегодня вечером:**
- ❌ v9.6 handoff (E+D+A+B) — НЕ применять. Лежит в `docs/handoffs/2026-04-30-skill-v96-quality-uplift-combo.md` для справки.
- ❌ Все /loop /enrich-calls сессии закрыты.
- ❌ SQL UPDATE расширенного `needs_rerun_v9` — не запускать.
- ❌ Никаких новых enrichments до v10.

**Продолжается:**
- ✅ UI-сессия: Этап 5 (Контроль качества /quality). Этап 6 в backlog.
- ✅ Cron-сессия: smoke test → crontab install (только Whisper+DeepSeek, без Opus Master Enrich).
- ✅ Backfill 28-29-30 transcripts/scriptScore через cron — пусть едет.

---

## 📊 Состояние БД на 30.04 21:00 МСК

**Diva (24-30.04, 3684 carteчек всего):**

| День | Total | Эталон | Партиал | В очереди | Ждут 1-й Master Enrich | Без аудио (pipeline_gap) |
|---|---|---|---|---|---|---|
| 24-27 | 857 | 421 | 4 | 154 | 0 | 45 + остальное edge |
| 28 | 1316 | 48 | 34 | 0 | 100 | 1133 |
| 29 | 1205 | 0 | 0 | 0 | 187 | 1018 |
| 30 | 306 | 0 | 0 | 0 | 49 | 257 |

**По версиям (только real_conversation, transcript >100):**

| Версия | Total | <50% severe compress | <85% below canon |
|---|---|---|---|
| v9 | 142 | 1 | 2 ✅ |
| v9-loop | 7 | 0 | 0 |
| **v9.3** | **184** | **86** | **143** 🔴 |
| **v9.5** | **138** | **14** | **89** ⚠️ |
| v9.5-canonical | 1 | 0 | 1 |

**Реально кривых сейчас в БД:** ~232 carteчек (143 v9.3 + 55 v9.5 24-27 + 34 v9.5 28).

---

## 🐛 Все баги найденные сегодня (детали в `2026-04-30-known-bugs-and-fixes.md`)

| # | Баг | Класс | Где лечить |
|---|---|---|---|
| 1 | v9.3 over-compressed cleanedTranscript | Data | skill v10 + рескор |
| 2 | UI keyClientPhrases рендерится как JSON-строка | UI | UI-сессия 5 минут |
| 3 | psychTriggers.missed без quote_client/should_have_said | Data | skill v10 |
| 4 | phraseCompliance "missed —" без evidence | Data | skill v10 |
| 5 | DeepSeek scriptScore дублирует Opus scriptDetails | Архитектура | После демо, не блокер |
| 6 | persist-pipeline exit≠0 при успешной записи | Cron | Backlog после crontab |

---

## 🚫 Что НЕ работает в текущем подходе (корень)

**Skill assertions в SKILL.md = текст в промпте, НЕ runtime block.** Opus читает «assert compression >= 0.85» и игнорирует когда контекст устаёт в batch. Все итерации v9.X (3-4-5) пытались усилить текстовые правила — не работало.

**Skill оптимизировался в вакууме** — без понимания какие поля реально нужны UI, какие декорация. Opus генерирует «на всякий случай» → 24-26% partial rate.

**Эталоны (sample-3 Лариса + sample-4 Эльнура) покрывают только NORMAL.** 5 других категорий звонков (SHORT, VOICEMAIL, NO_SPEECH, HUNG_UP, TECHNICAL_ISSUE) без эталона → Opus импровизирует.

---

## 🗺️ Новый план (UI-driven enrichment contract)

### Сегодня вечером (что сделано/делается прямо сейчас)
- ✅ Зафиксированы все баги в `docs/handoffs/2026-04-30-known-bugs-and-fixes.md`
- ✅ v9.6 handoff заморожен в `docs/handoffs/2026-04-30-skill-v96-quality-uplift-combo.md` (для справки)
- ✅ Этот pivot-документ создан
- ⏳ UI-сессия катит Этап 5 /quality
- ⏳ Cron-сессия → smoke test → crontab install

### День 1 (завтра утро 1-2 ч)
**Inventory всех страниц UI платформы.** Пользователь по каждой странице пишет:
- Что есть и работает
- Что криво (баги UI которые видны)
- Чего не хватает до идеала
- Что показывается, но не нужно

Список страниц:
- `/` Главная (дашборд РОПа)
- `/managers` Список МОПов
- `/managers/[id]` Карточка МОПа
- `/managers/[id]/clients/[gcContactId]` Карточка клиента (Этап 4 готов)
- `/calls` Список звонков
- `/calls/[pbxUuid]` Карточка звонка
- `/quality` Контроль качества (Этап 5 в работе)
- `/settings` Настройки (Этап 6 в backlog)

**Результат:** документ `docs/canons/canon-ui-pages-current-state.md` с правкой по каждой странице.

### День 1 (день 2-3 ч)
**Эталоны страниц + эталоны карточек по 7 категориям звонка.**

Категории звонка (из памяти `feedback-pipeline-canon-with-opus-enrich.md`):
- A. NORMAL real_conversation ≥60s
- B. SHORT_RESCHEDULE <60s
- C. VOICEMAIL/IVR
- D. NO_SPEECH
- E. HUNG_UP/NO_ANSWER
- F. TECHNICAL_ISSUE
- G. PIPELINE_GAP

Для каждой категории:
- Что показывается в карточке звонка (какие блоки рендерятся, какие скрыты)
- Какие поля jsonb обязательны
- Какие необязательны
- Mock или ссылка на эталонную карточку в БД

Для агрегатных страниц:
- Карточка МОПа: какие агрегаты по 50+ звонкам, как формируются
- Карточка клиента: timeline касаний, этапы сделки
- Дашборд РОПа: 6 счётчиков, паттерны, heatmap

**Результат:** новые файлы в `docs/canons/`:
- `canon-call-card-by-type-A-normal.md`
- `canon-call-card-by-type-B-short.md`
- ... C, D, E, F, G
- `canon-manager-card.md`
- `canon-client-card.md`
- `canon-rop-dashboard.md`

### День 1 (вечер 1 ч)
**UI-enrichment contract** — связь страница ↔ обязательные поля jsonb.

Файл `docs/canons/canon-ui-enrichment-contract.md`:
```
Страница: /calls/[pbxUuid]
Категория: NORMAL ≥60s
Обязательные поля jsonb:
  - cleanedTranscript (compression >= 0.85)
  - psychTriggers.positive[].time/technique/effect
  - psychTriggers.missed[].time/quote_client/should_have_said
  - phraseCompliance — все 12 техник с used + evidence/missed
  - scriptDetails — все 11 этапов с score/comment/na
  - ropInsight — минимум 5 пунктов
  - extractedCommitments[].speaker/quote/action/deadline
  - nextStepRecommendation — 4 шага с эмодзи
  - keyClientPhrases[].time/quote/note
  - clientReaction, managerStyle, clientEmotionPeaks
  - purchaseProbability (если NORMAL)
Опциональные:
  - criticalDialogMoments
  - enrichedTags
  
Категория: SHORT_RESCHEDULE <60s
Обязательные:
  - cleanedTranscript (compression >= 0.85)
  - scriptDetails — все 11 этапов
  - extractedCommitments (если есть обещания)
  - nextStepRecommendation — 1-2 шага
Опциональные (na для SHORT):
  - phraseCompliance (большинство techniques missed)
  - psychTriggers (короткий звонок — может не быть)
```

Это становится **источником правды для skill**.

### День 2
**Skill v10 — переписывается под UI-contract** (не патч поверх v9.5).

Принципы:
- STEP 0 читает контракт + эталон по категории звонка
- Перед UPDATE — runtime валидатор (validate-enrich-sql.ts из v9.6 handoff подхватывается)
- Каждая категория звонка имеет свой набор обязательных полей
- Текстовые assertions заменены на runtime проверки
- enrichedBy = `claude-opus-4-7-v10`

### День 2 (вечер)
**Тест на 10 свежих звонках разных категорий.** Свежие = пришедшие через cron за последние сутки. Не historical.

Если 10/10 эталон → разрешаем backfill.

### День 3-7
**Backfill 1 окном --limit=10.** Не 5 параллельных. Спокойно. Через сутки — bump до 20. Через 3 дня — до 40. Если стабильно — параллелить.

---

## ⏱️ Реалистичный таймлайн

| День | Что | Ответственный |
|---|---|---|
| 30.04 вечер | Заморозка + сон | ты |
| 01.05 утро | Inventory UI страниц | ты + 1 сессия |
| 01.05 день | Эталоны страниц + карточек по 7 категориям | ты пишешь, сессия фиксирует в md |
| 01.05 вечер | UI-enrichment contract | сессия |
| 02.05 | Skill v10 + runtime валидатор | сессия |
| 02.05 вечер | Тест на 10 свежих | ты verify |
| 03-07.05 | Backfill --limit=10 → 20 → 40 | автомат |

**Результат через неделю:** стабильное автоматическое обогащение с понятным контрактом, 0 технического долга.

**Vs сегодняшнее:** v9.3, v9.4, v9.5, planned v9.6, v9.7 — растущий долг.

---

## 🛑 Инструкции для других сессий

### UI-сессии:
> Доделай Этап 5 (Контроль качества /quality). Этап 6 (Settings) в backlog.
> После Этапа 5 — STOP. Жди утреннего inventory.

### Cron-сессии:
> Smoke test нового orchestrator → если <10 мин → crontab install (15 мин cycle).
> После install — STOP. Backfill 28-30 transcripts через крон автомат (без Master Enrich).

### Будущей сессии (завтра утром):
> Прочитай этот файл целиком. Прочитай `docs/handoffs/2026-04-30-known-bugs-and-fixes.md`.
> 
> Не запускай /loop /enrich-calls. Не патчи skill.
> 
> Начни с inventory UI страниц. По каждой странице платформы зафиксируй
> текущее состояние в `docs/canons/canon-ui-pages-current-state.md` —
> ты собираешь данные, пользователь говорит что криво/чего не хватает.
> 
> v9.6 handoff (`2026-04-30-skill-v96-quality-uplift-combo.md`) — НЕ ПРИМЕНЯТЬ.
> Он заморожен. Содержит полезные элементы (validate-enrich-sql.ts) которые
> возможно подхватим в skill v10.

---

## 📁 Связанные документы

- `docs/handoffs/2026-04-30-known-bugs-and-fixes.md` — 6 багов с корнями
- `docs/handoffs/2026-04-30-skill-v96-quality-uplift-combo.md` — заморожен (содержит useful elements для v10)
- `docs/handoffs/2026-04-29-cron-resume-with-pbx-gc-linking.md` — cron context
- `docs/handoff/2026-04-29-enrich-data-layer-for-ui-prompt.md` — data layer для UI
- `docs/canons/master-enrich-samples/sample-3-proper-cleanup-lara.md` — эталон NORMAL closed_lost
- `docs/canons/master-enrich-samples/sample-4-strong-closer-tech-block.md` — эталон NORMAL strong_closer

**Эталонов для категорий B-G нет** — это часть Дня 1 завтра.

---

## 💡 Принципиальное изменение мышления

**Было:** «улучшим skill → лучше карточки в БД → UI как-нибудь подхватит».

**Стало:** «UI = контракт. Skill пишет ровно столько данных сколько нужно UI, в нужном формате. Никаких полей "на всякий случай". Каждое поле имеет адресата на конкретной странице».

Это снижает partial rate с 24-26% до ~5% потому что:
- Меньше полей = меньше шансов забыть
- Каждое поле имеет clear purpose → Opus не "креативит"
- Runtime валидатор проверяет ровно то что нужно UI

---

**Окончание сессии 30.04.2026 21:00 МСК. Спать. Завтра свежей головой.**
