# UX Cleanup — Платформа SalesGuru (4.05.2026)

> **Статус:** Spec для `/write-plan` (input technical specification)
> **Date:** 2026-05-04
> **Premiere:** сегодня днём
> **Backup:** `pre-ux-cleanup-2026-05-04` tag (rollback `git reset --hard`)

## 🎯 Mission

Превратить интерфейс из **технического отчёта** в **human-readable dashboard для РОПа**.

**Не переделываем — докручиваем.** Структура верная (50 tasks done), контент верный (skill v9.5 пишет всё нужное в БД). Проблема — **rendering layer**: UI показывает internal IDs, English enum'ы, debug messages, не отображает заполненные поля.

**Принцип:** "how to present existing content better, not what to add/remove".

## 📋 Scope — какие файлы трогаем

```
src/app/(dashboard)/_components/gc/
├── call-card.tsx          ← главный (карточка звонка, 7 категорий)
├── dashboard-rop.tsx      ← главная страница
├── managers-list.tsx      ← список менеджеров
├── manager-detail.tsx     ← карточка менеджера
└── client-card.tsx        ← карточка клиента

src/app/(dashboard)/quality/
├── page.tsx               ← страница контроля качества
└── _components/...        ← все Qc* компоненты
```

**Plus:** все Block компоненты на главной (`Block1` … `Block7b`).

## 🚫 NOT in scope

- ❌ Pipeline / cron / worker / scripts/ — НЕ трогать
- ❌ Master Enrich SKILL.md — НЕ патчить (поля заполнены корректно — это UI bug, не skill bug)
- ❌ 3 GC deep-link логику в `call-card.tsx:160-168` — invariant rule #9 (см. `feedback-gc-deeplinks-invariant.md` в memory)
- ❌ Data model / БД schema — только rendering
- ❌ /quality `getQcGraphDataGc` stub — defer post-premiere (это **отдельный** issue)
- ❌ Sparklines (Task 49 deferred) — defer post-premiere

---

## 🔧 Категории проблем (что чинить)

### 1. Common system-wide — приме­няется на ВСЕХ карточках, страницах, типах

#### 1.1 Header tech enums — убрать целиком
**Сейчас в шапке карточки звонка:**
```
🎯 callType: real_conversation     ← УБРАТЬ
📞 callOutcome: voicemail          ← УБРАТЬ (дубль с CategoryHero)
📈 outcome: closed_lost            ← УБРАТЬ (тоже в CategoryHero)
🆔 gcCallId: 209355457             ← убрать в DevTools collapsed
🆔 gcContactId: 501210476          ← убрать в DevTools collapsed
🆔 dealCrmId (если есть)           ← убрать в DevTools collapsed
🆔 pbxUuid                         ← убрать в DevTools collapsed
```

**Должно остаться в header:**
```
Имя клиента → Имя МОПа · 03.05.2026 19:30 МСК · 1:09
[Категория-плашка через CategoryHero ниже]
[3 GC deep-link кнопки — Карточка звонка / Клиент / Сделка]
```

**DevTools блок** — collapsed по дефолту, раскрывается по клику. Содержит: gcCallId, gcContactId, dealCrmId, pbxUuid, tenantId, managerId, raw enum'ы (callType/callOutcome/outcome).

#### 1.2 "enriched" / "needs_rerun_v9" / "in_progress" tag — убрать из header
Эти статусы технические. РОПу не нужно знать что обогащено. Перенести в DevTools блок (если вообще нужно).

#### 1.3 DEV warning в production — критический баг
**Сейчас:**
```
⚠️ DEV: HIDE-категория VOICEMAIL_IVR получила данные: psychTriggers/reaction/style, scriptScore/scriptDetails, nextStepRecommendation
```

**Должно быть:** обернуть `process.env.NODE_ENV !== 'production'`. Файл `call-card.tsx`, функция `HybridWarn` (Task 50 hybrid-WARN).

#### 1.4 Debug messages в UI
**Сейчас:**
```
🧼 Очищенный транскрипт
(fallback transcriptRepaired — cleanedTranscript ещё не готов)   ← УБРАТЬ
```

**Должно:**
```
🧼 Транскрипт
[content]
```

#### 1.5 "Cleanup Notes" блок в конце транскрипта — убрать
**Сейчас:** перечень Whisper-артефактов которые skill cleanup'нула ("сельского омоложения" → "омоложения Дива", "наква" → удалено и т.д.)

**Должно:** скрыть или collapsed (РОПу не нужно знать что Whisper галлюцинировал).

#### 1.6 Названия звонков — UUID → human
**Сейчас в списках:** `0dd9e3a9-fd40-4675-85ac-8ed14bff31b5`

**Должно:** `Сали Алиева → Ирина · 03.05 19:30 · 12:37`

Применить ко всем спискам звонков (главная Block 3, manager-detail, client-card, /quality recent calls, и т.д.).

---

### 2. Englishisms — переписать русским ВЕЗДЕ

**Полный mapping (collected from Сали + NORMAL feedback):**

#### 2.1 Enum values (callType / callOutcome / outcome / managerStyle / clientReaction)

| English enum | Русский |
|---|---|
| `real_conversation` | "Полный диалог" |
| `voicemail` | "Автоответчик" |
| `ivr` | "Голосовое меню" |
| `hung_up` | "Сброс клиента" |
| `no_answer` | "Не отвечает" |
| `no_speech_or_silence` | "Тишина" |
| `technical_issue` | "Тех. сбой связи" |
| `not_applicable` | "Не применимо" |
| `closed_won` | "Закрыли продажу" |
| `closed_lost` | "Не закрыли (отказ)" |
| `objection_unresolved` | "Не отработал возражение" |
| `scheduled_callback` | "Перезвон назначен" |
| `no_offer_made` | "Не сделал оффер" |

#### 2.2 managerStyle — преобразовать snake_case enum → human

**Примеры из БД (Сали):**
- `strong_closer_medical_authority_no_deadline` → "Сильный закрыватель · Авторитет эксперта · Без дедлайна"
- `empathic_seller_weak_objection_handling` → "Эмпатичный продавец · Слабая отработка возражений"
- `monolog_presenter_no_diagnostic` → "Монолог-презентация · Без диагностики потребностей"
- `efficient_scheduler` → "Эффективный планировщик"
- `competent_scheduler_with_product_expertise` → "Грамотный планировщик · Эксперт по продукту"
- `soft_continue` → "Мягкое продолжение"
- `first_line_polite_handover` → "Вежливая передача (первая линия)"

**Как:** написать helper `formatManagerStyle(raw: string): string` который parse'ит snake_case строку и собирает русское представление (через словарь tokens или AI prompt в skill, но это не сейчас).

**Альтернатива (быстрая):** static map из ~20 наиболее частых style strings → human label. Если нет в map — показать raw как есть (но в DevTools collapsed).

#### 2.3 clientReaction — то же самое

**Примеры:**
- `engaged_warm_then_self_directed` → "Вовлечён · затем самостоятельно"
- `cold_disengaged` → "Холодный · не вовлечён"
- `confused_questioning` → "Запутанный · задаёт вопросы"
- `silent` → "Молчит"
- `not_engaged` → "Не вовлечён"

#### 2.4 PsychTriggers labels (positive[] / missed[] item names)

**Сейчас в БД:**
- `искренний_комплимент` ✅ уже русским — оставить как есть
- `выбор_без_выбора` ✅
- `эмоциональный_подхват` ✅
- но плюс могут быть english fragments — найти и перевести

**Что найти в коде** (call-card.tsx PsychBlock):
- `Strong call`, `Strong overall` → "Сильный финал", "Уверенное закрытие"
- `Strong loser` → "Сильное возражение / не закрыл"
- `Medical authority` → "Авторитет эксперта (мед.)"
- `No deadline` → "Без дедлайна"
- `Phrase compliance` → "Соответствие 12 ключевым фразам"
- `Script scoring` / `Script score` → "Оценка по скрипту"
- `Critical errors` → "Критические ошибки"
- `evidence_mist` / `arm_serious_evidence` / `you_struma` → найти откуда и перевести
- `George Parkson` (?) → найти

#### 2.5 Commitments action enum

**Сейчас:**
```
action: send_landing
action: create_order
action: send_whatsapp
action: callback
action: send_email
action: meeting
action: task
action: bring_documents
action: other
```

**Должно (UI label):**
- `send_landing` → "Отправить ленд"
- `create_order` → "Создать заказ"
- `send_whatsapp` → "Написать в WhatsApp"
- `callback` → "Перезвонить"
- `send_email` → "Отправить email"
- `meeting` → "Назначить встречу"
- `task` → "Поставить задачу"
- `bring_documents` → "Принести документы"
- `other` → "Другое"

**Сохранить enum в data attribute** (для grep/search), но **показывать русский label**.

#### 2.6 isCurator / isFirstLine / possibleDuplicate / hadRealConversation

- Скрыть если **false** (РОПу не нужно знать что "isCurator: false")
- Если **true** — показывать как **badge**:
  - `isCurator: true` → 🎓 "Куратор"
  - `isFirstLine: true` → 📞 "Первая линия"
  - `possibleDuplicate: true` → ⚠️ "Возможный дубль"
- `hadRealConversation` — НЕ показывать вообще (это derivable из callType)

---

### 3. Long text layout — вёрстка человеческая

**Проблема:** Резюме / `ropInsight` / `managerWeakSpot` / "Strong overall" — гигантская плита текста без абзацев, акцентов, заголовков.

**Должно быть:**

#### 3.1 ropInsight — bullet list
**Сейчас (плита):**
```
🚨 КРИТИЧНО для strong call: 0 искренних комплиментов (упущены 2 золотых триггера 42 года + осознанность), нет уверенности про рассрочку АЗ («скорее всего нет»), ВОЗРАСТ 42 не использован как trigger, нет fixed follow-up time
```

**Должно (bullets):**
```
💡 Что РОПу делать:
• 🚨 0 искренних комплиментов (упущены 2 золотых триггера: 42 года + осознанность)
• 🚨 Нет уверенности про рассрочку АЗ («скорее всего нет»)
• ⚠️ Возраст 42 не использован как trigger
• ⚠️ Нет fixed follow-up time
```

#### 3.2 Резюме (long text from `summary` field) — абзацы + жирный

**Должно:**
- Разделить логические части на абзацы
- **Жирный** на ключевые тезисы / выводы
- Цитаты клиента — оформить как "blockquote" / Notion-style серый блок

#### 3.3 managerWeakSpot — bullets если перечисление

#### 3.4 Strong overall (если в RopInsight остаётся "Strong overall: ...") — переименовать "Сильные стороны:" + bullets

---

### 4. Stats panel — labels + conditional hide

#### 4.1 Conditional hide для no-action категорий
**Категории A (NO_SPEECH), B (VOICEMAIL_IVR), C (HUNG_UP), D (TECHNICAL_ISSUE), G (PIPELINE_GAP):**

→ **Полностью скрыть** Stats panel (Talk ratio, monologue, интерактивность). Для этих типов **бессмысленно** (автоответчик не разговаривает, тишина не имеет ratio).

**Категории E (SHORT_RESCHEDULE), F (NORMAL):**

→ **Показывать** Stats panel.

#### 4.2 Labels rewrite

| Сейчас | Должно |
|---|---|
| `Talk ratio 65%` | `МОП говорит 65%, клиент 35%` |
| `Самый длинный монолог 1:23` | `Длинный монолог: 1:23 (МОП)` |
| `Интерактивность 8.4 обм/мин` | `Активность: 8.4 обмена/мин` |

---

### 5. "Категория и исход" блок снизу

**Сейчас на VOICEMAIL карточке (бессмысленно):**
```
🎯 Категория и исход
callType            not_applicable
callOutcome         voicemail
hadRealConversation false
outcome             not_applicable
isCurator           false
isFirstLine         false
possibleDuplicate   false
```

#### 5.1 Hide для no-action типов (A/B/C/D/G)
**Полностью скрыть блок** — для этих типов он дублирует CategoryHero и не несёт информации.

#### 5.2 Show + human для NORMAL/SHORT_RESCHEDULE (E/F)
**Должно (E/F):**
```
📊 Сводка
Тип звонка       Полный диалог
Исход            Не отработал возражение
[badges если true]
🎓 Куратор   📞 Первая линия   ⚠️ Возможный дубль
```

- Скрывать `hadRealConversation` (derivable)
- Скрывать `false` booleans
- Показывать только `true` как badges
- Переименовать раздел "Сводка" / "Метаданные"

---

### 6. Per-category specific

#### 6.1 NO_SPEECH (A) — transcript hide для placeholder-only

**Сейчас (даже при `transcript ≤ 100 chars`):**
```
🧼 Транскрипт
[МЕНЕДЖЕР 00:00] (Приветствие. ПД. ФИО)
```

**Должно:** если transcript содержит **только placeholder** (regex match на `(Приветствие. ПД. ФИО)`-like patterns) — **не показывать transcript блок** вообще. Достаточно CategoryHero + audio.

#### 6.2 NO_SPEECH CategoryHero text — скорректировать

**Сейчас:**
```
🤐 Whisper не нашёл речь — звонок не оценивается. При сомнении послушать вручную.
```

**Должно:**
```
🤐 Не обнаружено речи в записи. Возможно молчание в трубку. При сомнении можете прослушать вручную.
```

(убираем "Whisper" — РОПу не нужно знать про Whisper)

#### 6.3 Прочие категории — text plашек оставить как в spec но **проверить что нет английских терминов**.

---

### 7. Missed fields render — критично

**Skill v9.5 пишет в БД полностью заполненные:**
- `psychTriggers.missed[]` — каждый item имеет `time`, `quote_client`, `should_have_said`
- `criticalDialogMoments[]` — каждый item имеет `time`, `issue`, `client_quote`, `should_have_said`
- `managerStyle`, `clientReaction`, `managerWeakSpot` — full strings

**НО UI рендерит как "пусто":**
- "Триггера нет" — UI не отображает `quote_client` или `should_have_said`
- "Что должна была сказать пусто" — UI не отображает `should_have_said`
- "Только таймкод" в criticalDialogMoments — UI не отображает `issue` / `should_have_said`

**Файл:** `src/app/(dashboard)/_components/gc/call-card.tsx`, components `PsychBlock` (PsychTriggers missed) и `CriticalDialogMomentsBlock`.

**Найти и починить:**
- Как rendering ищет fields в JSON — возможно field name mismatch (UI ожидает `triggerText` вместо `quote_client`, или `description` вместо `issue`, или `actionAdvice` вместо `should_have_said`)
- Schema из БД (per Сали 0dd9e3a9 dump):
  ```json
  "missed": [
    { "time", "quote_client", "should_have_said" }
  ],
  "criticalDialogMoments": [
    { "time", "issue", "client_quote", "should_have_said" }
  ]
  ```
- UI должен отображать **все 3-4 поля** для каждого item:
  - `time` (как badge)
  - `quote_client` / `client_quote` (Notion-style цитата серым с emoji 💬)
  - `issue` (description что не так — для criticalDialogMoments)
  - `should_have_said` (с акцентом 💡 что МОП должна была сказать)

---

### 8. keyClientPhrases — оформить как цитаты

**Сейчас (если рендерится):** серый текст без выделения.

**Должно:** Notion-style blockquote с emoji 💬, monospace для timecodes, отступы.

---

## 📝 Constraints (НЕ ломать)

1. **3 GC deep-link логику** в `call-card.tsx:160-168` (rule #9 в memory)
2. **Data model** — только rendering layer
3. **Cron Stage 7.5b** — функционален (rule #10), не "чинить"
4. **БД поля** — НЕ удалять, только скрывать из UI
5. **enum values в data layer** — оставить как есть (для grep/search/filter), переводить **только в UI**

---

## ✅ Done criteria

После UX cleanup для каждой из 7 категорий звонка визуально проверить (на наших 11 enriched test cards):

| Категория | Pass criteria |
|---|---|
| **F NORMAL** (Сали 0dd9e3a9, и др.) | Все блоки видны (Psych, Script, Phrase, Critical, RopInsight, NextStep, Commitments). 🚨 `psychTriggers.missed[].should_have_said` ОТОБРАЖАЕТСЯ. `criticalDialogMoments[].issue` и `should_have_said` ОТОБРАЖАЮТСЯ. Header без enum'ов / IDs. Stats panel с human labels. ropInsight в bullets. |
| **A NO_SPEECH** (99da3093) | Только CategoryHero + audio (если есть). Без transcript (placeholder-only). Без Stats panel. Без "Категория и исход" блока. |
| **B VOICEMAIL** (2e7d85ac) | CategoryHero + audio + transcript + RopInsight + Tags. Без Stats panel. Без "Категория и исход". |
| **C HUNG_UP** (нет в test pack — взять любой failed real_conversation < 30s после recovery) | CategoryHero + audio + RopInsight + Tags. |
| **D TECHNICAL** (нет в test pack — взять wrong_topic edge `beabd3fe` как близкий) | CategoryHero + transcript + RopInsight. |
| **E SHORT_RESCHEDULE** (5a2ed4b7, 0489d431) | CategoryHero + audio + transcript + Summary + Script (упрощённо) + RopInsight + NextStep + Commitments. Без Psych / PhraseCompliance. |
| **G PIPELINE_GAP** | Diagnostic блок + Category мин. |

**Plus:** все страницы (главная, менеджеры, /quality, client-card, deal-card) — без English enum dump'ов в UI.

**Plus:** rule #9 verify — 3 GC deep-link'а работают на NORMAL карточке.

---

## 🔄 Rollback safety

```bash
git tag pre-ux-cleanup-2026-05-04 ✅ создан (commit base)
git branch backup/pre-ux-cleanup-2026-05-04 ✅ создан

# Если что-то сломается:
git reset --hard pre-ux-cleanup-2026-05-04
# Или checkout backup branch:
git checkout backup/pre-ux-cleanup-2026-05-04
# Или revert конкретного task'а:
git revert <commit-hash>
```

---

## 🎯 Order of operations (рекомендации для write-plan)

**Phase A — low risk, additive (hide-only):**
1. DEV warning в `NODE_ENV !== 'production'`
2. Убрать debug messages ("(fallback transcriptRepaired)", "Cleanup Notes" в transcript)
3. Скрыть internal IDs (gcCallId/gcContactId/dealCrmId) → DevTools collapsed
4. Скрыть `false` booleans (isCurator/isFirstLine/possibleDuplicate)
5. Conditional hide Stats panel для no-action типов (A/B/C/D/G)
6. Conditional hide "Категория и исход" блока для no-action

**Phase B — medium risk, refactor labels:**
7. Englishisms → русский (enum mapping helpers)
8. managerStyle / clientReaction → human display
9. Stats panel labels rewrite
10. Названия звонков (UUID → "Имя · дата")
11. Action enum → русский label (Commitments)
12. Header tech enums removal (callType/callOutcome/outcome — целиком)

**Phase C — medium risk, missing fields render:**
13. **PsychBlock** — rendering `missed[].quote_client`, `missed[].should_have_said` (это main bug)
14. **CriticalDialogMomentsBlock** — rendering `issue`, `should_have_said`
15. **keyClientPhrases** Notion-style оформление

**Phase D — layout polish:**
16. ropInsight → bullets
17. Резюме → абзацы + жирный
18. NO_SPEECH transcript hide для placeholder-only

**Phase E — visual verification:**
19. Smoke test 7 категорий на test pack 11 cards
20. Verify 3 GC deep-link rule #9
21. Type check + lint

---

## 📚 Reference files (read first by write-plan agent)

1. `docs/handoffs/2026-05-03-premiere-expert-handoff.md` — главный context
2. `docs/canons/master-enrich-samples/CATEGORIES.md` — 7 категорий A-G
3. `docs/canons/ui-inventory-2026-05-03.md` — UI текущее состояние
4. `docs/canons/ui-enrichment-contract.md` — data contract
5. `~/.claude/projects/-Users-kirillmalahov-smart-analyze/memory/feedback-gc-deeplinks-invariant.md` — rule #9
6. `docs/canons/master-enrich-samples/sample-3-proper-cleanup-lara.md` — эталон NORMAL
7. `docs/canons/master-enrich-samples/sample-4-strong-closer-tech-block.md` — эталон NORMAL
8. **Этот файл** — `docs/plans/2026-05-04-ux-cleanup-spec.md`

---

## 📋 Test data — 11 enriched cards (use for verify)

| # | Категория | UUID | Note |
|---|---|---|---|
| 1 | NORMAL | `0dd9e3a9-fd40-4675-85ac-8ed14bff31b5` | Сали 12-min closing — main test card |
| 2 | NORMAL | `155c0981-8a71-4ebe-8d64-e0c243fcb74b` | Надежда 5-min |
| 3 | NORMAL | `e92d072f-ca34-47ea-bd29-4340de17c1be` | Татьяна 70 пенсия 8-min |
| 4 | NORMAL | `bb418e2b-02ae-4e32-8a49-65e257deb91a` | Надежда 2.5-min |
| 5 | NORMAL | `0a7847e8-1448-4d54-8c95-3f69c056cd8f` | Ирина monolog 5/6 critical errors |
| 6 | SHORT | `5a2ed4b7-d243-417e-b600-499a71ec0fa3` | Ольга 44s |
| 7 | SHORT | `0489d431-cd04-41d1-a80f-bba0a09db4c8` | Чернышова первая линия 43s |
| 8 | NO_SPEECH | `99da3093-3539-49e4-af42-a7d084092cae` | placeholder-only transcript |
| 9 | wrong-topic edge | `beabd3fe-b1ac-4065-bed1-7352fdef7891` | edge case |
| 10 | VOICEMAIL | `2e7d85ac-0a8e-493a-bf49-22f0a26f5c9c` | автоответчик |
| 11 | VOICEMAIL | `52a0e6d7-c64e-43c0-b4cc-e9fdbde46536` | автоответчик |

---

## 🚀 Workflow для write-plan agent

1. Прочитать всё в **Reference files** (8 файлов)
2. Открыть `call-card.tsx` (~600 строк), `dashboard-rop.tsx`, `manager-detail.tsx`, `client-card.tsx`, `quality/page.tsx` (Read)
3. Найти **где** в коде каждая проблема (categories 1-8 выше)
4. Превратить **каждую категорию** в bite-sized tasks (2-5 минут каждый)
5. **Order of operations** — Phase A → E (см. выше)
6. **Smoke test** между phases (cmd: visual проверка test pack URLs)
7. **Atomic commits** — каждый task → 1 commit
8. **Rollback** в каждом task: `git revert <hash>`
9. **Save plan to:** `docs/plans/2026-05-04-ux-cleanup-impl.md`

**Final sign-off after plan written:** total tasks count, total ETA, breakdown по phases (A/B/C/D/E), high-risk tasks выделены отдельно для user approval перед execute-plan.
