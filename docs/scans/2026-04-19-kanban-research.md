# GC Канбан AJAX Research — 2026-04-19

**Status:** WIP — нужен Network capture с deep inspection (см. ниже).

## Что найдено через bundle JS

**Bundle:** `/pl/nassets/c86f0959/kanban/js/index.js` (490KB)

**Endpoints (все под `/pl/tasks/kanban/`):**

| Endpoint | Method | Описание | Status |
|---|---|---|---|
| `/pl/tasks/kanban/index?funnelId=X` | GET | Settings + icons + cache + permissions | ✅ работает (3.4 KB JSON) |
| `/pl/tasks/kanban/get-counts` | POST | Task deadline counts (expired/today/...) | ✅ работает с body `{funnelId:X}` (71B JSON) |
| `/pl/tasks/kanban/get-filter-counts` | POST | Counts с filter overlay | ⚠️ нужны филтры |
| `/pl/tasks/kanban/get-tasks` | POST | **Список сделок по этапу** | ❌ 500 на минимальный body (нужны все фильды Uh class) |
| `/pl/tasks/kanban/get-tasks-new` | POST | Новый формат (для Listing view) | ❌ |
| `/pl/tasks/kanban/get-stat` | POST | Статистика | ❌ |
| `/pl/tasks/kanban/get-task?taskScriptId=X` | GET | Детали одной сделки | не пробовал |
| `/pl/tasks/kanban/get-task-scripts` | POST | Скрипты задач | не пробовал |
| `/pl/tasks/kanban/task-view?iframe=1&id=X` | GET | HTML карточки (для iframe) | не пробовал |
| `/pl/tasks/kanban/reset-cache` | POST | ⚠️ blacklist? — write op | НЕ ТРОГАТЬ |
| `/pl/tasks/kanban/create-task` | POST | ⚠️ write op | НЕ ТРОГАТЬ |
| `/pl/tasks/kanban/create-bulk-operation` | POST | ⚠️ write op | НЕ ТРОГАТЬ |
| `/pl/tasks/kanban/reject-bulk-operation` | POST | ⚠️ write op | НЕ ТРОГАТЬ |
| `/pl/tasks/kanban/set-deadline` | POST | ⚠️ write op | НЕ ТРОГАТЬ |

## Класс фильтра Uh (Vue/Vuex serializer)

```js
class Uh {
  useMaster, section, created, excluded, limit, offset, period,
  sort, status, taskid, users, excludedTasks, includedTasksScripts,
  // ... 15+ fields total
}
```

Body get-tasks:
```js
post('/pl/tasks/kanban/get-tasks', {
  body: filterUh.stringify(),           // JSON of all filter fields
  searchParams: URLSearchParams({
    type: 'deal',                        // 'deal' | 'task' | 'process'
    limit: '100',
    offset: '0'
  }),
  headers: {'content-type': 'json'}
})
```

## Funnel/Stage data — Vuex store

Bundle грузит ВСЕ funnels + stages в Vuex store при инициализации, затем фильтрует локально (`/pl/tasks/funnel/index` пробовал — 404, нет такого endpoint).

Код использует `entities/funnels` и `entities/funnelStages` namespaces. Эти данные могут быть встроены в SPA initial state HTML (нужно искать в 66KB shell), либо приходят через `/pl/tasks/kanban/index` (уже видим settings, но НЕ funnels list).

## Что нужно от пользователя для разблокировки

**Вариант 1 (предпочтительно):** Network capture POST запроса `/pl/tasks/kanban/get-tasks`. Открыть kanban в браузере → DevTools Network → найти запрос `get-tasks` → правый клик → **Copy as cURL** → прислать. Это даст ПОЛНЫЙ format body с funnelId + sectionId.

**Вариант 2:** Найти на странице эндпоинт который отдаёт список stages + funnels. Возможно это запрос `funnel` (8 KB в Network screenshot 03:30 — Initiator: timeout.ts:24).

## Что можем сделать пока без get-tasks

- ✅ `/pl/tasks/kanban/index` — глобальные настройки канбана
- ⚠️ `/pl/tasks/kanban/get-counts` — даёт только deadline-counts, НЕ stage-counts
- 🔄 Альтернативный путь к этапам: парсить `/pl/sales/dealstat/index` со всеми filter пресетами по статусам/этапам (Wave 1 #16 — следующая задача)
- 🔄 Альтернатива: `/pl/sales/deal` имеет filter `current_stage_id` — можно перебирать stages = известная задача из Phase 4

## Decision

**Канбан-парсер (#15) парк ON HOLD до Network capture от юзера.** Параллельно реализуем sales-stat (#16) который **тоже даёт стадии воронки** через filter pre-sets.
