# Real Call Pipeline — amoCRM → Whisper → DeepSeek

**Goal:** Прогнать реальный звонок из amoCRM через полный пайплайн: sync → transcribe → analyze → отобразить.

**Сделка:** #47414971 "Реклама — Рента Ю", исходящий звонок 1:52 к +79001234567

---

### Step 1: Fix amoCRM adapter — fetch call recordings

**File:** `src/lib/crm/amocrm.ts` — метод `getMessages()`

**Problem:** Звонки в amoCRM хранятся как activities/events, не как notes. Текущий adapter ищет только в `/leads/{id}/notes`.

**Fix:** Добавить запрос к `/api/v4/events` или `/api/v4/calls` для получения записей звонков. amoCRM хранит звонки как events с типом `call_in`/`call_out`. URL записи в `params.link`.

Альтернативно: `/api/v4/leads/{id}/notes` с `note_type=call_in,call_out` — проверить что возвращает.

### Step 2: Re-sync amoCRM data

```bash
curl -X POST https://sa.qupai.ru/api/sync -d '{"crmConfigId":"..."}'
```

**Ожидание:** messages: 1+ (звонок со ссылкой на аудио)

### Step 3: Transcribe via Whisper

```bash
curl -X POST https://sa.qupai.ru/api/transcribe -d '{"tenantId":"..."}'
```

**Ожидание:** Whisper API скачивает аудио → транскрибирует на русском → сохраняет в Message.content

### Step 4: Analyze via DeepSeek

```bash
curl -X POST https://sa.qupai.ru/api/analyze/deal -d '{"dealId":"..."}'
```

**Ожидание:** DealAnalysis создан с реальным summary, factors, quotes, recommendations

### Step 5: Verify on sa.qupai.ru

- /deals/[id] — AI-анализ с реальным текстом
- /managers/[id] — менеджер Kirill с реальной сделкой
- Dashboard — обновлённые метрики

---

**Total: 5 steps, ~30 min**
