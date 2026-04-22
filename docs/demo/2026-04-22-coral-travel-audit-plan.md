# Coral Travel Челябинск — план беглого аудита после подключения amoCRM

**Цель:** за 15 минут после первого sync понять:
1. **Объём** — сколько сделок / менеджеров / звонков за 90 дней
2. **Телефония** — какой провайдер, доступны ли audio через amoCRM
3. **Решение** — брать звонки напрямую через API телефонии ИЛИ через amoCRM notes

---

## Шаг 1. После `create-coral-chelyabinsk.ts` → initial sync

```bash
# На сервере, после создания tenant:
docker exec -w /app smart-analyze-app npx tsx scripts/smoke-amocrm-refresh.ts coral-chelyabinsk
# или через mounted container если нужно:
# docker run --rm --network smart-analyze_default -v /root/smart-analyze:/app -w /app node:22-slim ...
```

**Ожидание:** 10–30 минут на pull 90 дней сделок/контактов/нотисов.

---

## Шаг 2. Audit-snapshot — что получили

```sql
-- Запустить: docker exec smart-analyze-db psql -U smartanalyze -d smartanalyze -c "..."

-- A. Общий объём
SELECT
  (SELECT COUNT(*) FROM "Deal" WHERE "tenantId" = 'CORAL_ID') AS deals,
  (SELECT COUNT(*) FROM "Deal" WHERE "tenantId" = 'CORAL_ID' AND status='WON') AS won,
  (SELECT COUNT(*) FROM "Deal" WHERE "tenantId" = 'CORAL_ID' AND status='LOST') AS lost,
  (SELECT COUNT(*) FROM "Manager" WHERE "tenantId" = 'CORAL_ID') AS managers,
  (SELECT COUNT(*) FROM "CallRecord" WHERE "tenantId" = 'CORAL_ID') AS calls,
  (SELECT COUNT(*) FROM "CallRecord" WHERE "tenantId" = 'CORAL_ID' AND "audioUrl" IS NOT NULL) AS calls_with_audio,
  (SELECT COUNT(*) FROM "Message" WHERE "tenantId" = 'CORAL_ID') AS messages;

-- B. Средний чек и валюта
SELECT
  AVG(amount) FILTER (WHERE amount > 0) AS avg_check,
  SUM(amount) FILTER (WHERE status='WON') AS total_revenue,
  COUNT(*) FILTER (WHERE amount > 0) AS deals_with_amount
FROM "Deal" WHERE "tenantId" = 'CORAL_ID';

-- C. Менеджеры по активности (кто реально работает)
SELECT m.name,
       COUNT(DISTINCT d.id) AS deals,
       COUNT(DISTINCT d.id) FILTER (WHERE d.status='WON') AS won,
       COUNT(DISTINCT cr.id) AS calls
FROM "Manager" m
LEFT JOIN "Deal" d ON d."managerId" = m.id
LEFT JOIN "CallRecord" cr ON cr."managerId" = m.id
WHERE m."tenantId" = 'CORAL_ID'
GROUP BY m.id, m.name
ORDER BY deals DESC;

-- D. Sample audio URLs — определить провайдера
SELECT "audioUrl" FROM "CallRecord"
WHERE "tenantId" = 'CORAL_ID' AND "audioUrl" IS NOT NULL
LIMIT 5;
```

---

## Шаг 3. Определение провайдера по audio URL

Открываешь sample URL — по домену понятно чья телефония:

| Домен в audio URL | Провайдер | Что нам даёт |
|---|---|---|
| `sipuni.com/api/crm/record` | **Sipuni** | Идеально: стерео, можно подключиться напрямую по API |
| `mango-office.ru/vpbx/` | **Mango Office** | API есть, стерео опция, интеграция с amoCRM нативная |
| `uiscom.ru/` или `comagic.ru/` | **UIS / CoMagic** | Премиум, полный API |
| `megafon.ru/vats/` или `megafonpro.ru/` | **Мегафон ВАТС** | Моно-запись, нужен upgrade |
| `onlinepbx.ru/` или `api.onpbx.ru/` | **onlinePBX** | Как у diva, стерео опционально |
| `beeline.ru/` | **Билайн** | Слабый API |
| `zadarma.com/` | **Zadarma** | Моно, дешёвый |
| `gravitel.ru/` | **Гравитель** | Моно, проблемы с SSL |
| Другой | custom / новый | Исследовать отдельно |

---

## Шаг 4. Тест доступности audio

```bash
# Probe на тестовом URL из Шага 2D
curl -I "https://<audio_url_from_amo>"

# Ожидаем:
# 200 OK + Content-Type: audio/mpeg или audio/wav → OK, можем скачивать
# 401/403 → нет прав на скачивание, клиенту включать API-опцию у провайдера
# 404 → звонок удалён / устарел / неправильный URL
```

### Варианты результата

**A. URLs открываются без авторизации (прямо скачиваются)**
→ **Путь через amoCRM** подходит. Качаем audio из amo-ссылок, не нужно отдельного API провайдера.
→ Это самое простое, минимум интеграции.

**B. URLs требуют авторизацию (401)**
→ Нужна подпись/token от провайдера. Два варианта:
   - (1) Через amoCRM proxy — если amoCRM интеграция провайдера отдаёт подписанные ссылки с TTL (Sipuni так делает — webhook с JWT в URL). Тогда читать note и использовать свежую ссылку
   - (2) Через прямой API провайдера — запрашивать у клиента API-ключ провайдера и качать напрямую

**C. Audio вообще нет в CallRecord (audioUrl NULL)**
→ amoCRM не получает audio от провайдера. Нужен **прямой доступ к провайдеру** (как у vastu с Sipuni — 14К заблокированных).
→ Запросить у клиента включить API-доступ в провайдере + дать нам ключ.

---

## Шаг 5. Решение — через amoCRM или напрямую к провайдеру

### Матрица решения

| Провайдер | Audio в amoCRM? | Путь | Когда что |
|---|---|---|---|
| Sipuni + audio open | Да | **amoCRM notes** | Не нужно возиться с отдельным API. Стерео уже есть. |
| Sipuni + audio 401 | Да, с токеном | **amoCRM notes + токен из webhook** | Наш adapter должен брать ссылку из note, скачивать как есть |
| Sipuni + без audio | Нет | **Direct API Sipuni** | Клиент даёт API-ключ Sipuni, качаем напрямую |
| Мегафон ВАТС | обычно да (моно) | **amoCRM notes** | Соглашаемся на моно, предупреждаем клиента |
| Mango Office | зависит | **amoCRM notes** (если работает) | Пробуем через amo, если 401 — Mango API |
| UIS / CoMagic | да | **amoCRM notes** или **UIS API** | Оба работают, зависит от удобства |
| onlinePBX (как у diva) | обычно нет | **Direct API onPBX** | Нужен API-key от клиента |
| Zadarma / Гравитель | моно | **amoCRM notes** | Моно — уменьшаем точность AI, предупредить |

---

## Шаг 6. Документ для клиента после аудита

После аудита — собираем и отправляем клиенту:

```markdown
# Coral Travel — что мы увидели в вашем amoCRM (аудит)

**Данные за 90 дней:**
- Сделок: XXX
- Менеджеров активных: X
- Звонков с audio: XXX
- Сообщений клиентам: XXXX

**Ваша телефония:** Sipuni / Mango / UIS / onlinePBX / Мегафон
**Стерео-запись:** да / нет / нужно включить
**Доступ к audio через amoCRM:** открыт / требует прав / отсутствует

**Наше предложение:**
1. Подключаемся через amoCRM notes (уже работает) → можем начинать анализ СЕГОДНЯ
   ИЛИ
2. Получить API-ключ к вашему провайдеру (если audio не доступен через amo)

**Объём работы:**
- Транскрибация XXX звонков × $X = $XX
- AI-оценка XXX сделок × $X = $XX
- Итого первый прогон: $XX, 2–3 часа

**Готовы к анкете калибровки?** (9 вопросов — кто менеджер, какая воронка главная, какие критические ошибки, какой скрипт)
```

---

## Audit-скрипт (напишем когда подключимся)

Создать `scripts/audit-coral-travel.ts`:

```ts
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const TENANT_NAME = "coral-chelyabinsk"

async function main() {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  })
  const tenant = await db.tenant.findFirst({ where: { name: TENANT_NAME } })
  if (!tenant) throw new Error("tenant not found")
  const t = tenant.id

  // Counts
  const [deals, won, lost, managers, calls, withAudio, messages] = await Promise.all([
    db.deal.count({ where: { tenantId: t } }),
    db.deal.count({ where: { tenantId: t, status: "WON" } }),
    db.deal.count({ where: { tenantId: t, status: "LOST" } }),
    db.manager.count({ where: { tenantId: t } }),
    db.callRecord.count({ where: { tenantId: t } }),
    db.callRecord.count({ where: { tenantId: t, audioUrl: { not: null } } }),
    db.message.count({ where: { tenantId: t } }),
  ])

  console.log(`\n=== Coral Travel Челябинск — AUDIT ===\n`)
  console.log(`Сделок за 90 дней:  ${deals}`)
  console.log(`  WON:              ${won}`)
  console.log(`  LOST:             ${lost}`)
  console.log(`  OPEN:             ${deals - won - lost}`)
  console.log(`Менеджеров:         ${managers}`)
  console.log(`Звонков:            ${calls}`)
  console.log(`  с audio:          ${withAudio}`)
  console.log(`  без audio:        ${calls - withAudio}`)
  console.log(`Сообщений:          ${messages}`)

  // Amount stats
  const amountStats = await db.$queryRawUnsafe<
    Array<{ avg_check: number; total: number; with_amount: number }>
  >(
    `SELECT AVG(amount) FILTER (WHERE amount > 0) AS avg_check,
            SUM(amount) FILTER (WHERE status='WON') AS total,
            COUNT(*) FILTER (WHERE amount > 0) AS with_amount
     FROM "Deal" WHERE "tenantId" = $1`,
    t
  )
  console.log(`\nСредний чек:        ${Math.round(amountStats[0].avg_check || 0)}₽`)
  console.log(`Общая выручка WON:  ${Math.round(amountStats[0].total || 0)}₽`)
  console.log(`Сделок с amount:    ${amountStats[0].with_amount}`)

  // Top managers
  const topManagers = await db.$queryRawUnsafe<
    Array<{ name: string; deals: number; won: number; calls: number }>
  >(
    `SELECT m.name,
            COUNT(DISTINCT d.id)::int AS deals,
            COUNT(DISTINCT d.id) FILTER (WHERE d.status='WON')::int AS won,
            COUNT(DISTINCT cr.id)::int AS calls
     FROM "Manager" m
     LEFT JOIN "Deal" d ON d."managerId" = m.id
     LEFT JOIN "CallRecord" cr ON cr."managerId" = m.id
     WHERE m."tenantId" = $1
     GROUP BY m.id, m.name
     ORDER BY deals DESC LIMIT 20`,
    t
  )
  console.log(`\n=== Top 20 менеджеров ===`)
  console.log(`Name                     | Deals | Won  | Calls`)
  console.log(`-`.repeat(56))
  for (const m of topManagers) {
    console.log(`${(m.name || "—").padEnd(25)} | ${String(m.deals).padStart(5)} | ${String(m.won).padStart(4)} | ${String(m.calls).padStart(5)}`)
  }

  // Audio URL samples — определить провайдера
  const samples = await db.callRecord.findMany({
    where: { tenantId: t, audioUrl: { not: null } },
    select: { audioUrl: true },
    take: 5,
  })
  console.log(`\n=== Sample audio URLs (определить провайдера) ===`)
  for (const s of samples) console.log(`  ${s.audioUrl}`)

  // Provider detection
  const providerSig = {
    sipuni: /sipuni\.com/,
    mango: /mango-office|mangotele/,
    uis: /uiscom|comagic/,
    megafon: /megafon/,
    onlinepbx: /onlinepbx|onpbx/,
    zadarma: /zadarma/,
    gravitel: /gravitel/,
    beeline: /beeline/,
  }
  const urls = samples.map((s) => s.audioUrl || "").join(" ")
  console.log(`\n=== Вероятный провайдер: ===`)
  for (const [name, re] of Object.entries(providerSig)) {
    if (re.test(urls)) console.log(`  → ${name.toUpperCase()}`)
  }

  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

**Когда запускать:** сразу после initial sync, через ~30 минут после `create-coral-chelyabinsk.ts`.

---

## Чек-лист действий после получения ключей

- [ ] Заполнить `scripts/create-coral-chelyabinsk.ts` (4 плейсхолдера сверху)
- [ ] Запустить на сервере через mounted node:22-slim контейнер
- [ ] Проверить `tenant` и `CrmConfig` в БД
- [ ] Запустить initial sync (подобрать правильный скрипт — `smoke-amocrm-refresh` или аналог)
- [ ] Ждать ~30 минут
- [ ] Запустить `scripts/audit-coral-travel.ts` (написать при подключении)
- [ ] По sample audio URL определить провайдера
- [ ] Попытка скачать один файл → решить путь (amoCRM notes vs direct)
- [ ] Собрать snapshot-отчёт для клиента
- [ ] Отправить снимок + анкету (4 кита если небольшой отдел, полная если 10+ менеджеров)
