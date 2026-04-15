# GetCourse Integration + Multi-Tenancy: Полный план

> **Status:** Research complete
> **Date:** 2026-04-15
> **Goal:** Запустить первого платящего GetCourse-клиента за 4 дня. Выстроить multi-tenancy, интеграцию с GetCourse и телефонией.

---

## Table of Contents

1. [Overview](#overview)
2. [GetCourse API & Звонки](#1-getcourse-api--звонки)
3. [Multi-Tenancy](#2-multi-tenancy)
4. [CRM Абстракция](#3-crm-абстракция)
5. [Onboarding Flow](#4-onboarding-flow)
6. [Воронки & Паттерны](#5-воронки--паттерны)
7. [Безопасность](#6-безопасность)
8. [Аудит Архитектуры](#7-аудит-архитектуры)
9. [Implementation Plan](#implementation-plan)
10. [Success Metrics](#success-metrics)

---

## Overview

### Ситуация

SalesGuru (sa.qupai.ru) — AI-РОП платформа, сделана за выходные. В среду уже очередь клиентов по 50K₽/мес. **ВСЕ клиенты на GetCourse** (платформа для курсов/экспертов), а у нас пока только amoCRM.

### Главные открытия

1. **GetCourse НЕ хранит звонки.** Звонки в внешней телефонии (Novofon/Zadarma, Mango, Sipuni). Нужен dual-adapter: GC для заказов + телефония для звонков.
2. **Multi-tenancy на 90% готов.** Prisma schema, JWT session, sync engine — всё с tenantId. Сломаны только 3 settings роута + 4 страницы dashboard (используют `getTenantId()` = `findFirst()` без фильтра).
3. **GetCourse API — export-only, async.** Старт задачи → poll результата. 100 запросов / 2 часа. Но есть вебхуки (push-модель) — проще и быстрее.
4. **Первый счёт на Day 4, не Day 30.** Concierge MVP: ручное создание тенанта + webhook receiver + ручной upload звонков.

### Key Decisions

| Аспект | Решение |
|--------|---------|
| GetCourse интеграция | Dual-adapter: GC Export API для заказов + Novofon/Zadarma API для звонков. MVP: webhook receiver + ручной upload MP3 |
| Multi-tenancy | Shared DB с tenant_id (уже сделано). Фикс: `requireAuth()` helper вместо сломанного `getTenantId()` |
| CRM абстракция | Extended interface с `capabilities` (hasFunnels, hasDeals, hasCalls...). Телефония — отдельный адаптер |
| Onboarding | 3-step wizard: платформа → credentials + тест → preview. MVP: concierge (ручная настройка) |
| Воронки из GC | Синтетические воронки по продуктам/офферам. Статусы заказов = стадии. `payed` = единственный WIN |
| Безопасность | P0: фикс tenant isolation (1 час). P1: AES-256-GCM шифрование API ключей (2 часа) |
| Приоритизация | Hybrid concierge + progressive automation. Day 1-2 multi-tenancy + webhook, Day 3 call upload, Day 4 первый клиент |

---

## 1. GetCourse API & Звонки

> **Experts:** Theo Browne (API Design), Sam Newman, Martin Kleppmann
> **Full analysis:** `docs/plans/experts/1-getcourse-api.md`

### GetCourse API

- **Auth:** POST с `key={secret_key}` параметром
- **URL:** `https://{account_name}.getcourse.ru/pl/api/{endpoint}`
- **Export (async 2-step):** POST → получаем `export_id` → GET poll до `status: "exported"`
- **Rate limits:** 100 exports / 2 часа, по одному за раз
- **Доступно:** users, deals (=orders), payments, groups, fields

### Маппинг GetCourse → CrmAdapter

| CrmAdapter | GetCourse | Примечание |
|-----------|-----------|------------|
| CrmDeal | Order (заказ) | id, status, cost, user, manager |
| CrmFunnel | Синтетический по продуктам | Или статусы заказов как стадии |
| CrmManager | `manager_email` из заказов | Нет прямого списка сотрудников |
| CrmMessage | **НЕТ** | GC не хранит переписку/звонки |

### Звонки — критический gap

**GetCourse НЕ хранит звонки.** Интегрируется с:
- **Novofon/Zadarma** — хорошо документированный API, записи звонков доступны
- **onlinePBX** — менее документирован
- **Mango Office, Sipuni** — внешние сервисы

**Решение: dual-adapter**
```
GetCourse → заказы/менеджеры → Deal, Manager
Novofon API → история звонков + записи → CallRecord, Message(isAudio=true)
Связь: по номеру телефона клиента
```

### MVP: вебхуки + ручной upload
1. Клиент настраивает webhook в GetCourse процессах → заказы приходят автоматически
2. Звонки: клиент загружает MP3 вручную (или отправляет в Telegram)
3. WhisperX транскрибирует → DeepSeek анализирует

---

## 2. Multi-Tenancy

> **Experts:** Sam Newman, Troy Hunt, Martin Fowler
> **Full analysis:** `docs/plans/experts/2-multi-tenancy.md`

### Текущее состояние: 90% готово

**Что работает:**
- Schema: `tenantId` на всех сущностях
- Auth: NextAuth JWT с `tenantId` и `role` в session
- Registration: создаёт Tenant + User(OWNER) в транзакции
- 7+ API routes: правильно используют `session.user.tenantId`
- Sync engine: все запросы с `tenantId` фильтром

**Что сломано: `getTenantId()`**
```typescript
// СЛОМАНО — возвращает ПЕРВЫЙ тенант в БД
async function getTenantId() {
  const tenant = await db.tenant.findFirst({ select: { id: true } })
  return tenant?.id ?? null
}
```

Используется в **12 местах**: 4 страницы dashboard + 3 API route файла (8 endpoints).

### Решение: `requireAuth()` helper

```typescript
// src/lib/auth.ts — добавить
export async function requireAuth() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) throw new Error("Unauthorized")
  return { userId: session.user.id, tenantId: session.user.tenantId, role: session.user.role }
}
```

**Фикс:** заменить `getTenantId()` во всех 12 местах → 1-2 часа работы.

### DB стратегия: Shared DB с tenant_id

Оставляем как есть. Schema-per-tenant и DB-per-tenant — overkill для текущего масштаба (<100 тенантов). Prisma Extensions для автоматического tenant filtering — позже, когда команда вырастет.

---

## 3. CRM Абстракция

> **Experts:** Sam Newman, Martin Fowler, Matt Pocock
> **Full analysis:** `docs/plans/experts/3-crm-abstraction.md`

### Решение: Extended Interface с Capabilities

```typescript
interface CrmCapabilities {
  hasFunnels: boolean
  hasDeals: boolean
  hasMessages: boolean
  hasCalls: boolean
  hasManagers: boolean
}

interface CrmAdapter {
  capabilities: CrmCapabilities
  testConnection(): Promise<boolean>
  getFunnels(): Promise<CrmFunnel[]>
  getDeals(funnelId?: string, since?: Date): Promise<CrmDeal[]>
  getMessages(dealCrmId: string): Promise<CrmMessage[]>
  getManagers(): Promise<CrmManager[]>
}
```

Sync engine добавляет ~10 строк guards:
```typescript
if (adapter.capabilities.hasFunnels) {
  const funnels = await adapter.getFunnels()
  // sync funnels...
}
```

### GetCourse adapter
- `hasDeals: true` — заказы через Export API
- `hasManagers: true` — manager_email из заказов
- `hasFunnels: true` — синтетические по продуктам
- `hasMessages: false` — нет переписки в GC
- `hasCalls: false` — звонки через отдельный telephony adapter

### Telephony adapter (отдельно)
- Novofon/Zadarma: `hasCalls: true`, `hasMessages: false`
- Подключается как ДОПОЛНИТЕЛЬНАЯ интеграция к GC тенанту
- Связь через номер телефона

---

## 4. Onboarding Flow

> **Experts:** Nir Eyal, Theo Browne, Troy Hunt
> **Full analysis:** `docs/plans/experts/4-onboarding.md`

### MVP: Concierge (ручная настройка)

1. Клиент платит → мы создаём tenant + user вручную
2. Генерируем GetCourse webhook URL → отправляем клиенту со скриншотами
3. Клиент вставляет URL в GetCourse процессы (5 мин)
4. Заказы текут автоматически
5. Звонки: клиент загружает MP3 / отправляет в Telegram
6. Мы запускаем анализ → клиент видит дашборд

### Будущее: 3-Step Wizard

**Step 1:** Выбор платформы (amoCRM / GetCourse / Bitrix24)
**Step 2:** Credentials + Test Connection
- GetCourse: `account_name` + `secret_key`
- Тест: экспорт 1 пользователя → проверка ключа
**Step 3:** Preview sync (показываем первые данные)

### Верификация подключения GetCourse

1. DNS check: `{account}.getcourse.ru` резолвится
2. API key: POST export request → структурированный JSON ответ
3. Permissions: проверяем что ключ имеет права на чтение
4. Тариф: API доступен только на платных тарифах GC

---

## 5. Воронки & Паттерны

> **Experts:** Sam Newman, Theo Browne, Martin Fowler
> **Full analysis:** `docs/plans/experts/5-funnels-patterns.md`

### GetCourse ≠ CRM. Другая модель продаж.

| amoCRM (B2B) | GetCourse (курсы/эксперты) |
|-------------|---------------------------|
| Pipeline со стадиями | Статусы заказов |
| Deal = сделка | Order = заказ |
| Менеджер ведёт клиента | Автоворонка ведёт клиента |
| Звонки, переписка | Вебинары, email-цепочки |
| Win = закрытие сделки | Win = оплата (payed) |

### Маппинг статусов

| GetCourse | DealStatus | Комментарий |
|-----------|-----------|-------------|
| `new`, `in_work`, `payment_waiting`, `pending`, `not_confirmed`, `part_payed` | OPEN | В процессе |
| `payed` | WON | Оплачен = успех |
| `cancelled`, `waiting_for_return` | LOST | Отмена/возврат |

### Синтетические воронки

Вариант A (MVP): одна воронка со статусами заказов как стадиями
```
[new] → [in_work] → [payment_waiting] → [payed ✓] / [cancelled ✗]
```

Вариант B (будущее): воронка per product/offer
```
"Курс по маркетингу": [new → in_work → payed]
"Консультация":       [new → payment_waiting → payed]
```

### AI анализ для GetCourse

Так как переписки нет в GC, AI анализирует:
1. **Звонки** (из телефонии) — основной источник для скоринга
2. **Паттерны заказов** — конверсия по продуктам, менеджерам, UTM
3. **Воронка** — где теряются заказы (какой статус → cancelled)

Нужен **отдельный FUNNEL_ANALYSIS_PROMPT** для AI — анализ order-flow вместо conversations.

---

## 6. Безопасность

> **Experts:** Troy Hunt, Sam Newman, Martin Kleppmann
> **Full analysis:** `docs/plans/experts/6-security.md`

### P0: Фикс ДО первого клиента (1-2 часа)

| # | Проблема | Импакт | Фикс |
|---|---------|--------|------|
| V1 | `getTenantId()` = утечка между тенантами | Тенант A видит данные тенанта B | `requireAuth()` helper, заменить в 12 местах |
| V2 | Dashboard без auth middleware | Любой видит данные без логина | Добавить `middleware.ts` с redirect на /login |
| V3 | Detail queries без tenant filter | Cross-tenant доступ по ID | Добавить `tenantId` в getCallDetail, getDealDetail |

### P1: Фикс до 5 клиентов (2-4 часа)

| # | Проблема | Фикс |
|---|---------|------|
| V4 | API ключи в plaintext | AES-256-GCM шифрование (app-level) |
| V5 | Audio proxy без auth | Добавить session check в `/api/audio` |
| V6 | Single entity routes без tenant check | Проверка ownership в analyze/deal, quality/score, transcribe |
| V7 | Нет rate limiting | Базовый rate limit per tenant |

### Шифрование API ключей (рекомендация)

```typescript
// src/lib/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
const KEY = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex') // 32 bytes

export function encrypt(text: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', KEY, iv)
  const encrypted = Buffer.concat([cipher.update(text), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decrypt(data: string): string {
  const [ivHex, tagHex, encHex] = data.split(':')
  const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString()
}
```

---

## 7. Аудит Архитектуры

> **Experts:** Sam Newman, Troy Hunt, Martin Fowler
> **Full analysis:** `docs/plans/experts/7-architecture-audit.md`

### 4 критических бага

| # | Баг | Файлы | Решение |
|---|-----|-------|---------|
| C1 | `getTenantId()` = первый тенант в БД | dashboard.ts + 4 pages + 3 API routes (12 мест) | `requireAuth()` |
| C2 | Нет auth middleware — дашборд публичный | Нет middleware.ts | Создать middleware.ts |
| C3 | Settings API без аутентификации | crm, scripts, telegram route.ts | Добавить session check |
| C4 | Detail queries без tenant filter | deal-detail.ts, quality.ts | Добавить tenantId параметр |

### Что уже работает правильно

- Prisma schema — полностью tenant-aware
- Sync engine — корректно scoped
- JWT session — правильно несёт tenantId
- Registration — создаёт Tenant + OWNER в транзакции
- CRM adapter pattern — чисто расширяем на GetCourse
- AI pipeline (batch mode) — правильно фильтрует по tenant

### Ключевые файлы для изменений

```
ФИКС TENANT ISOLATION:
  src/lib/queries/dashboard.ts:186    — удалить getTenantId()
  src/app/(dashboard)/page.tsx         — requireAuth()
  src/app/(dashboard)/quality/page.tsx — requireAuth()
  src/app/(dashboard)/managers/page.tsx — requireAuth()
  src/app/(dashboard)/patterns/page.tsx — requireAuth()
  src/app/api/settings/crm/route.ts    — requireAuth()
  src/app/api/settings/scripts/route.ts — requireAuth()
  src/app/api/settings/telegram/route.ts — requireAuth()

ДОБАВИТЬ TENANT GUARD:
  src/lib/queries/quality.ts:getCallDetail()    — +tenantId
  src/lib/queries/deal-detail.ts:getDealDetail() — +tenantId
  src/app/api/quality/call/[id]/route.ts         — проверка owner

НОВЫЕ ФАЙЛЫ:
  src/middleware.ts                    — auth guard для (dashboard)
  src/lib/crm/getcourse.ts           — GetCourse adapter
  src/app/api/webhooks/getcourse/route.ts — webhook receiver
```

---

## Implementation Plan

### Phase 1: Security & Multi-Tenancy (Day 1) — БЛОКЕР

**Утро (3 часа):**
- [ ] Создать `requireAuth()` в `src/lib/auth.ts`
- [ ] Создать `middleware.ts` для защиты `/(dashboard)` роутов
- [ ] Заменить `getTenantId()` во всех 12 местах
- [ ] Удалить функцию `getTenantId()` из dashboard.ts
- [ ] Добавить tenant filter в detail queries (deal, call, manager)

**День (2 часа):**
- [ ] Тест: создать 2 тенанта, проверить изоляцию данных
- [ ] Фикс single-entity routes (analyze/deal, quality/score, transcribe)
- [ ] Добавить auth в audio proxy

### Phase 2: GetCourse Webhook Receiver (Day 2) — 4 часа

- [ ] Добавить `GETCOURSE` в CrmProvider enum + Prisma migration
- [ ] Создать `src/app/api/webhooks/getcourse/route.ts`
  - Принимает: order_id, status, cost, user_email, user_phone, manager_email
  - Создаёт/обновляет Deal + Manager
  - Auth: tenant token в URL params
  - Idempotent: upsert по crmId (order_id)
- [ ] Добавить GetCourse в CRM settings UI
- [ ] Тест: mock webhook → deal создаётся в дашборде

### Phase 3: Call Upload Pipeline (Day 3) — 3 часа

- [ ] Доработать `/api/audio` для file upload (MP3/WAV)
- [ ] Flow: upload → сохранить файл → создать CallRecord → Whisper → AI analysis
- [ ] UI: кнопка "Загрузить звонок" на странице сделки
- [ ] Тест: загрузить реальный звонок, увидеть транскрипт + анализ

### Phase 4: First Client Onboarding (Day 4) — Concierge

- [ ] Создать тенант клиента вручную
- [ ] Сгенерировать webhook URL с tenant token
- [ ] Отправить инструкцию со скриншотами
- [ ] Клиент настраивает webhook в GetCourse (5 мин)
- [ ] Проверить что заказы текут
- [ ] Клиент загружает первые звонки
- [ ] Запустить AI анализ → клиент видит дашборд
- [ ] **Выставить счёт 50K₽**

### Phase 5: Automation (Day 5-7)

- [ ] Шифрование API ключей (AES-256-GCM)
- [ ] GetCourse Export API adapter (для backfill исторических заказов)
- [ ] Novofon/Zadarma API adapter (автоматическое получение звонков)
- [ ] Self-service registration + onboarding wizard
- [ ] Второй клиент onboarded

### Phase 6: Scale (Week 2-3)

- [ ] Rate limiting per tenant
- [ ] Background job queue (sync/analysis не блокирует request)
- [ ] Telephony adapters: Mango Office, Sipuni
- [ ] Per-tenant AI prompts (разные индустрии)
- [ ] Founding member program (30K₽ для первых 5 клиентов)

---

## Revenue Timeline

| День | Milestone | Revenue |
|------|-----------|---------|
| 1 | Multi-tenancy fix + security | 0 |
| 2 | GetCourse webhook receiver | 0 |
| 3 | Call upload pipeline | 0 |
| **4** | **Первый клиент onboarded** | **50K₽ invoiced** |
| 7 | Второй клиент | 100K₽/мес |
| 14 | 3-5 клиентов | 150-250K₽/мес |
| 30 | Self-service, 10 клиентов | 500K₽/мес |

---

## Success Metrics

| Metric | Baseline | Target (Day 7) | Target (Day 30) |
|--------|----------|----------------|-----------------|
| Paying tenants | 0 | 2 | 10 |
| MRR | 0 | 100K₽ | 500K₽ |
| GetCourse orders synced | 0 | 100+ | 1000+ |
| Calls analyzed | 0 | 20+ | 200+ |
| Tenant isolation bugs | 12 call sites | 0 | 0 |
| Time to onboard client | ∞ | 30 min (concierge) | 5 min (self-service) |

---

## Risks & Mitigations

| Риск | Вероятность | Митигация |
|------|------------|-----------|
| Whisper API 403 с RU сервера | Высокая | OpenRouter proxy или self-hosted Whisper |
| GetCourse webhook unreliable | Средняя | Idempotent handler + Export API backfill |
| Клиент ожидает "магию", получает "загрузи MP3" | Средняя | Фрейминг "white glove service" + автоматизация телефонии за неделю |
| Novofon recording links expire (30 мин) | Высокая | Скачивать файлы сразу при получении |
| 100 exports/2h лимит GetCourse | Низкая (при 1-5 клиентах) | Per-account rate tracking + webhook как основной канал |
| 4GB RAM на сервере | Средняя при 10+ клиентах | Upgrade или выделить отдельный GPU сервер |

---

*Детальные экспертные анализы: `docs/plans/experts/1-8-*.md`*
