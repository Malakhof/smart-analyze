# План запуска SalesGuru для amoCRM + GetCourse клиентов

> **Status:** Утверждён
> **Date:** 2026-04-15
> **Goal:** Первый платящий клиент за 4 дня

---

## БЛОКЕРЫ (без этого нельзя пускать клиентов)

| # | Что | Почему критично | Время |
|---|-----|----------------|-------|
| 1 | **Фикс getTenantId()** — 12 мест в коде | Второй клиент увидит данные первого | 2-3 часа |
| 2 | **Auth middleware** — dashboard публичный | Любой без логина видит все данные | 1 час |
| 3 | **Tenant filter в detail queries** — deal, call, manager | Cross-tenant доступ по ID | 1 час |

## ВЫСОКИЙ ПРИОРИТЕТ (первая неделя)

| # | Что | Почему | Время |
|---|-----|--------|-------|
| 4 | **GetCourse adapter** — Playwright login + HTTP парсинг | Клиенты на GC, без этого нет продукта для них | 1-2 дня |
| 5 | **Шифрование API ключей** — plaintext в БД | Утечка БД = доступ ко всем CRM клиентов | 2 часа |
| 6 | **Auth в audio proxy** — `/api/audio` без проверки | Аудио звонков доступно без логина | 30 мин |
| 7 | **GETCOURSE в CrmProvider enum** — Prisma migration | Без этого не сохранить конфиг GC клиента | 30 мин |

## СРЕДНИЙ ПРИОРИТЕТ (первые 2 недели)

| # | Что | Почему | Время |
|---|-----|--------|-------|
| 8 | Onboarding wizard | Сейчас клиент сам ковыряется в настройках | 1 день |
| 9 | Background job queue | Sync/analysis блокирует request, таймауты | 1 день |
| 10 | Rate limiting per tenant | Один клиент может положить сервер | 2 часа |
| 11 | Per-tenant AI prompts | Разные индустрии — разные паттерны | 3 часа |

---

## Критический путь: 4 дня до первого счёта

### День 1: Multi-tenancy + Security (пункты 1-3)

**Без этого НЕЛЬЗЯ пускать второго клиента.**

- [ ] Создать `requireAuth()` helper в `src/lib/auth.ts`
- [ ] Создать `middleware.ts` — redirect на /login если нет сессии
- [ ] Заменить `getTenantId()` в 12 местах:
  - `src/lib/queries/dashboard.ts` (главный источник)
  - `src/app/(dashboard)/page.tsx`
  - `src/app/(dashboard)/quality/page.tsx`
  - `src/app/(dashboard)/managers/page.tsx`
  - `src/app/(dashboard)/patterns/page.tsx`
  - `src/app/api/settings/crm/route.ts`
  - `src/app/api/settings/scripts/route.ts`
  - `src/app/api/settings/telegram/route.ts`
- [ ] Удалить функцию `getTenantId()` из dashboard.ts
- [ ] Добавить tenant filter в detail queries:
  - `src/lib/queries/deal-detail.ts` — getDealDetail(dealId, tenantId)
  - `src/lib/queries/quality.ts` — getCallDetail(callId, tenantId)
  - `src/lib/queries/quality.ts` — getManagerQuality(managerId, tenantId)
- [ ] Тест: создать 2 тенанта, проверить изоляцию данных

### День 2: GetCourse Adapter MVP (пункты 4, 7)

**Без этого нет продукта для GetCourse клиентов.**

- [ ] Добавить `GETCOURSE` в CrmProvider enum + Prisma migration
- [ ] Playwright login → получение PHPSESSID cookie
- [ ] HTTP парсинг с cookie:
  - Список звонков: GET `/pl/user/contact/index` → парсинг таблицы
  - Карточка звонка: GET `/user/control/contact/update/id/{id}` → транскрибация, аудио URL
  - Список пользователей: GET `/pl/user/user/index` → email, ID, менеджер
  - Карточка юзера: GET `/user/control/user/update/id/{id}` → переписка, заказы
- [ ] Маппинг GC данных → наша модель (Deal, Manager, Message, CallRecord)
- [ ] Settings UI: "Connect GetCourse" → поля email/password сотрудника

### День 3: Массовый Pipeline + Security (пункты 5, 6, 9*)

**Это и есть продукт — 100 звонков за 3 часа.**

- [ ] Массовый HTTP pipeline:
  - Получить список всех звонков
  - Для каждого: парсинг карточки → аудио URL → Whisper → DeepSeek → БД
  - **Скорость: HTTP запрос ~0.5 сек, Whisper+DeepSeek ~2 мин/звонок**
  - **100 звонков = ~3 часа полный анализ (параллельно: 45 мин на 4 потока)**
  - Нет API лимитов — обычные HTTP запросы с cookie
- [ ] Шифрование API ключей (AES-256-GCM)
- [ ] Auth в audio proxy `/api/audio`
- [ ] Тест полного цикла: GC → парсинг → Whisper → анализ → дашборд

### День 4: Первый клиент → 50K₽

- [ ] Клиент приглашает нас как специалиста (4 клика + 3 галочки)
- [ ] Мы логинимся → ставим себе полные права (28 галочек)
- [ ] Запускаем массовый парсинг звонков
- [ ] Whisper расшифровывает → DeepSeek анализирует
- [ ] Клиент видит дашборд sa.qupai.ru с результатами
- [ ] **Выставляем счёт 50K₽**

---

## Производительность массового pipeline (ДОКАЗАНО 2026-04-15)

```
Playwright (раз в месяц) → логин → cookie PHPSESSID
        ↓
HTTP с cookie (БЕЗ ЛИМИТОВ, это не API):
        ↓
GET /pl/user/contact/index         → список ВСЕХ звонков     ✅ 200 OK
GET /user/control/contact/update/id/{id} → карточка звонка   ✅ 200 OK  
GET /pl/user/user/index            → список пользователей     ✅ 200 OK
GET /user/control/user/update/id/{id}   → карточка юзера     ✅ 200 OK

Один HTTP запрос:           ~0.5 сек
100 звонков парсинг:        ~50 сек
Whisper + DeepSeek:         ~2 мин на звонок
100 звонков полный анализ:  ~3 часа (1 поток) / ~45 мин (4 потока)
Cookie живёт:               ~30 дней
```

---

## Онбординг клиента GetCourse

**Клиент делает (3 минуты):**
1. Ученики → Пригласить специалиста → email: malakhoff@gmail.com
2. Карточка сотрудника → Права → 3 галочки:
   - Может настраивать аккаунт
   - Может управлять правами администраторов и сотрудников
   - Является менеджером

**Мы делаем (автоматически):**
1. Логинимся → ставим себе остальные 25 прав
2. Запускаем массовый парсинг
3. Через 3 часа — дашборд готов

---

## Юридика

- NDA: `docs/legal/nda-template.md` (наш шаблон)
- NDA клиента: добавляем пункты 11-13 (защита ИС + результатов + штраф 300K)
- Security disclaimer: `docs/legal/security-disclaimer.md`

---

## Детальные экспертные анализы

- `docs/plans/2026-04-15-getcourse-multitenancy-design.md` — полный план из deep thinking
- `docs/plans/experts/1-8-*.md` — 8 экспертных анализов
