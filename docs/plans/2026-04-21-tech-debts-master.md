# Smart Analyze / SalesGuru — мастер-список технических долгов

**Дата:** 2026-04-21 (после demo-сессии)
**Цель документа:** зафиксировать всё что нужно доделать до production-качества. Этот файл — единая точка правды для следующих сессий. Только план, без исполнения.

---

## 🎯 Принцип приоритизации

1. **P0 — перед cron auto-sync.** Всё что при включении автосинхронизации будет копить повреждённые данные день за днём.
2. **P1 — до серьёзных продаж.** Полнота данных, честность цифр, работающие ссылки, объясняемые метрики.
3. **P2 — после первых клиентов.** UX-улучшения, новые GC endpoints, продвинутые фичи.
4. **P3 — отложено.** Мелкие долги, не блокирующие ничего.

---

## 🔴 P0 — БЛОКЕРЫ ДО CRON AUTO-SYNC

### 1. GC sync — полная переделка под правильную архитектуру

**Проблема (из voice-notes):** у diva сейчас кривой sync — даты createdAt = дата нашей синхронизации, не реальная, ID подтягиваются из разных мест криво, менеджеры/клиенты/воронки/карточки звонков/карточки пользователей — всё рассинхронизировано.

**Что должно получиться:**
- `Deal.createdAt` = реальная дата создания сделки в GC (парсить из detail page или `relativeDate`)
- `Deal.managerId` = реальный менеджер (из `contact-list`, backfill через звонки/сообщения)
- `Deal.funnelId` + `currentStageCrmId` = корректная воронка и этап
- `Deal.clientCrmId` = настоящий контакт (для фильтра anonymous vs real)
- `CallRecord.dealId` = настоящая привязка к сделке (сейчас 87% orphan до backfill)
- `CallRecord.createdAt` = реальное время звонка (из контакт-листа)
- `Manager` таблица = только реальные менеджеры отдела продаж (не все юзеры GC)
- Главная страница должна корректно фильтровать по датам (день/неделя/месяц/квартал)

**Подзадачи:**
- [ ] `scripts/fix-diva-dates.ts` — парсер `relativeDate` "3 дня назад" + detail page `createdAt` → правильный `Deal.createdAt`
- [ ] `scripts/fix-diva-managerid.ts` — `UPDATE Deal SET managerId FROM CallRecord/Message` (один раз для существующих данных + встроить в sync pipeline)
- [ ] `scripts/fix-diva-funnel.ts` — `UPDATE funnelId="Доска продаж" + currentStageCrmId` по статусу
- [ ] В `gc-sync-v2.ts` → `resolveDealId` при промахе дотягивает одну сделку через deal-list с фильтром `?DealSearch[id]=X` (forward fix вместо текущей backfill)
- [ ] Валидация: после полного sync запускать `scripts/validate-diva-integrity.ts` — проверяет orphan rate, managerId coverage, createdAt sanity (никаких дат > NOW() - 1 дня для старых сделок)
- [ ] **Bug #34 fix финализировать** (task #47) — связан с этим

**Эффект:** главная страница показывает честные графики, фильтры по датам работают, патерны/оценки строятся на правильных данных. Без этого cron будет копить битые данные.

**Время:** 4–6 часов.

---

### 2. Транскрибация — перезалить под новый pipeline

**Проблема:** текущие 445+ транскриптов diva имеют drift (сегменты склеены, порядок реплик неверный, CompliancebyStep не работает). Rule зафиксировано в `memory/feedback-transcription-pipeline.md`.

**План (v2 pipeline — `docs/plans/2026-04-21-transcription-pipeline-fix.md`):**
- [ ] Патч `scripts/runpod-transcribe-batch.py`: `word_timestamps=True`, `vad_filter=False`, `condition_on_previous_text=False`, merge на word-level с group-by-gap
- [ ] Добавить `CallRecord.transcriptRaw Jsonb?` (Prisma migration) — сырые сегменты/слова. Раз сохранили — больше никогда не теряем.
- [ ] `apply-transcripts.ts` уже пишет `duration` (сделано сегодня), добавить запись `transcriptRaw`
- [ ] **Dry-run** на 5 звонках — проверить density переходов (>=10/мин), сверить с аудио
- [ ] **Bulk retranscribe** ~1000 звонков diva+reklama+vastu. RunPod 4 подa параллельно 2–3 часа, ~$5–8
- [ ] **Удалить все CallScore / CallScoreItem / CallTag** и запустить `score-parallel.ts --concurrency 8`. $2–3, 20–30 мин.
- [ ] **Регенерировать Insights** (Hot Deals / Manager Comparison / Voice / Sales Phrases / Tone / retro) — $0.50
- [ ] **НЕ запускать** `run-deepseek-pipeline.ts` (там `Insight.deleteMany()` стирает retro). Запускать только `analyzeDeals`, `diva-retro-deep`, `diva-master-only` по отдельности.

**Эффект:** транскрипты читабельны, CallScore адекватен, /patterns compliance-chart не на экстремумах.

**Время:** 4–6 часов активной работы + background GPU.

---

### 3. Playwright — auto-refresh GC cookie

**Проблема:** сейчас GC-синхронизация живёт на cookie, который ввели руками. Cookie протухает через дни, sync ломается. Для cron нужен Playwright-логин чтобы автоматически обновлять cookie.

**План:**
- [ ] Починить `scripts/refresh-gc-cookie.ts` под Playwright (task #38)
- [ ] Хранить пароль в CrmConfig (encrypted) — новое поле `CrmConfig.gcPassword` (Prisma migration)
- [ ] Workflow: при 401/302 от GC sync → вызвать refresh → повторить. В cron: refresh запускается раз в сутки профилактически.

**Эффект:** sync работает без ручного вмешательства. Обязательно до cron.

**Время:** 2–3 часа.

---

### 4. Migration к salesguru.ru

**Проблема:** сайт переехал на `app.salezguru.ru`, но:
- OAuth callbacks в amoCRM/GetCourse указывают только на старый `sa.qupai.ru`
- NEXTAUTH_URL на сервере всё ещё `sa.qupai.ru` → при логине на новый домен cookie set для старого
- Нет 301 редиректа со старого на новый

**Подзадачи:**
- [ ] **Task #39**: В amoCRM приложении (ООО Рассвет, reklama, vastu, shumoff) и в GetCourse OAuth app — добавить `https://app.salezguru.ru/api/auth/callback/*` параллельно со старыми URL
- [ ] **Task #40**: Обновить `NEXTAUTH_URL=https://app.salezguru.ru` в `.env` на сервере + `docker compose up -d`
- [ ] **Task #41**: В Caddy добавить `redir 301 sa.qupai.ru/* app.salezguru.ru{uri}`
- [ ] Проверить: логин на salezguru.ru не выкидывает в редирект-луп, OAuth flow завершается

**Время:** 1 час (большая часть — вручную в кабинетах провайдеров).

---

## 🟠 P1 — ДО ПРОДАЖ / ДЕМО КЛИЕНТАМ

### 5. Карточки паттернов — вынести цитаты в свои места

**Проблема (из voice):** сейчас в `/patterns` карточка паттерна — это длинное полотно: описание + все цитаты из переписок/звонков навалом. Нечитаемо.

**Требуемая структура:**

**Карточка паттерна (краткая):**
- Название паттерна
- Описание (что за сценарий)
- Ссылки на конкретные сделки где он проявился
- Список менеджеров которые его используют
- **НЕТ цитат прямо в карточке**

**Карточка сделки (расширенная):**
- Цитаты/куски переписки/куски звонка лежат в своей deal-карточке
- В deal-карточке каждая цитата подписана: "из переписки", "из звонка, менеджер Иван, 18.04 14:08"
- Ссылка на конкретный message/callRecord чтобы можно было провалиться в источник

**Подзадачи:**
- [ ] Refactor `src/app/(dashboard)/patterns/page.tsx`: убрать массив `quotes` из карточки, оставить только `dealIds[]` и `managerIds[]`
- [ ] Refactor `src/app/(dashboard)/deals/[id]/page.tsx`: добавить блок "Упомянутое в паттернах" — показывает какие цитаты из этой сделки попали в какие паттерны, с подписью источника (message/call)
- [ ] Миграция в схему `Pattern` — может уже хранится в `evidence[]`, проверить
- [ ] Сделать аналогично для **"Absolute positive / negative"** раздела (`diva-power-insights.ts`, Manager Comparison)

**Время:** 4–6 часов.

---

### 6. Карточка сделки — chronology timeline от подключения

**Проблема (из voice):** нужна логика — когда клиент подключается к Sales GURU, от этого момента ведётся хронология движения карточки по воронке. Каждое событие (сообщение / звонок) привязано к этапу воронки, на котором оно произошло.

**Требуемое:**
- Таймлайн: "10:00 — stage 'Назначен звонок', звонок Иван→Мария" / "12:30 — stage 'Оплачен', сообщение от клиента"
- Хронология ведётся с момента подключения клиента к нам (не раньше)
- Показывается в deal-карточке блоком "Хронология событий по воронке"

**Подзадачи:**
- [ ] Расширить `DealStageHistory` — сейчас есть таблица, проверить что она правильно заполняется при каждом изменении стадии (task #32 завершён — "Создана→Сейчас")
- [ ] Добавить в Message / CallRecord при создании — привязку к `stageIdAtEvent` (foreign key к DealStageHistory или снимок `currentStageCrmId` на момент события)
- [ ] Компонент `<FunnelTimelineWithEvents />` — объединяет DealStageHistory + Message + CallRecord по времени, группирует по этапам
- [ ] В `salesguru-onboarding-pattern.md` добавить правило "клиент подключён → с этого момента ведём полную хронологию"

**Время:** 6–8 часов (кусок архитектуры).

---

### 7. Карточка менеджера — успешные/неуспешные сделки + цитаты propagate

**Проблема (из voice):** 
- На карточке менеджера показываются длинные цитаты в "успешных" и "неуспешных" сделках — ОК, здесь их оставить.
- Но когда переходишь из карточки менеджера в конкретную сделку — там этих цитат НЕТ. Должны быть — подписанные "из переписки X" / "из звонка Y".
- Из какой карточки/сообщения эта цитата — сейчас непонятно.

**Подзадачи:**
- [ ] В `managers/[id]/page.tsx` блоки "успешные/неуспешные сделки" — оставить цитаты
- [ ] Добавить в каждой цитате ссылку "→ перейти к источнику" (к message или callRecord)
- [ ] В `deals/[id]/page.tsx` показывать те же самые цитаты с пометкой "эта цитата попала в анализ менеджера X"
- [ ] Цитата ↔ message/callRecord связь через `sourceMessageId` / `sourceCallRecordId` в таблице Pattern или DealAnalysis evidence

**Время:** 3–4 часа.

---

### 8. Теги менеджеров — объяснить цветовую схему

**Проблема (из voice):** на менеджерах видны теги "требуется поддержка", "на карандаш" с цветами красный/жёлтый/зелёный. Что они значат? Как подтягиваются цифры? Почему такой цвет?

**Требуемое:**
- Объяснение в UI (tooltip или info-блок в шапке страницы /managers)
- "Требуется поддержка" = conversionRate < 30% за период
- "На карандаш" = talkRatio > 70% (монолог) OR avgScore < 50
- Цвета:
  - Красный = требует немедленного вмешательства
  - Жёлтый = на наблюдении
  - Зелёный = всё в норме

**Подзадачи:**
- [ ] Написать логику расчёта тегов в `src/lib/queries/managers.ts` (или аналог)
- [ ] Добавить info-блок в `/managers` с объяснением критериев
- [ ] Пороги вынести в константы и описать — "после анкеты клиент может настроить"
- [ ] Привязать к `tenantMode` (live/all) — чтобы при переключении пересчёт работал

**Время:** 2–3 часа.

---

### 9. После заполнения анкеты — главная страница калибруется

**Проблема (из voice):** когда клиент заполняет анкету (4 кита / 9 разделов), главная страница и остальные страницы должны сразу перестроиться под его ответы (главная воронка, валютное поле суммы, список реальных менеджеров, скрипт).

**Подзадачи:**
- [ ] Создать `TenantConfig` таблицу: `mainFunnelId`, `amountFieldName`, `excludedManagerIds[]`, `customScriptId`, `isConfigured`
- [ ] Страница `/settings/onboarding` — форма заполнения анкеты, апдейтит TenantConfig
- [ ] Все queries dashboard / managers / quality учитывают TenantConfig
- [ ] Если `isConfigured=false` — показывать "Система в режиме общей оценки. Заполните анкету для точных цифр."

**Время:** 6–8 часов.

---

### 10. Период-фильтр в /quality (1д/3д/7д/10д)

**Проблема:** сейчас в /quality для diva mode=live окно фиксированное 7д. Нужен переключатель.

**Подзадачи:**
- [ ] Добавить `<PeriodFilter />` сверху /quality
- [ ] URL param `?period=1d|3d|7d|10d|30d|90d`
- [ ] Фильтр применяется в `qcCallWhere` (уже есть `filters.periodDays`, прокинуть)
- [ ] Показывать только для diva mode=live (для amo фильтр другого формата)

**Время:** 1 час.

---

### 11. Header — добавить shumoff174 в TENANT_DISPLAY_NAMES

**Проблема:** в header.tsx словарь tenant имён — для shumoff пустой.

**Подзадача:**
- [ ] `src/components/header.tsx` → добавить `cmo8icb8700000ipg6iy3sl27: "Shumoff174"` в словарь

**Время:** 2 мин.

---

## 🟡 P2 — ПОСЛЕ ПЕРВЫХ КЛИЕНТОВ

### 12. Cron auto-sync pipeline

**Task #37.** Только после P0.1–P0.3 (правильный sync, фикс transcription, playwright).

**Состав:**
- `/etc/cron.d/diva-sync` — каждые 2 часа: `diva-sync-pipeline.sh`
- Pipeline steps:
  1. Refresh cookie (если старше 12ч)
  2. GC sync responses
  3. Backfill scripts (manager/funnel/dates/orphan-calls)
  4. Audio batch generator → push to pods (если pods up)
  5. Auto-apply transcripts
  6. Score новых транскриптов
  7. Regenerate insights если новых ≥10
  8. Логирование в `/root/smart-analyze/logs/cron-YYYYMMDD.log`
- Аналогичный cron для amoCRM (`amo-sync-pipeline.sh`) — через webhook + polling

**Время:** 3–4 часа (после готовности P0).

---

### 13. GC endpoints — Wave 2 (из `docs/scans/2026-04-19-getcourse-data-extraction-audit.md`)

Из 31 endpoint'a 5 реализовано. Ещё 12 в Wave 2:
- [ ] `#17` Анкеты / Опросы parser
- [ ] `#19` Mailings + Templates
- [ ] `#20` Products + Streams (cohorts)
- [ ] `#21` Tasks board + Processes
- [ ] `#22` NPS + Affiliate
- [ ] `#24` Revenue-structure + Cumulative
- [ ] `#27` Employers-stat (отчёты сотрудников)

**Эффект:** расширяет surface analytics. Каждый endpoint — ~2 часа парсер + sync-engine интеграция.

**Время:** 20–30 часов суммарно.

---

### 14. amoCRM webhook для real-time stage changes

**Task #33.** Сейчас stage history в amo прилетает только при polling. Webhook `lead_status_changed` → мгновенный апдейт `DealStageHistory`.

**Подзадачи:**
- [ ] Endpoint `/api/webhooks/amocrm/[tenantId]`
- [ ] HMAC validation по client_secret
- [ ] Parser payload → `DealStageHistory.create`
- [ ] Настройка webhook в amo-приложении с URL + subscribed events

**Время:** 2–3 часа.

---

### 15. Quality module — автогенерация CallScore

**Task #35.** После транскрибации автоматом запускать scoring, не руками.

**Подзадачи:**
- [ ] Hook в `apply-transcripts.ts`: после успешного UPDATE транскрипта → enqueue scoring
- [ ] Очередь (Redis BullMQ или simpler — cron-check) для сглаживания RPS DeepSeek
- [ ] Статус CallScore.status: pending / scored / failed

**Время:** 3–4 часа.

---

### 16. Smart-filter пустых транскриптов

**Task #59.** Автоответчики и <30 слов транскрипты засоряют /quality.

**Подзадачи:**
- [ ] В `apply-transcripts.ts` при записи — детектить "автоответчик-like" паттерн (повторы, низкая вариативность, ключевые фразы "пользователь недоступен")
- [ ] Флаг `CallRecord.isNoise: Boolean`
- [ ] Фильтровать в `/quality` по умолчанию

**Время:** 2 часа.

---

### 17. Чистка Manager таблицы (мусор-юзеры)

**Task #60.** В БД есть записи типа "Юлия Морозова — Вселенная" — парсер подцепил что-то кривое. Надо найти все аномалии и удалить/схлопнуть.

**Подзадачи:**
- [ ] `scripts/detect-trash-managers.ts` — heuristics: длинные имена с разделителями "—", "|", кирил+лат смесь, имена короче 3 символов
- [ ] UI для ручной валидации списка (или просто вывод + ручное удаление)

**Время:** 2 часа.

---

### 18. Продолжить enrichment CallRecord

**Сегодня сделано:** duration (445/445 diva).
**Осталось (требует Prisma migration):**
- [ ] `CallRecord.sipuniUuid` — UUID звонка Sipuni (для сверки с телефонией)
- [ ] `CallRecord.endReason` — причина завершения (нормальное / недозвон / сброс)
- [ ] `CallRecord.recordDuration` — длительность записи (vs talk duration)

**Правило в памяти:** `feedback-gc-url-format.md` — "list vs detail, не все поля на списках".

**Время:** 2–3 часа.

---

## 🟢 P3 — ОТЛОЖЕННЫЕ / ПОСЛЕ ПРОДАЖ

### 19. GC endpoints — Wave 3 (Tier 3)

- Funnels + Dashboards (#23)
- Лента ответов учеников (#26)
- Teach controls / stats / diploma

**Время:** 15–20 часов.

---

### 20. RunPod automation

**Memory:** `runpod-api-access.md` — API key NOT на сервере.

**Подзадачи:**
- [ ] Положить API key на сервер через `.env` (попросить у пользователя)
- [ ] Cron: раз в сутки stop неработающих подов (экономия)
- [ ] Cron: start подов при наличии audio-backlog в очереди

**Время:** 2 часа.

---

### 21. Vastu — Sipuni licensing

**Не наш debt.** 14K заблокированных звонков — клиент должен восстановить лицензию экспорта или дать API доступ. Из анкеты vastu.

**Действие:** напомнить в 4-kit анкете / на встрече.

---

### 22. Send anketas to clients

Чек — отправлены ли? (reklama, vastu, shumoff) Ждать заполнения, затем калибровать системы каждого tenant по P1.9.

---

## 📋 Список файлов который надо создать / модифицировать

**Новые скрипты:**
- `scripts/fix-diva-dates.ts`
- `scripts/fix-diva-managerid.ts` (может быть уже есть)
- `scripts/fix-diva-funnel.ts`
- `scripts/validate-diva-integrity.ts`
- `scripts/detect-trash-managers.ts`
- `scripts/diva-sync-pipeline.sh`
- `scripts/amo-sync-pipeline.sh`

**Существующие модификации:**
- `scripts/runpod-transcribe-batch.py` — word_timestamps
- `scripts/apply-transcripts.ts` — сохранять `transcriptRaw`
- `scripts/refresh-gc-cookie.ts` — Playwright вариант
- `src/lib/sync/gc-sync-v2.ts` — `resolveDealId` дотягивает одиночные deals
- `src/app/(dashboard)/patterns/page.tsx` — без цитат в карточке
- `src/app/(dashboard)/deals/[id]/page.tsx` — блок "Упомянутое в паттернах"
- `src/app/(dashboard)/managers/[id]/page.tsx` — ссылки на источник цитат
- `src/app/(dashboard)/quality/page.tsx` — `<PeriodFilter />`
- `src/components/header.tsx` — shumoff174 display name
- `src/lib/queries/managers.ts` — теги с tooltip
- `src/lib/ai/analyze-deal.ts` — записывать `sourceMessageId/sourceCallRecordId` в evidence

**Prisma migrations:**
- `CallRecord.transcriptRaw Jsonb?`
- `CallRecord.sipuniUuid String?`
- `CallRecord.endReason String?`
- `CallRecord.recordDuration Int?`
- `CrmConfig.gcPassword String?` (encrypted)
- `TenantConfig` таблица (main funnel, amount field, excluded managers, custom script, isConfigured)
- `Pattern.evidence` — structured list `[{type: "message"|"call", sourceId, quote, dealId}]`

---

## 📊 Оценка по времени

| Приоритет | Время |
|---|---|
| P0 (блокеры до cron) | 11–17 часов |
| P1 (до первых клиентов) | 22–30 часов |
| P2 (после первых клиентов) | 30–40 часов |
| P3 (отложено) | 20+ часов |

**Разумный MVP-путь:** закрыть P0 + P1.5 + P1.6 + P1.8 + P1.10 + P1.11 = ~20–25 часов = 3–4 полных рабочих дня.

---

## 🗒 Что проверить перед стартом каждой задачи

- `MEMORY.md` — свежие правила
- `docs/scans/2026-04-19-getcourse-data-extraction-audit.md` — GC endpoint catalog
- `docs/plans/2026-04-21-transcription-pipeline-fix.md` — детали pipeline v2
- `memory/feedback-transcription-pipeline.md`
- `memory/feedback-gc-url-format.md`
- `memory/feedback-crm-sync-preflight.md`
- `memory/feedback-server-safety-other-projects.md`
- `memory/salesguru-onboarding-pattern.md`
- TaskList — live статус 64 открытых задач

---

## 🔍 Вне рамок этого файла (но упоминается)

**Идеологические:**
- Blogger-centric paradigm Soldout (2026-03-07) — не относится к smart-analyze
- Soldout законсервирован (2026-04-07) — отдельная история

**Чужие проекты на сервере** (НЕ ТРОГАТЬ):
- qup-bot, investment-bot, soldout, content factory, neuro-manager
- Из `feedback-server-safety-other-projects.md`
