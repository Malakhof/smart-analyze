# GetCourse Adapter Design

**Date:** 2026-04-18
**Status:** Design (требует подтверждения перед реализацией)
**Triggers:** Task #17 (GetCourse: stages/funnels mapping decision), Task #18 (adapter extension)
**Reference:** результаты pre-flight diva.school (`docs/scans/2026-04-18-diva-school-preflight.md`)

---

## 1. Цель

Превратить наивный `GetCourseAdapter` (86 строк, не работает корректно) в production-ready ETL для:

- **diva.school** (249K users, 966K заказов, 982K контактов, 121 менеджер)
- **Будущих клиентов GetCourse** (онбординг через CrmConfig + cookie)

Адаптер должен:
1. Безопасно читать данные клиента (READ-ONLY, whitelist URL)
2. Маппить структуру GetCourse → наши унифицированные модели (`Deal`, `Funnel`, `Stage`, `CallRecord`, `Message`, `Manager`)
3. Поддерживать **дельта-синхронизацию** (только новое с момента последнего sync)
4. Работать через **cron** без участия человека (после первого ручного успешного запуска)

---

## 2. Что есть сейчас (state of the art)

### Существующие файлы

| Файл | LOC | Что делает | Что нужно изменить |
|---|---:|---|---|
| `src/lib/crm/getcourse.ts` | 86 | `GetCourseAdapter` класс | переписать полностью |
| `src/lib/crm/getcourse-parser.ts` | 117 | regex-парсеры HTML | расширить + типизировать |
| `src/lib/crm/getcourse-session.ts` | 42 | Playwright login | оставить, добавить refresh |
| `src/lib/crm/types.ts` | 58 | `CrmDeal`, `CrmManager`, etc | расширить (CallRecord, Message типы уже есть) |

### Известные дефекты текущего кода

```
❌ GetCourseAdapter.getDeals()  возвращает звонки, не сделки
❌ GetCourseAdapter.getFunnels() хардкоженый stub, реальные воронки игнорирует
❌ GetCourseAdapter.getManagers() фильтрует type==="admin", но parser ставит всем "student"
❌ Parser не извлекает дату, тип, длительность из таблицы
❌ Нет пагинации (бьём по limit=1 и не идём дальше)
❌ Нет фильтра по дате (для дельта-sync)
❌ Нет error handling (cookie expired = тихая ошибка)
❌ Нет rate limiting (риск DoS клиента)
```

---

## 3. Whitelist URL (source of truth)

Подтверждены в pre-flight 2026-04-18, фиксируются в коде как **константа**:

```ts
// src/lib/crm/getcourse-urls.ts
export const GC_WHITELIST = {
  // ───── ВСЕГО (для health check / стартовой картины) ─────
  USERS_LIST:    "/pl/user/user/index",
  CONTACTS_ALL:  "/pl/user/contact/index",
  DEALS_ALL:     "/pl/sales/deal",
  PRODUCTS:      "/pl/sales/product/index",
  DEAL_STATS:    "/pl/sales/dealstat/index",

  // ───── С ФИЛЬТРОМ ПО ДАТЕ (для дельта-sync) ─────
  DEALS_BY_DATE:    "/pl/sales/deal/index",     // + DealContext[rule_string] JSON
  CONTACTS_BY_DATE: "/pl/user/contact/index",   // + ContactContext[rule_string] JSON

  // ───── ОДИН ОБЪЕКТ (для деталей) ─────
  CONTACT_DETAIL: "/user/control/contact/update/id/",  // + {id}
  DEAL_DETAIL:    "/sales/control/deal/update/id/",    // + {id} (предположительно)
  USER_DETAIL:    "/user/control/user/update/id/",     // + {id}
} as const

export const GC_BLACKLIST_PATTERNS = [
  /\/delete\b/i,
  /\/save\b/i,
  /\/create\b/i,
  /\/update\b.*[?&](save|submit)/i,
  /\bsendMessage\b/i,
  /\bemailSend\b/i,
  /\bcron\//i,
  /\/admin\/(?!stats|reports)/i,  // /admin/stats ok, /admin/cleanup нет
]
```

**Enforcement:** перед каждым `fetch()` адаптер вызывает `assertSafeUrl(url)` — проверяет что path начинается с одного из `GC_WHITELIST` И не матчит `GC_BLACKLIST_PATTERNS`. Иначе бросает `UnsafeUrlError`.

---

## 4. ETL Mapping (GetCourse → наши Prisma модели)

### 4.1 Funnel

GetCourse имеет два вида "воронок":
- **CRM воронки** (`/pl/tasks/task/kanban/deals?funnelId=920`) — настоящие sales pipelines с этапами
- **Маркетинг автоворонки** (`/chtm/app/builder/v2`) — email/welcome flows, нам не нужны

Маппим только CRM воронки:

| GC source | → | Our Prisma `Funnel` |
|---|---|---|
| `funnelId` (URL param) | → | `crmId` (string) |
| Title из HTML title бара | → | `name` |
| Tenant | → | `tenantId` |

**Этапы воронки** (`Stage`):
- Source: SPA AJAX-эндпоинт (TBD: найдём в JS bundle ИЛИ запросим CSV экспорт у клиента)
- Fallback на v0: если этапы не извлекаются — оставляем 5 дефолтных ("Новый", "В работе", "Ожидает оплаты", "Оплачен", "Отменён") как сейчас

### 4.2 Deal

Source: `/pl/sales/deal/index?DealContext[rule_string]=<JSON>` HTML парсинг таблицы.

| GC source (HTML cell) | → | Our `Deal` field |
|---|---|---|
| `<a href="/sales/control/deal/update/id/{id}">` | → | `crmId` |
| Title в первой колонке | → | `title` |
| Сумма в колонке "Сумма" | → | `amount` (parse "1 234,56 ₽" → 1234.56) |
| Status badge ("Оплачен"/"Новый"/"Отменён") | → | `status` ("won"/"open"/"lost") |
| Менеджер (link на user) | → | `managerId` (его GC user id) |
| `funnelId` из URL/контекста | → | `funnelId` |
| Этап (badge или dropdown) | → | `stageCrmId` |
| Дата создания | → | `createdAt` |
| Дата завершения (если есть) | → | `closedAt` |

**Маппинг статусов:**
```
GC "Оплачен"     → won
GC "Отменён"     → lost
GC "Новый"       → open
GC "В работе"    → open
GC "Ожидает..."  → open
```

### 4.3 CallRecord

Source: `/pl/user/contact/index?ContactContext[rule_string]=<JSON>` + детали через `/user/control/contact/update/id/{id}`.

| GC source | → | Our `CallRecord` field |
|---|---|---|
| `contact/update/id/{id}` | → | `crmId` |
| Менеджер | → | `managerId` |
| Клиент (телефон) | → | `clientPhone` |
| `direction=income/outcome` | → | `direction` |
| Длительность | → | `duration` (seconds) |
| audio MP3 URL | → | `audioUrl` |
| Дата звонка | → | `callDate` |
| Связанная сделка (deal_id) | → | `dealId` (FK) |

⚠️ **Важно:** из 982K "контактов" звонки = подмножество. Фильтруем `direction IN (income, outcome) AND audio_url IS NOT NULL`.

### 4.4 Message

GetCourse не имеет встроенного messenger (как amoCRM чаты). Что есть:
- **Email** — отправляется через систему (мы видим только sent log, не входящие)
- **Заметки в карточке клиента** (notes) — могут содержать переписку

**Решение для v0:** Message не маппим из GetCourse (отдельная фича позже). Фокус на Deal + CallRecord. Это отличается от amoCRM где Message = основной поток.

### 4.5 Manager

Source: parsing fields-фильтра из `/pl/user/contact/index` + `/pl/user/user/index`.

| GC source | → | Our `Manager` field |
|---|---|---|
| user_id из dropdown | → | `crmId` |
| Имя в `<option>` | → | `name` |
| Email из `/pl/user/user/index` (если найдём по id) | → | `email` |

**Фильтрация продажник vs не-продажник** — только по факту: если в течение 90д создал ≥1 `Deal` или `CallRecord` → продажник. Иначе игнорируем для дашборда (но запись в БД есть).

### 4.6 Task

Source: `/pl/tasks/task/kanban/tasks/list` (SPA, нужен AJAX). v0: пропускаем, добавим в v1.

---

## 5. Pagination Strategy

### Проблема
- Diva: 330K сделок и 54K звонков за 90д
- Стандартный pageSize в GetCourse = 25-50 строк
- Полный sync = 13K HTTP запросов = ~3 часа на 1 req/sec

### Решение

**Диапазон + параллелизм:**
1. **Диапазон по дате** — берём последние 7 дней первым sync, потом расширяем
2. **Page size** — пробуем `?per-page=200` (max в Yii2 GridView) — если работает, экономим в 8 раз
3. **Параллельные запросы** — max 3 concurrent (не больше — риск 429)
4. **Кэш страницы** — если уже скачали page=N того же диапазона, пропускаем

**Расчёт времени для diva полный 90д sync:**
```
330K deals / 200 per page = 1,650 pages
54K contacts / 200 per page = 270 pages
≈ 1,920 page requests
+ детали по каждому Deal/Contact = опционально (TBD: нужно ли)
@ 3 concurrent, 1 req/sec average → ~10-15 минут чистого parsing
```

**TBD:** проверить поддерживает ли GetCourse `?per-page=200`. Pre-flight не проверял.

---

## 6. Sync режимы

### 6.1 Full sync (manual / first time)

```ts
async fullSync(tenantId: string, options: {
  daysBack: number      // по умолчанию 90
  dryRun?: boolean      // не пишет в БД, только считает
  limit?: number        // для тестов: max N entities
}): Promise<SyncReport>
```

- Запускается **вручную** через admin route
- Отчёт показывается до записи в БД (если dryRun)
- Idempotent: запуск повторно дополнит, не задублит (UPSERT по `crmId + tenantId`)

### 6.2 Delta sync (cron)

```ts
async deltaSync(tenantId: string): Promise<SyncReport>
```

- Запускается **cron** (раз в N часов, по умолчанию 4)
- Берёт `since = max(Deal.updatedAt WHERE tenantId)` — где остановились
- Скачивает только новые/изменённые записи
- Обновляет `CrmConfig.lastSyncedAt`

### 6.3 Health check (минутный)

```ts
async healthCheck(): Promise<{ok: boolean, error?: string}>
```

- Cron раз в минуту: GET `/pl/user/user/index?limit=1`
- Если 200 — ok
- Если 401/403 → cookie expired, алерт в Telegram + помечаем `CrmConfig.needsReauth = true`

---

## 7. Безопасность (READ-ONLY enforcement)

### Уровень 1: код адаптера
```ts
function assertSafeUrl(url: string): void {
  const path = new URL(url).pathname
  const isWhitelisted = Object.values(GC_WHITELIST).some(p => path.startsWith(p))
  const isBlacklisted = GC_BLACKLIST_PATTERNS.some(re => re.test(path))
  if (!isWhitelisted || isBlacklisted) {
    throw new UnsafeUrlError(`Blocked: ${path}`)
  }
}

function assertSafeMethod(method: string): void {
  if (method !== "GET") {
    throw new UnsafeMethodError(`Only GET allowed, got: ${method}`)
  }
}
```

### Уровень 2: HTTP wrapper
Адаптер использует **обёртку** над `fetch` (`safeFetch`), которая:
- Принудительно ставит `method: "GET"`
- Удаляет `body` если попытались передать
- Логирует каждый запрос в `CrmAuditLog` (URL, status, size, timestamp)
- Rate limit: 1 req/sec per tenant

### Уровень 3: Database constraint
В `CrmConfig` для GetCourse — флаг `readOnlyMode = true` (по умолчанию). Сменить на `false` можно только через admin UI с подтверждением.

---

## 8. Error Handling

| Ошибка | Действие |
|---|---|
| **HTTP 401/403** | mark `needsReauth=true`, alert, остановить sync |
| **HTTP 429** | exponential backoff (2s, 4s, 8s, 16s, max 60s) |
| **HTTP 5xx** | retry до 3 раз, потом alert |
| **HTML title содержит "Вход"** | cookie мёртвый, mark `needsReauth=true` |
| **Parse error** (no rows in HTML) | log warning, продолжить (возможно пустая страница) |
| **Timeout 30s** | log, retry 1 раз; если опять — alert |
| **UnsafeUrlError** | log critical, alert НЕМЕДЛЕННО, остановить весь sync |

---

## 9. Файловая структура

```
src/lib/crm/getcourse/
├── adapter.ts          # GetCourseAdapter — реализует CrmAdapter
├── urls.ts             # GC_WHITELIST + GC_BLACKLIST_PATTERNS
├── safe-fetch.ts       # safeFetch обёртка (read-only enforcement)
├── parsers/
│   ├── deal-list.ts    # парсер /pl/sales/deal HTML
│   ├── contact-list.ts # парсер /pl/user/contact/index HTML
│   ├── user-list.ts    # парсер /pl/user/user/index HTML
│   └── filters.ts      # build Krajee dialog rule_string JSON
├── session.ts          # Playwright login + cookie refresh (существует)
├── pagination.ts       # paginate utility
└── types.ts            # GetCourse-специфичные типы
```

Старые файлы:
- `src/lib/crm/getcourse.ts` → **удаляем** (заменяется на `getcourse/adapter.ts`)
- `src/lib/crm/getcourse-parser.ts` → **удаляем** (логика перенесена в `getcourse/parsers/`)
- `src/lib/crm/getcourse-session.ts` → **переносим** в `getcourse/session.ts`

---

## 10. Phase Plan (что делаем когда)

### Phase 1 — Foundation (сегодня вечер, 2-3 часа)
- [ ] Создать `getcourse/urls.ts` + `safe-fetch.ts`
- [ ] Создать `getcourse/parsers/filters.ts` (Krajee rule_string builder)
- [ ] Тесты: assertSafeUrl, blacklist matching, filter JSON

### Phase 2 — Read parsers (завтра утро, 3-4 часа)
- [ ] `parsers/deal-list.ts`: парсинг таблицы заказов
- [ ] `parsers/contact-list.ts`: парсинг звонков
- [ ] `parsers/user-list.ts`: парсинг менеджеров (полный, не stub)
- [ ] Unit-тесты на сохранённых HTML из `/tmp/gc-scan/`

### Phase 3 — Adapter integration (завтра день, 2-3 часа)
- [ ] `getcourse/adapter.ts`: новый `GetCourseAdapter`
- [ ] `pagination.ts` utility
- [ ] Интеграция с существующим `CrmConfig` (cookie storage)
- [ ] Health check route

### Phase 4 — Test sync на 7 днях (завтра вечер, 30 мин)
- [ ] Создать `CrmConfig` запись для diva.school (зашифрованный cookie)
- [ ] `fullSync(tenantId, {daysBack: 7, dryRun: true})` — отчёт
- [ ] Если ок — `dryRun: false`, запись в БД
- [ ] Проверить: данные видны на дашборде

### Phase 5 — Полный 90д sync (послезавтра)
- [ ] `fullSync(tenantId, {daysBack: 90})` фоном
- [ ] Мониторинг прогресса
- [ ] Финальный дашборд: 121 менеджер, успешность, выручка

### Phase 6 — Cron автоматизация (после стабильного sync)
- [ ] Endpoint `/api/cron/getcourse-sync` (защищён `CRON_SECRET`)
- [ ] Vercel cron / Linux cron каждые 4 часа
- [ ] Telegram alert на ошибки

---

## 11. Open questions (нужны решения)

| # | Вопрос | Default решение | Нужно подтверждение |
|---|---|---|---|
| Q1 | Поддерживает ли GetCourse `?per-page=200`? | пробуем, fallback на 50 | проверить в Phase 1 |
| Q2 | Как достать **этапы воронки** (SPA)? | дефолтные 5 этапов на v0, AJAX в v1 | да |
| Q3 | Mapping `Message` из GC notes/email? | пропускаем v0 | да |
| Q4 | Tasks из `/pl/tasks/task/kanban/tasks/list` SPA? | пропускаем v0 | да |
| Q5 | Где хранить cookie? **CrmConfig.gcCookie зашифрованный** | да, AES-256-GCM | подтверждено |
| Q6 | Что делать с 121 менеджером где не все продажники? | sync всех, фильтр на дашборде по факту активности | да |
| Q7 | Период по умолчанию для full sync diva? | 90 дней (как делали reklama/vastu) | да |

---

## 12. Что НЕ делаем в v0 (явно вне scope)

- ❌ Запись в GetCourse (создание/изменение сделок) — только READ
- ❌ Webhook от GetCourse → нас — нужно настраивать на их стороне, оставим в Phase 7
- ❌ Импорт email-переписок (требует SMTP/IMAP интеграцию отдельно)
- ❌ Импорт уроков/курсов (это `/pl/teach/...`, это про обучение, не CRM)
- ❌ Sync в реальном времени (cron 4ч достаточно для аналитики)

---

## 13. Risk register

| Риск | Вероятность | Impact | Mitigation |
|---|---|---|---|
| GetCourse меняет HTML structure | средняя | high | parser-тесты на сохранённых HTML, alert на parse failure |
| Cookie протухает чаще чем думаем | средняя | medium | health check 1/min, auto-refresh через Playwright |
| Rate limit hit (429) | низкая | low | exp backoff, max 1 req/sec |
| Случайный POST/PUT в коде | низкая | CRITICAL | safeFetch enforcement + tests |
| Доступ к чужому tenant data | низкая | CRITICAL | requireTenantId everywhere, integration test |
| Неверный parse → плохие данные на дашборде | средняя | medium | sample validation, dryRun режим |

---

## 14. Approval

Перед началом Phase 1 нужно подтвердить:
- [ ] Архитектура файловой структуры (раздел 9) ок
- [ ] Phase plan (раздел 10) ок
- [ ] Open questions (раздел 11) — ответы на Q2, Q3, Q4, Q6, Q7

После approve → начинаю Phase 1.
