# Дубли в данных — стратегия (план D)

> Дата: 2026-04-19
> Статус: PLAN — реализуем после клиентского демо
> Owner: SalesGuru

## Контекст

В CRM (amoCRM, GetCourse) дубли — частое явление:
- **Дубли сделок:** менеджер ведёт одного клиента в двух карточках (забыл объединить, или специально для разных продуктов)
- **Дубли звонков:** webhook сработал 2 раза → 2 CallRecord с одним audioUrl
- **Дубли сообщений:** аналогично — same content + sender + timestamp ±5 сек

**Принцип:** НИКОГДА не удаляем — данные могут быть осмысленными (разные сделки на одного клиента, разные продукты). Только помечаем + корректируем аналитику.

## Этапы реализации

### A. Подсветка (для демо завтра)
**Цель:** показать клиенту "мы видим проблему дублей и считаем их".

**Что делаем:**
- Скрипт-детектор: `scripts/detect-duplicates.ts`
  - Дубли сделок: same `clientPhone` + same `managerId` + `createdAt` в окне ±7 дней + НЕ closed разных статусов
  - Дубли звонков: same `audioUrl`
  - Дубли сообщений: same `content` + same `sender` + timestamp ±5 сек + same dealId
- Сохраняем счётчики в Tenant.metadata JSON: `{duplicates: {deals: N, calls: M, messages: K, lastScannedAt: ...}}`
- На дашборде: маленький бейдж/индикатор "⚠ Найдено N потенциальных дублей сделок" с tooltip объяснением

**Эффорт:** 30 мин-1 ч

### B. Detection + флаг (на следующей неделе)
**Цель:** иметь поле, чтобы фильтровать в queries.

- Добавить миграцию: `Deal.duplicateOfId String?` (FK на Deal), `CallRecord.duplicateOfId String?`, `Message.duplicateOfId String?`
- Обновить детектор: записывает `duplicateOfId` для младших дублей (по createdAt)
- Cron задача: запускать раз в день после sync

**Эффорт:** 1-2 ч

### C. Adjust метрики (на той же неделе)
**Цель:** аналитика без перекоса.

- В `getDashboardStats`, `getManagerRanking`, `getFunnelData` — добавить фильтр `WHERE duplicateOfId IS NULL`
- В `recompute-manager-metrics.ts` — пропускать дубли при подсчёте totalDeals/successDeals/conversion
- На UI: возможность переключить toggle "Показать с дублями / Без дублей"

**Эффорт:** 2-3 ч

### D. Полная dedup-логика (в рамках подписки)
**Цель:** клиент видит группы дублей и может вручную merge или unfix.

**Скрин 1: страница "Дубли"** в навигации
- Список groups: `[Original Deal | Duplicate 1 | Duplicate 2 | ...]`
- Per-group: clientPhone, sumOfAmounts, range дат, manager(s)
- Action кнопки: "Merge" (объединить в одну) / "Не дубль" (пометить как НЕ-дубль)

**Скрин 2: бейдж в карточке сделки**
- Если deal.duplicateOfId != null: ⚠ "Это дубль сделки [Original Title]"
- Если на сделке висят младшие дубли: список "Связанные дубли: [Deal2, Deal3]"

**Backend:**
- API: `POST /api/duplicates/merge` (mergedIds[] → создаёт one canonical, помечает остальные как duplicateOfId=canonical)
- API: `POST /api/duplicates/unflag` (убирает флаг)
- Cron: пересчёт метрик после изменений

**Эффорт:** 4-6 ч

## Heuristics

### Detection rules для дублей сделок (вариант A)

```
Group by:
  - clientPhone (нормализованный, +7XXXXXXXXXX)
  - tenantId
Within group, find pairs where:
  - createdAt within ±7 days of each other
  - same managerId (high confidence) OR different managerId but client confirmed (medium)
  - не оба closed с разными статусами WON/LOST (это могут быть legitimate split)
Flag the LATER one as potential duplicate of the EARLIER.
```

### Detection rules для дублей звонков

```
SELECT audioUrl, count(*) FROM CallRecord
WHERE audioUrl IS NOT NULL
GROUP BY audioUrl HAVING count(*) > 1
```

Это самые жёсткие дубли — определяются 100% точно.

### Detection rules для дублей сообщений

```
SELECT content, sender, dealId, count(*) FROM Message
WHERE content IS NOT NULL AND length(content) > 10
GROUP BY content, sender, dealId
HAVING count(*) > 1
  AND max(timestamp) - min(timestamp) < interval '10 seconds'
```

## Тестовый прогон

Сначала прогнать детектор на reklamalift74 + vastu + diva-school **только в read-only режиме** — выдать отчёт сколько дублей в каждом из 3 типов. Тогда оценим масштаб.

Если дублей мало (<5%) — план B+C может быть необязательным, хватит А.
Если много (>20%) — обязательно D в рамках подписки.

## NOT-делаем

- Никогда не удаляем оригинал — даже после merge
- Никогда не trust auto-merge без user confirmation
- Никогда не показываем "дубли" клиенту до того как мы подтвердили на тестовых данных что heuristic работает
