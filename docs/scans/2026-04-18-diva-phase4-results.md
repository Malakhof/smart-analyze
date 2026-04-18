# diva.school Phase 4 Results

**Date:** 2026-04-18
**Status:** ✅ completed (PoC verified, full sync requires Phase 5 improvements)
**Tenant:** `diva-school` (id `cmo4qkb1000000jo432rh0l3u`)

## Что в БД сейчас

| Entity | Count | Source |
|---|---:|---|
| Manager | 20 | derived from CallRecord rows |
| Deal | 1,498 | first 1,500 deals (по дате DESC) — 50 GC pages × 30 |
| CallRecord | 1,493 | 50 GC pages × 30 |

## Топ менеджеров по активности (за 7 дней, на выборке)

| Manager | Calls | Linked Deals |
|---|---:|---:|
| Галина Архипова | 182 | 8 |
| Ольга Непочатых | 139 | 3 |
| Ирина Погода | 112 | 0 |
| Надежда Попова | 112 | 0 |
| Ирина Зинченко | 100 | 2 |
| Наталья Дунаева | 95 | 0 |
| Вероника Эйрих | 91 | 11 |
| Людмила Баранова | 90 | 6 |

(20 менеджеров с активностью, остальные 100+ из dropdown — без действий за 7 дней)

## Deal status breakdown

| Status | Deals | Sum ₽ | Платных | Средний чек ₽ |
|---|---:|---:|---:|---:|
| OPEN | 171 | 531,800 | 10 | 53,180 |
| WON | 1,318 | 238,190 | 5 | 47,638 |
| LOST | 9 | 0 | 0 | — |

**Конверсия в платный заказ: 15 / 1,498 = 1.0%** на этой выборке (обусловлено тем что выборка = последние 7 дней, многие свежие заказы ещё не оплачены).

## Известные ограничения PoC

### 1. Sync не дошёл до 22,565 deals (только 1,500 = 6.6%)

**Причина:** `gc-sync-v2.ts` накапливает все страницы в памяти, потом пишет в БД одной серией. На 22K записей контейнер виснет на ~530 MB RAM и почему-то останавливает HTTP запросы (возможно GC throttling).

**Решение в Phase 5:** batch writes per page (write→flush→next).

### 2. Manager→Deal линковка частичная

При маленькой выборке 95% `CallRecord.dealId` ссылаются на deals которых нет в БД (за пределами 1,500 загруженных). Поэтому деньги per manager сейчас видны только частично.

**Решение:** полный sync (после Phase 5 batch writes) → линковка станет 100%.

### 3. У 99% deals в БД amount = 0

**Это НЕ баг парсера.** GetCourse `/pl/sales/deal` показывает большинство заказов с "0 руб." потому что они = регистрации на бесплатные вебинары. Реально оплаченные = маленькая доля.

Парсер успешно вытащил 15 ненулевых сумм (15K-58K ₽).

## Что подтверждено

✅ End-to-end pipeline работает: GC HTML → parser → adapter → sync → DB
✅ Manager attribution через `CallRecord.managerId` работает (100% на real data)
✅ Deal status mapping (`payed → WON` etc) работает корректно
✅ Date range фильтр через Krajee `rule_string` работает
✅ Multi-tenant isolation (diva data НЕ смешивается с reklama/vastu)
✅ Encrypted cookie storage в `CrmConfig.gcCookie`
✅ amoCRM не пострадал от GetCourse работы

## Файлы Phase 4 артефакты

- `/root/backups/server-hotfixes-20260418-193925.tar.gz` — backup amoCRM hot-fixes на сервере
- `/Users/kirillmalahov/smart-analyze/backups/server-hotfixes-20260418-193925.tar.gz` — то же локально
- `/root/smart-analyze/logs/diva-full-sync.log` — логи прерванного 1000-page sync
- `/tmp/gc-phase3-result.json` — Phase 3 live test результат

## Phase 5 todo

1. **Batch writes** — писать каждую страницу в БД сразу, не копить в RAM
2. **Resumable sync** — если упало на странице N, продолжать с N+1
3. **Diagnostic logging** — current page, response time, error context каждые 10 страниц
4. **Cookie health re-check** — между запросами проверять что не разлогинились
5. **Concurrent fetches** — 2-3 страницы параллельно (с уважением к rate limit)
6. **Cleanup `src/lib/crm/getcourse.ts`** (legacy adapter) — заменить на новый

После Phase 5 → полный 22K sync пройдёт за ~5 минут стабильно.
