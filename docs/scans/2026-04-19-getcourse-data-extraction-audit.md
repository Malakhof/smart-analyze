# GetCourse Data Extraction Audit — 2026-04-19

**Source:** diva.school (live cookie session)
**Method:** Probed every menu item from real `window.gcAccountUserMenu` JSON.
**Goal:** Single source of truth — what we can extract, what we currently extract, what's missing.

## TL;DR

Из ~25+ ценных endpoint'ов GC у diva мы реально берём **5**. Полнота извлечения **≈20%**.
Главные слепые зоны: **Анкеты** (структурированные ответы клиентов), **Канбан-стадии**, **Готовая статистика** (4 таба × 6 периодов), **Bot-сообщения**, **Шаблоны/Рассылки**.

---

## ✅ Что сейчас извлекаем (реализовано)

| Endpoint | Статус | Парсер |
|---|---|---|
| `/pl/user/user/index` | ✅ | `parsers/user-list` (page 1 only) |
| `/pl/user/contact/index` | ✅ | `parsers/contact-list` |
| `/pl/sales/deal` | ✅ | `parsers/deal-list` |
| `/pl/tasks/resp/models-list` | ✅ | `parsers/responses` |
| `/pl/tasks/resp/model-view?id={X}&withHistory=1` | ✅ | `parsers/conversation` |

**Всё.** 5 источников.

---

## 🔴 TIER 1 — критично для AI-аналитики, НЕ извлекаем

### 1. Анкеты / Опросы — `/user/control/survey/index`

**Что это:** Список всех анкет которые админ создал для квалификации клиентов / сбора лидов / голосований.

**Endpoint списка:** `/user/control/survey/index` (HTML с гридом)
**Endpoint ответов:** `/pl/user/survey-answer/list/?surveyId={ID}` — отдельный список для каждой анкеты

**Сколько у diva:** 30+ surveyId (видны в HTML — от 101768 до 250323)

**Зачем критично:** Это **прямой структурированный voice-of-customer** — клиент сам отвечает на квалифицирующие вопросы (цели, бюджет, проблемы, опыт). DeepSeek получает структурированный материал для паттернов "что отвечают те кто покупает vs кто отваливается".

**Tier:** 🔴 CRITICAL для Phase 2

### 2. Канбан с этапами (Доска заказов) — `/pl/tasks/task/kanban/deals`

**Что это:** Канбан-доска сделок с колонками = этапами воронки. Видели у diva: Лид → Платный → Контакт → Квалификация → Презентация → Счёт → Рассрочка → ВЫИГРАНО/ПРОИГРАНО.

**Endpoint:** `/pl/tasks/task/kanban/deals?funnelId={X}` (HTML SPA — 66KB)
**AJAX-endpoint для данных:** **НЕИЗВЕСТЕН** (нужен Network capture от пользователя)

**Зачем критично:** Сейчас в БД у нас flat status (won/open/lost). Где сделки **застревают** — ноль информации. Без этого не сделать "узкое место воронки" / "конверсия по этапам" — главные метрики РОПа.

**Tier:** 🔴 CRITICAL для Phase 2 dashboard

### 3. Статистика продаж (4 таба) — `/pl/sales/dealstat/index`

**Что это:** Готовая агрегированная статистика. **Не нужно пересчитывать.**

**4 таба:**
- Таблица: 6 периодов (сегодня/вчера/месяц/прошлый/год/all-time) × 9 метрик
- График: помесячная динамика (Highcharts)
- Накопительная: cumulative growth
- Структура выручки: revenue mix

**Фильтры:** по менеджеру, по продукту, по любому полю.

**Размер HTML:** 287KB (большая страница, AJAX внутри для смены табов)

**diva all-time:** 24,675 заказов / 15,750 оплачено / 277.7M₽ заработано / средний чек 18,599₽
**Что мы видим в БД:** ~893K₽ = **0.32%** от реальности.

**Tier:** 🔴 CRITICAL — берём готовое, не пересчитываем

### 4. Bot-сообщения / Filebrain — `~filebrain-get-bot-messages?conversationId={X}`

**Что это:** Авто-рассылки от ботов (DIVAonline_bot, botDIVAbot и т.п.) внутри тредов. Visible в Network DevTools при открытии любого треда.

**Endpoint:** `~filebrain-get-bot-messages?conversationId={X}` (под `/pl/tasks/resp/` host)

**Зачем критично:** Это **весь авто-прогрев** который видит клиент. Без этого DeepSeek не понимает контекст — почему клиент дошёл до диалога с менеджером.

**Tier:** 🔴 CRITICAL для Phase 2 DeepSeek

---

## 🟡 TIER 2 — high value, НЕ извлекаем

### 5. Шаблоны сообщений — `/pl/notifications/control/mailings/templates-list`
**Размер:** 76KB. Эталоны скриптов менеджеров. Сравнение "следует ли менеджер скрипту".

### 6. Рассылки — `/notifications/control/mailings` (redirects to `/pl/notifications/control/mailings/active`)
**Размер:** 195KB. Список email/SMS-рассылок + кому отправлено + когда.

### 7. Статистика рассылок — `/pl/notifications/control/mailings/stat`
**Размер:** 68KB. Open/click/conversion per email. Какие письма работают.

### 8. Отчёты сотрудников — `/pl/user/employers-stat/index`
**Размер:** 135KB. Аналитика по менеджерам — нагрузка, активность, ответы.

### 9. Продукты — `/pl/sales/product/index`
**Размер:** 113KB. Каталог продуктов с ценами. Нужно для unit economics.

### 10. Партнёрская программа — `/sales/control/participant`
**Размер:** 74KB. Affiliate — кто привёл лида. Атрибуция источника.

### 11. Потоки / Когорты — `/pl/sales/stream/stream-stat`
**Размер:** 169KB. Когортный анализ — кто в каком наборе.

### 12. Платёжный модуль — `/pl/gcpay/client/payment`
**Размер:** 93KB. Детали платежей: рассрочки, методы, возвраты.

### 13. Доска задач — `/pl/tasks/task/kanban/tasks/kanban` + `/pl/tasks/task/kanban/tasks/list`
**Размер:** 66KB. Канбан задач менеджеров (звонки, встречи). Нагрузка по людям.

### 14. Статистика задач — `/pl/tasks/task/stat`
**Размер:** 405KB! Очень большая страница. Аналитика задач — выполненные/просроченные.

### 15. Процессы / Mission — `/pl/tasks/mission/index`
**Размер:** 114KB. Бизнес-процессы (auto-флоу прогрева). В каких процессах клиент.

### 16. Воронки CRM (старые) — `/pl/logic/funnel`
**Размер:** 109KB. Дизайн воронки + дашборды по воронкам.

### 17. Структура выручки — `/pl/crm/stat/revenue-structure`
**Размер:** 95KB. Готовая аналитика структуры выручки.

### 18. Накопительная — `/pl/sales/stat/cumulative`
**Размер:** 106KB. Cumulative stats.

---

## 🟢 TIER 3 — обучение, потенциал но не первый приоритет

### Контроль качества обучения — `/teach/control/stat/userTrainingFeedback`
**Размер:** 67KB. NPS / отзывы клиентов на обучение.

### Лента ответов учеников — `/teach/control/answers/unanswered`
**Размер:** **790KB!** Огромная — это ответы учеников на задания. Текст для DeepSeek (фидбэк по обучению).

### Тесты — `/pl/teach/questionary` (116KB)
### Тренинги — `/teach/control/stream` (375KB)
### Расписание — `/pl/teach/control/schedule` (129KB)
### Дипломы — `/pl/teach/control/diploma` (71KB)
### Цели — `/pl/teach/goal` (68KB)

---

## 🚫 Tier 4 — есть, но мало ценности для AI-аналитики

- `/saas/account/qualityMarkSettings` — только settings (63KB), реальные отзывы где-то ещё
- `/sales/control/userProduct/my` — мои покупки текущего юзера (59KB)
- `/pl/notifications/settings/my` — настройки нотификаций (130KB)

---

## ❌ Существуют, но НЕ подключены у diva

- `/chtm/app/conversation2analytics` — **"Аналитика переписок"** (17KB лендинг). Это GC-приложение которое УЖЕ делает то что мы строим. Не подключено у diva.
- `/chtm/app/sender/v2` — Боты (91KB)
- `/chtm/app/gc-messengers` — Мессенджеры (8KB)
- `/chtm/app/filebrainpro` — AI-ассистент (12KB лендинг)

---

## Полный список рабочих endpoint'ов (HTTP 200)

| Endpoint | Size | Section | Implemented? |
|---|---|---|---|
| `/pl/user/user/index` | 379K | Ученики | ✅ |
| `/pl/user/contact/index` | 187K | Ученики | ✅ |
| `/user/control/survey/index` | 91K | Ученики | ❌ КРИТ |
| `/pl/logic/funnel` | 109K | Ученики | ❌ |
| `/pl/tasks/task/kanban/deals` | 66K | CRM | ❌ КРИТ |
| `/pl/tasks/task/kanban/tasks/kanban` | 66K | CRM | ❌ |
| `/pl/tasks/task/kanban/tasks/list` | 66K | CRM | ❌ |
| `/pl/tasks/task/my` | 145K | CRM | ❌ |
| `/pl/tasks/task/stat` | 405K | CRM | ❌ |
| `/pl/tasks/mission/index` | 114K | CRM | ❌ |
| `/pl/tasks/resp` | 74K | Сообщения | ✅ |
| `/notifications/control/mailings` | 195K | Сообщения | ❌ |
| `/pl/notifications/control/mailings/templates-list` | 76K | Сообщения | ❌ |
| `/pl/notifications/control/mailings/stat` | 68K | Сообщения | ❌ |
| `/pl/user/employers-stat/index` | 135K | Сообщения | ❌ |
| `/pl/sales/deal` | 553K | Продажи | ✅ |
| `/pl/sales/product/index` | 113K | Продажи | ❌ |
| `/sales/control/participant` | 74K | Продажи | ❌ |
| `/sales/control/userProduct/my` | 59K | Продажи | ❌ |
| `/pl/sales/stream/stream-stat` | 169K | Продажи | ❌ |
| `/pl/gcpay/client/payment` | 93K | Продажи | ❌ |
| `/pl/sales/dealstat/index` | 287K | Статистика | ❌ КРИТ |
| `/pl/crm/stat/revenue-structure` | 95K | Статистика | ❌ |
| `/pl/sales/stat/cumulative` | 106K | Статистика | ❌ |
| `/teach/control/stream` | 375K | Обучение | ❌ |
| `/pl/teach/control/schedule` | 129K | Обучение | ❌ |
| `/teach/control/answers/unanswered` | 790K | Обучение | ❌ |
| `/pl/teach/questionary` | 116K | Обучение | ❌ |
| `/pl/teach/control/diploma` | 71K | Обучение | ❌ |
| `/pl/teach/goal` | 69K | Обучение | ❌ |
| `/teach/control/stat/userTrainingFeedback` | 67K | Обучение | ❌ |

---

## AJAX endpoints — что дополнительно нужно ловить

Каждая HTML-страница из таблицы — **SPA-shell**. Реальные данные грузятся отдельными AJAX. Уже подтверждены:

- `/pl/tasks/resp/models-list` — JSON list of resp ✅ implemented
- `/pl/tasks/resp/model-view?id={X}&withHistory=1` — JSON+HTML conversation ✅ implemented
- `~filebrain-get-bot-messages?conversationId={X}` — bot messages ❌

**Need Network capture for:**
- `/pl/tasks/task/kanban/deals` — какой AJAX отдаёт колонки + сделки → этапы
- `/pl/sales/dealstat/index` — какой AJAX переключает табы (Таблица/График/Накопительная/Структура)
- `/user/control/survey/index` → `/pl/user/survey-answer/list/?surveyId=X` — формат ответов
- `/pl/notifications/control/mailings/active` — list endpoint
- `/pl/sales/product/index` — list endpoint
- `/pl/sales/stream/stream-stat` — stats endpoint

---

## Priority order для implementation (по value/effort)

### Wave 1 (для Phase 2 DeepSeek и dashboard)
1. **Sales-stat (`/pl/sales/dealstat/index`)** — готовая агрегация без обработки сделок
2. **Анкеты (`/pl/user/survey-answer/list/?surveyId=X`)** — voice-of-customer для DeepSeek
3. **Канбан-стадии (`/pl/tasks/task/kanban/deals`)** — этапы воронки (требует Network capture)
4. **Bot messages (`~filebrain-get-bot-messages`)** — добавить в writeResponseThread

### Wave 2 (расширение анализа)
5. Шаблоны (для compliance: следует ли менеджер скрипту)
6. Отчёты сотрудников
7. Продукты + Потоки
8. Платёжный модуль (для cohort retention)

### Wave 3 (когда дойдём до обучения)
9. Лента ответов учеников
10. NPS обучения
11. Тесты + Тренинги

---

## Что менять в `urls.ts` whitelist

Текущий whitelist пропустит только наши 5 endpoint'ов. Для расширения нужно добавить:

```typescript
// Анкеты
"/user/control/survey",
"/pl/user/survey-answer/list",
// Статистика (готовая)
"/pl/sales/dealstat",
"/pl/sales/stat",
"/pl/crm/stat",
// Сообщения
"/pl/notifications/control",
"/notifications/control/mailings",
"/pl/user/employers-stat",
// Продажи extras
"/pl/sales/product",
"/pl/sales/stream",
"/sales/control/participant",
"/pl/gcpay/client",
// CRM
"/pl/tasks/task/kanban",
"/pl/tasks/task/stat",
// Обучение (Wave 3)
"/teach/control",
"/pl/teach",
```

И сохранить blacklist patterns (никаких /save/, /delete/, /create/).
