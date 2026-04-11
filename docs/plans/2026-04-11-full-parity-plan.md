# Full Parity Plan — доведение до полного соответствия с оригиналом

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Исправить все визуальные и функциональные расхождения с оригиналом (analysis.obuchat.me + platform.obuchat.me), основываясь на скринах пользователя.

---

## Fix 1: QC — нечитабельные подписи на графиках

**Проблема:** На графике "Выполнение скрипта" подписи X-axis обрезаются ("авиться по имени и...")
**File:** `src/app/(dashboard)/quality/_components/qc-compliance-chart.tsx`
**Fix:**
- Обрезать подписи до 15 символов + "..." через `tickFormatter`
- Добавить tooltip для полного текста
- Увеличить нижний отступ графика (marginBottom)

**Также:** `src/app/(dashboard)/quality/_components/qc-score-distribution.tsx` — проверить читабельность

---

## Fix 2: Звонок из amoCRM не отображается на странице сделки

**Проблема:** На /deals/[id] нет аудиоплеера для звонка
**File:** `src/app/(dashboard)/deals/[id]/page.tsx` и компоненты
**Fix:**
- В deal detail если есть Message с isAudio=true, показать аудиоплеер
- Добавить секцию "Запись звонка" с `<audio controls>` над деревом этапов
- Показать транскрипт звонка если content не пустой

---

## Fix 3: Кирилл не виден в QC

**Проблема:** В /quality нет менеджера Kirill — потому что у него нет CallRecord записей
**Fix:**
- Это ожидаемо — Kirill появился из amoCRM, у него нет QC-данных
- НЕ баг. Но нужно: при автосинке amoCRM создавать CallRecord для звонков
- Связано с Fix 7 (amoCRM adapter)

---

## Fix 4: График "Конверсия по дням" на главной некорректен

**Проблема из скринов:** Y-axis показывает "00%" вместо "100%", кривая выглядит неестественно (seed данные все на одну дату)
**File:** `src/app/(dashboard)/_components/conversion-chart.tsx`
**Fix:**
- Формат Y-axis: `{value}%` (не `00%`)
- Если данных мало (1-2 точки) — показать точки, не area
- Проверить что getDailyConversion группирует правильно по closedAt

---

## Fix 5: amoCRM adapter — auto-fetch calls from contacts (P0)

**Проблема:** Звонки в amoCRM привязаны к контактам, не к сделкам. getMessages() не находит их.
**File:** `src/lib/crm/amocrm.ts`
**Fix:**
1. В getMessages(dealCrmId): сначала получить linked contacts через `/api/v4/leads/{id}?with=contacts`
2. Для каждого контакта запросить `/api/v4/contacts/{cid}/notes?note_type=call_in,call_out`
3. Извлечь: audioUrl из `params.link`, duration из `params.duration`, phone из `params.phone`
4. Вернуть как CrmMessage с isAudio=true

**Также:** При sync создавать CallRecord для звонков (для QC модуля)

---

## Fix 6: QC — данные по Кириллу (после Fix 5)

После Fix 5 при re-sync звонок Кирилла появится как CallRecord → появится в /quality.

---

## Fix 7: QC графики — обрезанные подписи X-axis

Дубль Fix 1 — объединить.

---

## Fix 8: Менеджер — breadcrumb + поиск + фильтр "Всё время"

**Проблема из скрина оригинала:** У нас нет breadcrumb, поиска и фильтра на странице менеджера
**File:** `src/app/(dashboard)/managers/[id]/page.tsx`
**Fix:**
- Добавить breadcrumb: "🏠 Дашборд > Алина Каримова"
- Добавить поиск + "Всё время" фильтр справа от имени
- Заголовок секции: "Основные метрики менеджера"

---

## Fix 9: Менеджер — pie chart "Первичные vs Повторные" + "Где теряются сделки"

**Проблема из скринов:** В оригинале после графика конверсии есть два блока:
1. **"Первичные vs Повторные"** — donut/pie chart (Первичные: 100%, Повторные: 0%)
2. **"Где теряются сделки"** — или placeholder "Проблемных этапов нет"

**Files:**
- Create: `src/app/(dashboard)/managers/[id]/_components/client-type-chart.tsx`
- Create: `src/app/(dashboard)/managers/[id]/_components/deal-loss-chart.tsx`
- Modify: `src/app/(dashboard)/managers/[id]/page.tsx`

**Fix:**
- Добавить два блока рядом (grid-cols-2) после графика конверсии
- Pie chart: Tremor DonutChart, 2 сегмента (первичные/повторные)
- Где теряются: анализ на каких этапах сделки переходят в LOST, или placeholder

---

## Fix 10: Deal detail — placeholder для пустого stage tree

**Проблема:** Если нет StageHistory — пустое место
**File:** `src/app/(dashboard)/deals/[id]/_components/stage-tree.tsx`
**Fix:** Показать "Нет данных по этапам сделки" placeholder вместо пустоты

---

## Fix 11: Менеджер — "Конверсия по дням" график (как в оригинале)

**Проблема из скрина:** В оригинале на странице менеджера есть график "Конверсия по дням" с одной точкой
**File:** `src/app/(dashboard)/managers/[id]/page.tsx`
**Fix:** Reuse ConversionChart компонент с данных, но фильтрованный по менеджеру

---

## Fix 12: Менеджер — полный вид из оригинала (скрины 12)

**Из скринов оригинала (analysis.obuchat.me/manager/1001):**

Полная структура страницы менеджера (сверху вниз):
1. Breadcrumb + Имя + Поиск + Фильтр (Fix 8)
2. 9 метрик (3x3) ✅ уже есть
3. Конверсия по дням (Fix 11)
4. Первичные vs Повторные + Где теряются (Fix 9)
5. Список сделок менеджера с фильтрами ✅ уже есть
6. Что работает лучше всего + Что приводит к провалу ✅ уже есть
7. Аккордеоны с подробным описанием + чипы сделок + менеджеры + цитаты ✅ уже есть

**Что НЕТ у нас:** пункты 1, 3, 4 — всё покрывается Fixes 8, 9, 11.

---

## Task Summary

| Fix | Что | Приоритет |
|-----|-----|-----------|
| 1 | QC графики — обрезанные подписи | P1 |
| 2 | Звонок на странице сделки (аудиоплеер + транскрипт) | P1 |
| 4 | График конверсии на главной — формат Y-axis | P1 |
| 5 | amoCRM adapter — auto-fetch calls from contacts | P0 |
| 8 | Менеджер — breadcrumb + поиск + фильтр | P2 |
| 9 | Менеджер — pie chart клиенты + где теряются | P2 |
| 10 | Deal detail — placeholder для пустого stage tree | P1 |
| 11 | Менеджер — конверсия по дням (reuse chart) | P2 |

**Объединённые:** Fix 3+6 = следствие Fix 5, Fix 7 = дубль Fix 1

**Total: 8 отдельных фиксов. Порядок: 5 → 1 → 2 → 4 → 10 → 8 → 9 → 11**
