# amoCRM Clients Seed + Sync Auto-Refresh Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Подключить 2 amoCRM-клиента (reklamalift74, vastu) к работающему sync-пайплайну: записать их OAuth-креды из `.env` в `CrmConfig` и встроить автоматический refresh access_token в sync-движок.

**Architecture:** (1) Отдельный stand-alone script `scripts/seed-clients.ts` создаёт Tenant + CrmConfig для каждого клиента, шифруя чувствительные поля через `encrypt()`. (2) В `sync-engine.ts` перед созданием адаптера для AMOCRM вызывается `getAmoCrmAccessToken(config.id)`, которая рефрешит токен по необходимости и возвращает свежий access_token. (3) Баг в `getAmoCrmAccessToken`, падающий при пустом `apiKey`, исправляется — функция должна уметь запустить refresh с нуля.

**Tech Stack:** Next.js 16, Prisma 7 (custom output `src/generated/prisma`), PostgreSQL в Docker (`smart-analyze-db`), tsx для скриптов, AES-256-GCM (`src/lib/crypto.ts`).

**IMPORTANT — Next.js 16 caveat:** репозиторий предупреждает (`AGENTS.md`): "This is NOT the Next.js you know". Изменения этого плана почти не трогают Next.js (только серверные функции и скрипты), но если придётся править маршруты/кэш — **сначала** прочитай релевантный guide из `node_modules/next/dist/docs/`.

**Контекстные факты (уже проверены):**
- `REKLAMA_AMO_REFRESH_TOKEN` и `VASTU_AMO_REFRESH_TOKEN` в `.env` на сервере хранятся **в открытом виде** (префикс `def50200...`, нативный формат amoCRM OAuth). Перед INSERT их нужно зашифровать через `encrypt()`.
- В существующей `getAmoCrmAccessToken` (`src/lib/crm/amocrm-oauth.ts:43,50`) `clientSecret` расшифровывается через `decrypt()`, а `clientId` используется как есть. Значит в БД: `clientSecret` = encrypted, `clientId` = plain.
- Схема `CrmConfig` (проверена): `tenantId, provider, apiKey?, subdomain?, clientId?, clientSecret?, refreshToken?, tokenExpiresAt?, isActive`.
- Схема `Tenant`: `id, name, plan (default DEMO), dealsUsed, dealsLimit (default 50)`.
- `createCrmAdapter` (`src/lib/crm/adapter.ts:19`) принимает `apiKey` строкой — значит в `sync-engine.ts` свежий access_token нужно получить **до** вызова factory и передать внутрь.
- Единственная точка вызова для sync-path: `src/lib/sync/sync-engine.ts:67`. Тест-endpoint `/api/settings/crm/test/route.ts:80` работает с ручным вводом, не привязан к CrmConfig → auto-refresh там не нужен.
- Test framework не установлен (нет jest/vitest). Верификация — integration-скриптами на tsx + SQL-проверками.

**Execution location:** скрипт запускается **внутри контейнера** `smart-analyze-app` (чтобы `DATABASE_URL` резолвился в `smart-analyze-db:5432`). `.env` читается из `/root/smart-analyze/.env`.

---

## Task 1: Fix `getAmoCrmAccessToken` — allow bootstrap without apiKey

**Проблема:** `src/lib/crm/amocrm-oauth.ts:20` бросает `"No access token stored"`, если `config.apiKey` пустой. У новых клиентов `apiKey=null` (access ещё не получен) — они никогда не стартанут.

**Fix:** Пропустить ветку `isExpired` и идти сразу на refresh, если `apiKey` отсутствует.

**Files:**
- Modify: `src/lib/crm/amocrm-oauth.ts:15-40`

**Step 1: Read current implementation to confirm**

Run: `sed -n '15,40p' src/lib/crm/amocrm-oauth.ts`
Expected: строка 20 `if (!config.apiKey) throw new Error("No access token stored")` присутствует.

**Step 2: Apply the fix**

Edit `src/lib/crm/amocrm-oauth.ts` строки 20-35:

Заменить:
```ts
  if (!config.apiKey) throw new Error("No access token stored")

  // Check if token is still valid (with 5 min buffer)
  const now = new Date()
  const buffer = 5 * 60 * 1000
  const isExpired = config.tokenExpiresAt && config.tokenExpiresAt.getTime() - buffer < now.getTime()

  if (!isExpired) {
    // Token still valid — decrypt and return
    try {
      return decrypt(config.apiKey)
    } catch {
      // Not encrypted (legacy) — return as-is
      return config.apiKey
    }
  }
```

На:
```ts
  // If access token is present AND not expired — reuse it
  if (config.apiKey) {
    const now = new Date()
    const buffer = 5 * 60 * 1000
    const isExpired =
      !config.tokenExpiresAt ||
      config.tokenExpiresAt.getTime() - buffer < now.getTime()

    if (!isExpired) {
      try {
        return decrypt(config.apiKey)
      } catch {
        // Not encrypted (legacy malakhoffkiri long-lived token) — return as-is
        return config.apiKey
      }
    }
  }
  // Else — apiKey missing or expired → fall through to refresh
```

Rationale: если `tokenExpiresAt` — null, теперь токен считается истёкшим (кроме legacy-случая, где `apiKey` при неудачном `decrypt` возвращается as-is — long-lived token malakhoffkiri). Для новых клиентов `apiKey=null` → пропускаем блок и идём в refresh.

**Step 3: Type-check**

Run (на маке или сервере): `cd /Users/kirillmalahov/smart-analyze && npx tsc --noEmit`
Expected: no errors in amocrm-oauth.ts.

**Step 4: Commit**

```bash
cd /Users/kirillmalahov/smart-analyze
git add src/lib/crm/amocrm-oauth.ts
git commit -m "fix(amocrm-oauth): allow bootstrap refresh when apiKey is absent"
```

---

## Task 2: Write `scripts/seed-clients.ts` (скелет + validation)

**Files:**
- Create: `scripts/seed-clients.ts`

**Step 1: Create file with env validation (fail-fast)**

Write `/Users/kirillmalahov/smart-analyze/scripts/seed-clients.ts`:

```ts
/**
 * Seed production clients (reklamalift74, vastu) into CrmConfig.
 * Reads OAuth creds from process.env, encrypts sensitive fields, creates Tenant + CrmConfig.
 *
 * Run inside the smart-analyze-app container so DATABASE_URL resolves to the in-network Postgres:
 *   docker exec -w /app -it smart-analyze-app npx tsx scripts/seed-clients.ts
 *
 * Idempotent: if a CrmConfig with matching subdomain already exists, it is updated instead of duplicated.
 */
import { PrismaClient } from "../src/generated/prisma"
import { PrismaPg } from "@prisma/adapter-pg"
import { encrypt } from "../src/lib/crypto"

type ClientSpec = {
  tenantName: string
  envPrefix: "REKLAMA_AMO" | "VASTU_AMO"
}

const CLIENTS: ClientSpec[] = [
  { tenantName: "reklamalift74", envPrefix: "REKLAMA_AMO" },
  { tenantName: "vastu", envPrefix: "VASTU_AMO" },
]

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v || v.trim() === "") throw new Error(`Missing env: ${name}`)
  return v.trim()
}

async function main() {
  // Validate all env vars first — fail fast
  for (const c of CLIENTS) {
    requireEnv(`${c.envPrefix}_SUBDOMAIN`)
    requireEnv(`${c.envPrefix}_CLIENT_ID`)
    requireEnv(`${c.envPrefix}_CLIENT_SECRET`)
    requireEnv(`${c.envPrefix}_REFRESH_TOKEN`)
  }
  // ENCRYPTION_KEY is read by crypto.ts — touch it now for clearer error
  requireEnv("ENCRYPTION_KEY")
  console.log("Env validation: OK")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

**Step 2: Run env-validation only (DB call not yet added)**

Run inside the container:
```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 \
  'docker exec -w /app smart-analyze-app npx tsx scripts/seed-clients.ts'
```
Expected: `Env validation: OK`. Если упало — в `.env` отсутствует переменная; поправить прежде чем идти дальше.

**Step 3: Commit skeleton**

```bash
git add scripts/seed-clients.ts
git commit -m "feat(seed-clients): add skeleton with env validation"
```

---

## Task 3: Expand `seed-clients.ts` — idempotent upsert of Tenant + CrmConfig

**Files:**
- Modify: `scripts/seed-clients.ts`

**Step 1: Add upsert logic**

Replace body of `main()` in `scripts/seed-clients.ts`:

```ts
async function main() {
  // (keep the validation loop from Task 2)
  for (const c of CLIENTS) {
    requireEnv(`${c.envPrefix}_SUBDOMAIN`)
    requireEnv(`${c.envPrefix}_CLIENT_ID`)
    requireEnv(`${c.envPrefix}_CLIENT_SECRET`)
    requireEnv(`${c.envPrefix}_REFRESH_TOKEN`)
  }
  requireEnv("ENCRYPTION_KEY")

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
  const prisma = new PrismaClient({ adapter })

  try {
    for (const c of CLIENTS) {
      const subdomain = requireEnv(`${c.envPrefix}_SUBDOMAIN`)
      const clientId = requireEnv(`${c.envPrefix}_CLIENT_ID`)
      const clientSecret = requireEnv(`${c.envPrefix}_CLIENT_SECRET`)
      const refreshToken = requireEnv(`${c.envPrefix}_REFRESH_TOKEN`)

      // 1) Tenant — upsert by name
      let tenant = await prisma.tenant.findFirst({ where: { name: c.tenantName } })
      if (!tenant) {
        tenant = await prisma.tenant.create({
          data: { name: c.tenantName, plan: "DEMO", dealsLimit: 50 },
        })
        console.log(`  Tenant CREATED: ${c.tenantName} (${tenant.id})`)
      } else {
        console.log(`  Tenant exists:  ${c.tenantName} (${tenant.id})`)
      }

      // 2) CrmConfig — upsert by (tenantId, provider=AMOCRM, subdomain)
      const existing = await prisma.crmConfig.findFirst({
        where: { tenantId: tenant.id, provider: "AMOCRM", subdomain },
      })

      const payload = {
        tenantId: tenant.id,
        provider: "AMOCRM" as const,
        subdomain,                         // plain
        clientId,                          // plain
        clientSecret: encrypt(clientSecret), // encrypted
        refreshToken: encrypt(refreshToken), // encrypted
        apiKey: null,                      // access will be fetched on first sync
        tokenExpiresAt: null,              // triggers immediate refresh
        isActive: true,
      }

      if (existing) {
        await prisma.crmConfig.update({ where: { id: existing.id }, data: payload })
        console.log(`  CrmConfig UPDATED: ${c.tenantName}/${subdomain} (${existing.id})`)
      } else {
        const created = await prisma.crmConfig.create({ data: payload })
        console.log(`  CrmConfig CREATED: ${c.tenantName}/${subdomain} (${created.id})`)
      }
    }
    console.log("Done.")
  } finally {
    await prisma.$disconnect()
  }
}
```

Note: `subdomain` хранится как указано в `.env` (ожидается значение типа `reklamalift74`). `encrypt()` из `src/lib/crypto.ts` использует `ENCRYPTION_KEY` из env.

**Step 2: Run the script for real**

Run on server:
```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 \
  'docker exec -w /app smart-analyze-app npx tsx scripts/seed-clients.ts'
```

Expected output:
```
Env validation: OK
  Tenant CREATED: reklamalift74 (<id>)
  CrmConfig CREATED: reklamalift74/<subdomain> (<id>)
  Tenant CREATED: vastu (<id>)
  CrmConfig CREATED: vastu/<subdomain> (<id>)
Done.
```

**Step 3: Verify in DB**

Run:
```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 \
  'docker exec smart-analyze-db psql -U smartanalyze -d smartanalyze -c \
   "SELECT t.name, c.provider, c.subdomain, c.\"isActive\", \
           (c.\"refreshToken\" IS NOT NULL) AS has_refresh, \
           (c.\"clientSecret\" IS NOT NULL) AS has_secret, \
           (c.\"apiKey\" IS NOT NULL) AS has_access \
    FROM \"Tenant\" t JOIN \"CrmConfig\" c ON c.\"tenantId\"=t.id \
    ORDER BY t.\"createdAt\";"'
```

Expected: 3 rows (ООО Рассвет malakhoffkiri + reklamalift74 + vastu). Для новых двух: `has_refresh=t`, `has_secret=t`, `has_access=f`.

**Step 4: Verify idempotency — rerun**

Rerun Step 2 command. Expected: `Tenant exists` / `CrmConfig UPDATED` (никаких дубликатов в БД, rows count тот же).

**Step 5: Commit**

```bash
git add scripts/seed-clients.ts
git commit -m "feat(seed-clients): idempotent upsert of Tenant and CrmConfig"
```

---

## Task 4: Smoke-test — vanilla `getAmoCrmAccessToken` for a fresh client

Убедимся, что Task 1 + Task 3 вместе позволяют получить access_token с нуля, ДО изменения sync-engine.

**Files:**
- Create: `scripts/smoke-amocrm-refresh.ts`

**Step 1: Write script**

Write `/Users/kirillmalahov/smart-analyze/scripts/smoke-amocrm-refresh.ts`:

```ts
/**
 * Smoke-test: fetch fresh access_token via getAmoCrmAccessToken for the first new client.
 * Prints the CrmConfig state after the call. Does NOT touch the sync engine.
 *
 * Run: docker exec -w /app smart-analyze-app npx tsx scripts/smoke-amocrm-refresh.ts reklamalift74
 */
import { PrismaClient } from "../src/generated/prisma"
import { PrismaPg } from "@prisma/adapter-pg"
import { getAmoCrmAccessToken } from "../src/lib/crm/amocrm-oauth"

const tenantName = process.argv[2]
if (!tenantName) {
  console.error("Usage: tsx scripts/smoke-amocrm-refresh.ts <tenantName>")
  process.exit(1)
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { name: tenantName } })
  if (!tenant) throw new Error(`Tenant not found: ${tenantName}`)

  const cfg = await prisma.crmConfig.findFirst({
    where: { tenantId: tenant.id, provider: "AMOCRM" },
  })
  if (!cfg) throw new Error(`CrmConfig not found for tenant ${tenantName}`)

  console.log(`Before: apiKey=${cfg.apiKey ? "<present>" : "null"}, expiresAt=${cfg.tokenExpiresAt}`)
  const token = await getAmoCrmAccessToken(cfg.id)
  console.log(`Got access_token (len=${token.length}, prefix=${token.slice(0, 16)}...)`)

  const after = await prisma.crmConfig.findUnique({ where: { id: cfg.id } })
  console.log(`After:  apiKey=${after?.apiKey ? "<stored>" : "null"}, expiresAt=${after?.tokenExpiresAt}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
```

**Step 2: Run for reklamalift74**

```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 \
  'docker exec -w /app smart-analyze-app npx tsx scripts/smoke-amocrm-refresh.ts reklamalift74'
```

Expected:
- `Before: apiKey=null, expiresAt=null`
- `Got access_token (len=~1000, prefix=eyJ...)`
- `After:  apiKey=<stored>, expiresAt=<timestamp ~24h in future>`

Если упало — НЕ идти дальше. Вероятные причины:
- refresh_token уже протух (amoCRM инвалидирует при переиспользовании старого grant) → клиенту придётся переподключить OAuth.
- `ENCRYPTION_KEY` на сервере отличается от того, который использовался раньше → decrypt отвалится.
- Неверный `clientId`/`clientSecret`/`redirect_uri` → amoCRM отдаст 400.
- `redirect_uri` в `amocrm-oauth.ts:54` захардкожен как `https://sa.qupai.ru/api/auth/amocrm/callback` — должен совпадать с зарегистрированным в amoCRM интеграции. Если у конкретного клиента другой — это всплывёт как 400.

**Step 3: Run for vastu**

```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 \
  'docker exec -w /app smart-analyze-app npx tsx scripts/smoke-amocrm-refresh.ts vastu'
```
Expected: аналогично.

**Step 4: Commit (скрипт полезен для будущих диагностик)**

```bash
git add scripts/smoke-amocrm-refresh.ts
git commit -m "feat(smoke): smoke-test script for amoCRM token refresh"
```

---

## Task 5: Integrate auto-refresh into `sync-engine.ts`

**Files:**
- Modify: `src/lib/sync/sync-engine.ts:67-72`

**Step 1: Read current factory call**

Run: `sed -n '60,75p' src/lib/sync/sync-engine.ts`
Expected: видим

```ts
  const adapter = createCrmAdapter({
    provider: crmConfig.provider,
    webhookUrl: crmConfig.webhookUrl,
    subdomain: crmConfig.subdomain,
    apiKey: crmConfig.apiKey,
  })
```

**Step 2: Add auto-refresh branch for AMOCRM**

Edit `src/lib/sync/sync-engine.ts` строки 67-72: заменить блок `const adapter = createCrmAdapter({...})` на:

```ts
  // For amoCRM — get a fresh access_token (refresh if expired/missing).
  // For other providers, use apiKey as stored.
  let apiKeyForAdapter = crmConfig.apiKey
  if (crmConfig.provider === "AMOCRM") {
    const { getAmoCrmAccessToken } = await import("@/lib/crm/amocrm-oauth")
    apiKeyForAdapter = await getAmoCrmAccessToken(crmConfig.id)
  }

  const adapter = createCrmAdapter({
    provider: crmConfig.provider,
    webhookUrl: crmConfig.webhookUrl,
    subdomain: crmConfig.subdomain,
    apiKey: apiKeyForAdapter,
    gcCookie: crmConfig.gcCookie,
  })
```

Rationale:
- Dynamic `import()` сохраняет предыдущую изоляцию (sync-engine не тянет amoCRM-only deps в статический граф).
- `gcCookie` добавлен потому что factory уже знает этот кейс для GETCOURSE (adapter.ts:20-25) — раньше поле просто не пробрасывалось.
- `getAmoCrmAccessToken` возвращает **plain** access_token (уже расшифрованный) — ровно то, что ждёт `AmoCrmAdapter` constructor.

**Step 3: Type-check**

Run: `cd /Users/kirillmalahov/smart-analyze && npx tsc --noEmit`
Expected: no errors. Если `gcCookie` не существует в типе `CrmConfig` — убери эту строку из объекта (для AMOCRM она не нужна).

**Step 4: Deploy to server**

```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 \
  'cd /root/smart-analyze && git pull && \
   docker compose -f docker-compose.prod.yml build app && \
   docker compose -f docker-compose.prod.yml up -d app && sleep 10 && \
   docker network connect qup_qupnet smart-analyze-app 2>/dev/null || true'
```

Expected: rebuild succeeds, container up.

**Step 5: Commit**

```bash
git add src/lib/sync/sync-engine.ts
git commit -m "feat(sync): fetch fresh amoCRM access_token before sync"
```

---

## Task 6: End-to-end sync smoke-test

Убедиться, что sync отрабатывает для свежего клиента.

**Files:** (чтения only)

**Step 1: Find the sync API endpoint**

Run: `grep -rn "syncCrm\|runSync\|/api/sync" /Users/kirillmalahov/smart-analyze/src --include="*.ts" --include="*.tsx" | head`
Expected: выявить route, например `src/app/api/sync/route.ts`, и то, как он вызывает sync-engine. Нужен `crmConfigId` клиента.

**Step 2: Get CrmConfig id for reklamalift74**

```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 \
  'docker exec smart-analyze-db psql -U smartanalyze -d smartanalyze -tA -c \
   "SELECT c.id FROM \"CrmConfig\" c JOIN \"Tenant\" t ON t.id=c.\"tenantId\" \
    WHERE t.name='"'"'reklamalift74'"'"' LIMIT 1;"'
```
Expected: one UUID-like string. Запомни как `$CID_REKLAMA`.

**Step 3: Trigger sync**

Вариант А — через приложение залогиниться пользователем этого tenant-а и нажать "Sync".

Вариант Б — tsx-скрипт, вызывающий `syncCrm()` напрямую:

Write `/Users/kirillmalahov/smart-analyze/scripts/smoke-sync.ts`:

```ts
import { PrismaClient } from "../src/generated/prisma"
import { PrismaPg } from "@prisma/adapter-pg"
import { syncCrm } from "../src/lib/sync/sync-engine"

const [tenantName] = process.argv.slice(2)
if (!tenantName) { console.error("Usage: tsx scripts/smoke-sync.ts <tenantName>"); process.exit(1) }

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  const t = await prisma.tenant.findFirstOrThrow({ where: { name: tenantName } })
  const c = await prisma.crmConfig.findFirstOrThrow({ where: { tenantId: t.id, provider: "AMOCRM" } })
  const result = await syncCrm(t.id, c.id, (p) => console.log(JSON.stringify(p)))
  console.log("Result:", result)
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
```

Note: импорт `syncCrm` — уточни точное имя экспорта из `sync-engine.ts` первым шагом (`grep -n "export " src/lib/sync/sync-engine.ts`). Если функция называется иначе — переименуй в скрипте.

Run:
```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 \
  'docker exec -w /app smart-analyze-app npx tsx scripts/smoke-sync.ts reklamalift74'
```

Expected: progress-события по этапам (`managers`, `funnels`, `deals`, `messages`) и финальный `Result: { managers: N, funnels: N, deals: N, messages: N }` с ненулевыми числами для reklamalift74 (30 users / 8 воронок).

**Step 4: Verify data landed in DB**

```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 \
  'docker exec smart-analyze-db psql -U smartanalyze -d smartanalyze -c \
   "SELECT (SELECT COUNT(*) FROM \"Manager\" WHERE \"tenantId\"=(SELECT id FROM \"Tenant\" WHERE name='"'"'reklamalift74'"'"')) AS managers, \
           (SELECT COUNT(*) FROM \"Funnel\"  WHERE \"tenantId\"=(SELECT id FROM \"Tenant\" WHERE name='"'"'reklamalift74'"'"')) AS funnels, \
           (SELECT COUNT(*) FROM \"Deal\"    WHERE \"tenantId\"=(SELECT id FROM \"Tenant\" WHERE name='"'"'reklamalift74'"'"')) AS deals;"'
```
Expected: ненулевые числа, тот же порядок, что в выводе sync.

**Step 5: Repeat for vastu**

Run Step 3 и Step 4 с `vastu` вместо `reklamalift74`. Ожидаемо меньше данных (5 users).

**Step 6: Commit smoke script**

```bash
git add scripts/smoke-sync.ts
git commit -m "feat(smoke): end-to-end sync smoke-test script"
```

---

## Post-mortem checklist (после всех задач)

- [ ] `malakhoffkiri` остался живой (Task 1 fix не сломал long-lived токен). Проверка:
  ```bash
  docker exec -w /app smart-analyze-app npx tsx scripts/smoke-amocrm-refresh.ts "ООО Рассвет"
  ```
  Ожидаемо: token длиннющий, `After: apiKey=<stored>`. Decrypt может вернуть legacy plain — это штатно.
- [ ] Для vastu и reklamalift74 в `CrmConfig.apiKey` теперь лежит **зашифрованный** свежий access_token (не plain). SQL:
  ```sql
  SELECT t.name, left("apiKey", 35) FROM "Tenant" t JOIN "CrmConfig" c ON c."tenantId"=t.id;
  ```
  У новых клиентов префикс вида `<iv-hex>:<tag-hex>:...` (формат encrypt из crypto.ts), у malakhoffkiri — `eyJ...` (JWT plain).
- [ ] `tokenExpiresAt` у новых клиентов установлен ~через 24 часа от момента smoke-test.
- [ ] Лог `/tmp/amo-refresh` или `docker logs smart-analyze-app` не содержит `[AMOCRM_REFRESH] Failed`.
- [ ] Не забыть **удалить** проверочные лог-строки из скриптов, если оставлял их во время отладки.

## Что намеренно НЕ делаем в этом плане

- **401-retry wrapper.** getAmoCrmAccessToken проверяет expiry перед каждым sync с 5-минутным буфером, а sync amoCRM не идёт 24 часа. Riск мал, добавить можно отдельной итерацией, если появятся 401-ы в проде.
- **GetCourse `diva.school` в CrmConfig.** Это отдельный flow (cookie, не OAuth) и отдельный Tenant — выходит за рамки задач 1–2. Делать в следующем плане.
- **UI-кнопка "Подключить клиента".** Сейчас ввод руками в `.env` → seed. Фронт — когда клиентов будет ≥10.
- **Ротация `ENCRYPTION_KEY`.** Если когда-то понадобится — отдельная миграция с re-encrypt всех полей.

---

**Plan complete and saved to `docs/plans/2026-04-17-amocrm-clients-seed-and-autorefresh.md`. Two execution options:**

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Parallel Session (separate)** — Open a new session in the repo, use `executing-plans` skill for batch execution with checkpoints.

**Which approach?**
