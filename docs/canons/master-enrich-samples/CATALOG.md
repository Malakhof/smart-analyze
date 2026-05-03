# 📚 Master Enrich Samples — Catalog

**Single source of truth по эталонам обогащения карточек звонков.** Связан с `CATEGORIES.md` (7 типов звонка) и `EDGE-CASES.md` (decision tree).

---

## 🟢 Активные эталоны (использовать)

### sample-3: NORMAL — empathic_seller / closed_lost
**Файл:** `sample-3-proper-cleanup-lara.md`
**Создан:** 29.04.2026 (после cleanup-инцидента 29.04 — proper compression 21%)
**Категория:** **F (NORMAL ≥60s real_conversation)**
**Звонок:** Лариса Дунаева (МОП Наталья) → клиентка Лариса 57 лет, 12 минут, closed_lost
**Архетип МОПа:** `empathic_seller` (мягкая, слушающая, без давления)
**Архетип результата:** `closed_lost` (клиентка не купила — финансовый барьер)
**scriptScore:** 5/9 (56%)
**phraseCompliance used:** 2/12

**Что покрывает:**
- ✅ Полный 14-блочный enrichment эталона
- ✅ cleanedTranscript с правильной cleanup logic (only echo/Whisper hallucinations) — compression 79%+ от raw
- ✅ Markdown-таблицы для psychTriggers / phraseCompliance / scriptDetails / criticalErrors
- ✅ psychTriggers.missed full shape (time + quote_client + should_have_said) — 5 missed
- ✅ ropInsight 5 пунктов с конкретными action items
- ✅ nextStepRecommendation 4 шага с эмодзи (📲 📎 🗓️ 💌)
- ✅ extractedCommitments (Block 7) с alert для РОПа
- ✅ purchaseProbability обоснован (35% — closed_lost но не agressive negative)
- ✅ Negative case learning — учит модель что считать упущениями

**Когда использовать:** для обучения Opus как обогащать **negative outcomes** на NORMAL звонках. Архетип "тёплая МОП без закрытия" = частый кейс diva.

---

### sample-4: NORMAL — strong_closer + tech_naive / objection_unresolved
**Файл:** `sample-4-strong-closer-tech-block.md`
**Создан:** 29-30.04.2026 (после v9.3 фикса) — markdown-rich формат
**Категория:** **F (NORMAL ≥60s real_conversation)**
**Звонок:** Эльнура (МОП Наталья), 13:45 (825s), 36 лет Кыргызстан, almost-closed (тех. блок)
**Архетип МОПа:** `strong_closer + tech_naive` (дошла до суммы, но не справилась с тех. сбоем доставки ссылки)
**Архетип результата:** `objection_unresolved` (близко к won, упёрлось в WhatsApp delivery в Кыргызстан)
**scriptScore:** 18/22 (82%)
**phraseCompliance used:** 8/12

**Что покрывает:**
- ✅ Полный 14-блочный enrichment эталона
- ✅ cleanedTranscript с восстановлением порядка реплик + glossary (Эльнура унификация)
- ✅ Compression 85% (raw 12 728 → cleaned ~10 800)
- ✅ Все 12 техник phraseCompliance с конкретным evidence (used:8/12 — пример как заполнять positive cases)
- ✅ psychTriggers.positive — 10 приёмов (vs 3 в sample-3 — strong_closer делает гораздо больше)
- ✅ psychTriggers.missed — 4 упущения с full shape
- ✅ criticalDialogMoments — упущенный ДР-триггер (золотой момент 04:29)
- ✅ ropInsight 5 пунктов + системные fix'ы (multi-channel доставка, payment tech recovery training)
- ✅ extractedCommitments — 4 (2 МОП + 2 КЛИЕНТ) с алертом РОПу
- ✅ purchaseProbability 75% (горячий лид + только тех. барьер)
- ✅ Positive case learning — учит Opus как фиксировать **успешные техники used:true** с цитатами

**Когда использовать:** для обучения как обогащать **strong_closer / hot_lead / технический_срыв**. Полярная пара к sample-3 — вместе покрывают спектр NORMAL.

---

## 🗄️ Архивные эталоны (НЕ использовать)

Лежат в `archive_v8_with_compression_bug/` — содержат тот самый дефект сжатия (15-30% компрессии вместо 80%+) из v9.3 cleanup-bug. Опус читал их и интерпретировал «cleanup» как «суммаризировать».

| Файл | Дата | Дефект |
|---|---|---|
| `sample-1-soft-seller-no-offer.md` | до 29.04 | over-compressed cleanedTranscript, no markdown tables |
| `sample-2-empathic-win-back-brackets.md` | до 29.04 | YAML-only без таблиц, частичные поля |

**Правило:** в SKILL.md STEP 0 явно запрещено их Read. Не возвращать в активный set.

---

## 🔴 Категории БЕЗ эталона (создать перед v10)

| Категория | Описание | Длительность | Признак | Master Enrich нужен? | Эталона нет |
|---|---|---|---|---|---|
| **A: NO_SPEECH** | Whisper не нашёл речи / шум / placeholder | любая | transcript ≤ 100 chars | ❌ нет (skip Opus) | ⚠️ нужен sample эталона как заполнять минимальные поля |
| **B: VOICEMAIL/IVR** | Автоответчик / голосовое меню | обычно 10-30s | только МОП реплики, voicemail-фразы | ❌ нет (skip Opus) | ⚠️ нужен sample |
| **C: HUNG_UP** | Гудки / клиент сбросил после "Алло" | <30s | ультра-короткий, нет диалога | ❌ нет (skip Opus) | ⚠️ нужен sample |
| **D: TECHNICAL** | МОП/клиент НЕ слышат друг друга (повторяющиеся "Алло, слышите?") | переменная | технические маркеры + нет содержательного контента | ❌ нет (skip Opus) | ⚠️ нужен sample |
| **E: SHORT_RESCHEDULE** | Клиент попросил перенести (real_conversation но <60s) | 30-60s | "перезвоните позже / занят / не сейчас" | ✅ упрощённый | ⚠️⚠️ **ВАЖНО** — нет эталона как обогащать SHORT (Тип E), а это частый случай |
| **F: NORMAL** | Полноценный диалог ≥60s real_conversation | ≥60s | реальный диалог с темами | ✅ полный 14-блок | ✅ есть 2 эталона (sample-3, sample-4) |
| **G: PIPELINE_GAP** | Карточка-сирота: PBX-record без аудио / без transcript / без матча в GC | переменная | audioUrl IS NULL OR transcript IS NULL OR no PBX↔GC match | ❌ нет (UI redirect на counter в карточке МОПа, не показывать как звонок) | ⚠️ нужен sample как обрабатывать |

---

## 📋 Критерии нового эталона

Каждый новый эталон в этой папке должен иметь:

1. **Frontmatter:**
   ```
   # Эталон <category-letter>: <subtype>
   pbxUuid: <uuid> | callOutcome: <X> | duration: <N>s
   Архетип: <description>
   ```

2. **Все 14 блоков** (для F NORMAL) или **минимальный набор для своей категории** (см. `EDGE-CASES.md`)

3. **CLEANUP NOTES** — что удалено и почему. Compression % явно (raw N → cleaned M = X%).

4. **Comparison с существующими эталонами** — что новое покрывает что не покрывают другие.

5. **GC Deep-link секция** в конце (только для категорий где gcCallId NOT NULL).

6. **Версия канона:** в начале файла указать `Created for: skill v10 contract`. Старые до v9.5 — пометить deprecated.

---

## 🔗 См. также

- `CATEGORIES.md` — детали правил различения 7 категорий
- `EDGE-CASES.md` — decision tree какие поля заполнять для каждой
- `../canon-master-enrich-card.md` — schema 14 блоков
- `../skill-enrich-calls.md` — старая SKILL.md
- `../../handoffs/2026-05-03-skill-v10-progress.md` — статус v10

---

**Last updated: 2026-05-03**
**Активных эталонов: 2 (sample-3, sample-4) — оба категории F (NORMAL)**
**Категорий без эталона: 5 (A, B, C, D, E) + G новая**
