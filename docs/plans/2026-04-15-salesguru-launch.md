# SalesGuru Launch: amoCRM + GetCourse — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Запустить первого платящего клиента за 4 дня. Поддержка amoCRM + GetCourse. Multi-tenant изоляция. Массовый анализ звонков.

**Architecture:** Shared PostgreSQL с tenant_id (уже в схеме). GetCourse через HTTP session (Playwright login → cookie → парсинг). amoCRM через REST API (уже работает). AI pipeline: Whisper (транскрибация) → DeepSeek (анализ). Производительность: 100 звонков = 3 часа (1 поток) / 45 мин (4 потока).

**Tech Stack:** Next.js 16, Prisma 7, PostgreSQL, DeepSeek V3, WhisperX, Playwright, Docker

**Server:** `ssh -i ~/.ssh/timeweb root@80.76.60.130` → `/root/smart-analyze`

**ВАЖНО:** Проект использует Next.js с нестандартными API. Перед написанием кода читай `node_modules/next/dist/docs/` для актуальных conventions.

---

## День 1: Multi-tenancy + Security (4-5 часов)

> **Без этого НЕЛЬЗЯ пускать второго клиента.** Баг `getTenantId()` в 12 местах = любой клиент видит данные всех.

### Task 1: Создать `requireAuth()` helper

**Files:**
- Modify: `src/lib/auth.ts` (добавить в конец)

**Step 1: Добавить helper в auth.ts**

```typescript
// Добавить в конец src/lib/auth.ts
import { getServerSession } from "next-auth"
import type { UserRole } from "@/generated/prisma"

export interface AuthContext {
  userId: string
  tenantId: string
  role: UserRole
}

export async function requireAuth(): Promise<AuthContext> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    throw new Error("Unauthorized")
  }
  return {
    userId: session.user.id,
    tenantId: session.user.tenantId,
    role: session.user.role,
  }
}

export async function requireTenantId(): Promise<string> {
  const { tenantId } = await requireAuth()
  return tenantId
}
```

**Step 2: Проверить что import `getServerSession` не конфликтует с существующим кодом**

Run: `ssh -i ~/.ssh/timeweb root@80.76.60.130 "cd /root/smart-analyze && grep 'getServerSession' src/lib/auth.ts"`

Если уже есть — не добавлять повторный import.

**Step 3: Commit**

```bash
git commit -m "feat: add requireAuth() and requireTenantId() helpers"
```

---

### Task 2: Создать auth middleware

**Files:**
- Create: `src/middleware.ts`

**Step 1: Создать middleware**

```typescript
// src/middleware.ts
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getToken } from "next-auth/jwt"

export async function middleware(request: NextRequest) {
  const token = await getToken({ req: request })

  // Публичные пути — не требуют авторизации
  const publicPaths = ["/login", "/register", "/api/auth", "/api/landing-lead", "/api/webhooks"]
  const isPublic = publicPaths.some((p) => request.nextUrl.pathname.startsWith(p))

  if (isPublic) return NextResponse.next()

  // API routes без токена → 401
  if (request.nextUrl.pathname.startsWith("/api/")) {
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    return NextResponse.next()
  }

  // Dashboard без токена → redirect на /login
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public).*)"],
}
```

**Step 2: Проверить что Next.js видит middleware**

Run: `ssh -i ~/.ssh/timeweb root@80.76.60.130 "cd /root/smart-analyze && npx next build 2>&1 | tail -5"`

**Step 3: Commit**

```bash
git commit -m "feat: add auth middleware — protect dashboard and API routes"
```

---

### Task 3: Заменить getTenantId() в dashboard pages (4 файла)

**Files:**
- Modify: `src/app/(dashboard)/page.tsx`
- Modify: `src/app/(dashboard)/quality/page.tsx`
- Modify: `src/app/(dashboard)/managers/page.tsx`
- Modify: `src/app/(dashboard)/patterns/page.tsx`

**Step 1: Заменить в каждом файле**

В каждом из 4 файлов:
1. Заменить import `getTenantId` → `requireTenantId` из `@/lib/auth`
2. Заменить `const tenantId = await getTenantId()` → `const tenantId = await requireTenantId()`
3. Удалить проверку `if (!tenantId)` (requireTenantId throws, не возвращает null)

Пример для `src/app/(dashboard)/page.tsx`:

```typescript
// БЫЛО:
import { getDashboardStats, getFunnelData, getManagerRanking, getInsights, getTenantId, getDailyConversion } from "@/lib/queries/dashboard"
// ...
const tenantId = await getTenantId()
if (!tenantId) { return <div>...</div> }

// СТАЛО:
import { getDashboardStats, getFunnelData, getManagerRanking, getInsights, getDailyConversion } from "@/lib/queries/dashboard"
import { requireTenantId } from "@/lib/auth"
// ...
const tenantId = await requireTenantId()
```

Повторить для quality/page.tsx, managers/page.tsx, patterns/page.tsx.

**Step 2: Commit**

```bash
git commit -m "fix: replace getTenantId with requireTenantId in 4 dashboard pages"
```

---

### Task 4: Заменить getTenantId() в 3 API routes (settings)

**Files:**
- Modify: `src/app/api/settings/crm/route.ts`
- Modify: `src/app/api/settings/scripts/route.ts`
- Modify: `src/app/api/settings/telegram/route.ts`

**Step 1: В каждом файле**

1. Удалить локальную функцию `getTenantId()` (которая делает `db.tenant.findFirst()`)
2. Добавить import: `import { requireTenantId } from "@/lib/auth"`
3. Заменить `const tenantId = await getTenantId()` → `const tenantId = await requireTenantId()`
4. Удалить проверку `if (!tenantId)` — requireTenantId throws
5. Обернуть каждый handler в try/catch для 401:

```typescript
export async function GET() {
  try {
    const tenantId = await requireTenantId()
    // ... existing logic
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
}
```

**Step 2: Commit**

```bash
git commit -m "fix: replace broken getTenantId in settings API routes — close tenant leak"
```

---

### Task 5: Удалить getTenantId() из queries и убрать re-exports

**Files:**
- Modify: `src/lib/queries/dashboard.ts` — удалить функцию getTenantId (строка 186+)
- Modify: `src/lib/queries/managers.ts` — удалить `import { getTenantId }` и `export { getTenantId }`
- Modify: `src/lib/queries/patterns.ts` — удалить `import { getTenantId }` и `export { getTenantId }`
- Modify: `src/lib/queries/quality.ts` — удалить `import { getTenantId }` и `export { getTenantId }`

**Step 1: Удалить из dashboard.ts**

```typescript
// УДАЛИТЬ из src/lib/queries/dashboard.ts (строка 186-191):
export async function getTenantId(): Promise<string | null> {
  const tenant = await db.tenant.findFirst({
    select: { id: true },
  })
  return tenant?.id ?? null
}
```

**Step 2: Удалить re-exports из managers.ts, patterns.ts, quality.ts**

В каждом: убрать `import { getTenantId } from "./dashboard"` и `export { getTenantId }`.

**Step 3: Build check**

Run: `ssh -i ~/.ssh/timeweb root@80.76.60.130 "cd /root/smart-analyze && npx next build 2>&1 | grep -i error | head -10"`

Если есть ошибки — значит где-то ещё используется getTenantId. Исправить.

**Step 4: Commit**

```bash
git commit -m "fix: delete getTenantId — all usages replaced with requireTenantId"
```

---

### Task 6: Tenant filter в detail queries

**Files:**
- Modify: `src/lib/queries/deal-detail.ts`
- Modify: `src/lib/queries/quality.ts` (getCallDetail, getManagerQuality)
- Modify: `src/app/(dashboard)/deals/[id]/page.tsx`
- Modify: `src/app/(dashboard)/quality/calls/[id]/page.tsx`
- Modify: `src/app/(dashboard)/quality/manager/[id]/page.tsx`

**Step 1: Добавить tenantId параметр в detail queries**

`deal-detail.ts` — добавить tenantId к WHERE:
```typescript
// БЫЛО:
export async function getDealDetail(dealId: string) {
  const deal = await db.deal.findUnique({ where: { id: dealId }, ... })

// СТАЛО:
export async function getDealDetail(dealId: string, tenantId: string) {
  const deal = await db.deal.findFirst({ where: { id: dealId, tenantId }, ... })
```

`quality.ts` — аналогично для getCallDetail и getManagerQuality.

**Step 2: Обновить вызовы в pages — передать tenantId из requireTenantId()**

**Step 3: Commit**

```bash
git commit -m "fix: add tenant filter to detail queries — prevent cross-tenant access"
```

---

### Task 7: Тест изоляции

**Step 1: Создать второй тенант через API**

```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 "docker exec smart-analyze-db psql -U smartanalyze -d smartanalyze -c \"
  INSERT INTO \\\"Tenant\\\" (id, name, plan) VALUES ('test-tenant-2', 'Test Company 2', 'DEMO');
  INSERT INTO \\\"User\\\" (id, email, name, password, role, \\\"tenantId\\\") VALUES ('test-user-2', 'test2@test.com', 'Test User 2', '\\\$2a\\\$10\\\$dummy', 'OWNER', 'test-tenant-2');
\""
```

**Step 2: Проверить что tenant1 не видит данные tenant2**

Залогиниться как test2@test.com → dashboard должен быть пустым.

**Step 3: Удалить тестовые данные**

**Step 4: Деплой**

```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 "cd /root/smart-analyze && docker compose build app && docker compose up -d app"
```

**Step 5: Commit**

```bash
git commit -m "chore: Day 1 complete — multi-tenancy and security fixed"
```

---

## День 2: GetCourse Adapter MVP (6-8 часов)

> **Без этого нет продукта для GetCourse клиентов.**

### Task 8: GETCOURSE в CrmProvider enum

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Добавить GETCOURSE в enum**

```prisma
enum CrmProvider {
  BITRIX24
  AMOCRM
  GETCOURSE
}
```

**Step 2: Добавить поля для GC credentials в CrmConfig**

```prisma
model CrmConfig {
  // ... existing fields
  gcEmail    String?   // GetCourse login email
  gcPassword String?   // GetCourse login password (encrypted)
  gcCookie   String?   // PHPSESSID cookie (auto-refreshed)
  gcCookieAt DateTime? // When cookie was last refreshed
}
```

**Step 3: Migration**

```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 "cd /root/smart-analyze && npx prisma migrate dev --name add-getcourse"
```

**Step 4: Commit**

```bash
git commit -m "feat: add GETCOURSE to CrmProvider enum + credential fields"
```

---

### Task 9: GetCourse session manager

**Files:**
- Create: `src/lib/crm/getcourse-session.ts`

**Step 1: Create session manager**

```typescript
// src/lib/crm/getcourse-session.ts
import { chromium, type Browser } from "playwright"

export interface GcSession {
  cookie: string
  expiresAt: Date
}

export async function getGcSession(
  accountUrl: string,
  email: string,
  password: string
): Promise<GcSession> {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(`${accountUrl}/cms/system/login`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    })
    await page.waitForTimeout(10000)

    const inputs = await page.locator('input[type="text"], input[type="password"]').all()
    if (inputs.length >= 2) await inputs[0].fill(email)
    await page.fill('input[type="password"]', password)
    await page.keyboard.press("Enter")
    await page.waitForTimeout(8000)

    if (page.url().includes("login")) {
      throw new Error("GetCourse login failed")
    }

    const cookies = await page.context().cookies()
    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ")

    return {
      cookie: cookieStr,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    }
  } finally {
    await browser.close()
  }
}
```

**Step 2: Commit**

```bash
git commit -m "feat: GetCourse session manager — Playwright login, cookie extraction"
```

---

### Task 10: GetCourse HTTP parser

**Files:**
- Create: `src/lib/crm/getcourse-parser.ts`

**Step 1: Create parser**

```typescript
// src/lib/crm/getcourse-parser.ts

export interface GcCall {
  id: string
  date: string
  type: string
  subject: string
  managerName: string
  audioUrl: string | null
  clientPhone: string | null
  transcription: string | null
}

export interface GcUser {
  id: string
  email: string
  name: string
  phone: string | null
  type: string
}

export async function fetchGcCalls(
  accountUrl: string,
  cookie: string
): Promise<GcCall[]> {
  const res = await fetch(`${accountUrl}/pl/user/contact/index`, {
    headers: { Cookie: cookie },
  })
  const html = await res.text()
  return parseCallsTable(html)
}

export async function fetchGcCallDetail(
  accountUrl: string,
  cookie: string,
  callId: string
): Promise<GcCall> {
  const res = await fetch(
    `${accountUrl}/user/control/contact/update/id/${callId}`,
    { headers: { Cookie: cookie } }
  )
  const html = await res.text()
  return parseCallCard(html, callId)
}

export async function fetchGcUsers(
  accountUrl: string,
  cookie: string
): Promise<GcUser[]> {
  const res = await fetch(`${accountUrl}/pl/user/user/index`, {
    headers: { Cookie: cookie },
  })
  const html = await res.text()
  return parseUsersTable(html)
}

// --- Parsers ---

function parseCallsTable(html: string): GcCall[] {
  const calls: GcCall[] = []
  const rowRegex = /contact\/update\/id\/(\d+)/g
  let match
  while ((match = rowRegex.exec(html)) !== null) {
    calls.push({
      id: match[1],
      date: "",
      type: "",
      subject: "",
      managerName: "",
      audioUrl: null,
      clientPhone: null,
      transcription: null,
    })
  }
  return [...new Map(calls.map((c) => [c.id, c])).values()]
}

function parseCallCard(html: string, callId: string): GcCall {
  // Транскрибация
  let transcription: string | null = null
  const noteMatch = html.match(/note-editable[^>]*>([\s\S]*?)<\/div>/)
  if (noteMatch) {
    transcription = noteMatch[1].replace(/<[^>]+>/g, " ").trim()
  }

  // Аудио URL
  const audioMatch = html.match(/(https?:\/\/[^\s"]+\.(?:mp3|wav|ogg))/)
  const audioUrl = audioMatch ? audioMatch[1] : null

  // Суть
  const titleMatch = html.match(/Contact_title[^>]*value="([^"]*)"/)
  const subject = titleMatch ? titleMatch[1] : ""

  return {
    id: callId,
    date: "",
    type: "call",
    subject,
    managerName: "",
    audioUrl,
    clientPhone: null,
    transcription,
  }
}

function parseUsersTable(html: string): GcUser[] {
  const users: GcUser[] = []
  const emailRegex = /[\w.+-]+@[\w-]+\.[\w.]+/g
  const idRegex = /user\/update\/id\/(\d+)/g

  const emails = [...new Set(html.match(emailRegex) || [])]
  const ids = [...new Set([...html.matchAll(idRegex)].map((m) => m[1]))]

  for (let i = 0; i < Math.min(emails.length, ids.length); i++) {
    users.push({
      id: ids[i],
      email: emails[i],
      name: "",
      phone: null,
      type: "student",
    })
  }
  return users
}
```

**Step 2: Commit**

```bash
git commit -m "feat: GetCourse HTTP parser — calls, users, transcriptions"
```

---

### Task 11: GetCourse adapter (CrmAdapter interface)

**Files:**
- Create: `src/lib/crm/getcourse.ts`
- Modify: `src/lib/crm/adapter.ts`
- Modify: `src/lib/crm/types.ts`

**Step 1: Create GetCourse adapter**

```typescript
// src/lib/crm/getcourse.ts
import type { CrmAdapter, CrmDeal, CrmFunnel, CrmManager, CrmMessage } from "./types"
import { fetchGcCalls, fetchGcCallDetail, fetchGcUsers } from "./getcourse-parser"

export class GetCourseAdapter implements CrmAdapter {
  private accountUrl: string
  private cookie: string

  constructor(accountUrl: string, cookie: string) {
    this.accountUrl = accountUrl
    this.cookie = cookie
  }

  async testConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.accountUrl}/pl/user/contact/index`, {
        headers: { Cookie: this.cookie },
      })
      return res.ok && !res.url.includes("login")
    } catch {
      return false
    }
  }

  async getFunnels(): Promise<CrmFunnel[]> {
    // GetCourse не имеет воронок в классическом смысле
    // Возвращаем синтетическую воронку со статусами заказов
    return [{
      crmId: "gc-orders",
      name: "Заказы GetCourse",
      stages: [
        { crmId: "new", name: "Новый", order: 0 },
        { crmId: "in_work", name: "В работе", order: 1 },
        { crmId: "payment_waiting", name: "Ожидает оплаты", order: 2 },
        { crmId: "payed", name: "Оплачен", order: 3 },
        { crmId: "cancelled", name: "Отменён", order: 4 },
      ],
    }]
  }

  async getDeals(): Promise<CrmDeal[]> {
    // MVP: звонки как "сделки" — каждый звонок = точка контакта
    const calls = await fetchGcCalls(this.accountUrl, this.cookie)
    return calls.map((c) => ({
      crmId: c.id,
      title: c.subject || `Звонок ${c.id}`,
      amount: null,
      status: "open" as const,
      managerId: null,
      managerName: c.managerName || null,
      funnelId: "gc-orders",
      funnelName: "Заказы GetCourse",
      stageName: null,
      createdAt: new Date(c.date || Date.now()),
      closedAt: null,
    }))
  }

  async getMessages(dealCrmId: string): Promise<CrmMessage[]> {
    const detail = await fetchGcCallDetail(this.accountUrl, this.cookie, dealCrmId)
    const messages: CrmMessage[] = []

    if (detail.transcription) {
      messages.push({
        dealCrmId,
        sender: "manager",
        content: detail.transcription,
        timestamp: new Date(),
        isAudio: !!detail.audioUrl,
        ...(detail.audioUrl ? { audioUrl: detail.audioUrl } : {}),
      })
    }

    return messages
  }

  async getManagers(): Promise<CrmManager[]> {
    const users = await fetchGcUsers(this.accountUrl, this.cookie)
    return users
      .filter((u) => u.type === "admin" || u.type === "administrator")
      .map((u) => ({
        crmId: u.id,
        name: u.name || u.email,
        email: u.email,
      }))
  }
}
```

**Step 2: Обновить adapter.ts — добавить GETCOURSE в switch**

```typescript
// В src/lib/crm/adapter.ts — добавить case:
case "GETCOURSE":
  if (!config.gcCookie) throw new Error("GetCourse session cookie required")
  return new GetCourseAdapter(
    `https://${config.subdomain}.getcourse.ru`,
    config.gcCookie
  )
```

**Step 3: Commit**

```bash
git commit -m "feat: GetCourse CrmAdapter — calls, users, transcriptions via HTTP"
```

---

### Task 12: Settings UI — Connect GetCourse

**Files:**
- Modify: `src/app/(dashboard)/settings/_components/crm-settings.tsx`
- Modify: `src/app/api/settings/crm/route.ts`
- Modify: `src/app/api/settings/crm/test/route.ts`

**Step 1: Добавить GetCourse форму в crm-settings.tsx**

Добавить третий блок (рядом с Bitrix24 и amoCRM):
- Поле: Account name (поддомен GetCourse)
- Поле: Email сотрудника
- Поле: Пароль сотрудника
- Кнопка: Test connection
- Кнопка: Save

**Step 2: Обновить API routes для GETCOURSE provider**

**Step 3: Commit**

```bash
git commit -m "feat: GetCourse settings UI + API"
```

---

## День 3: Массовый Pipeline + Security (6-8 часов)

> **Это и есть продукт — 100 звонков за 3 часа. Без лимитов.**

### Task 13: Массовый pipeline — sync all calls

**Files:**
- Create: `src/lib/sync/gc-bulk-sync.ts`

**Step 1: Create bulk sync**

```typescript
// src/lib/sync/gc-bulk-sync.ts
import { db } from "@/lib/db"
import { fetchGcCalls, fetchGcCallDetail } from "@/lib/crm/getcourse-parser"
import { transcribeAudio } from "@/lib/audio/transcribe"
import { analyzeDeal } from "@/lib/ai/analyze-deal"

export interface BulkSyncResult {
  totalCalls: number
  newCalls: number
  transcribed: number
  analyzed: number
  errors: number
}

export async function bulkSyncGetCourseCalls(
  tenantId: string,
  accountUrl: string,
  cookie: string,
  onProgress?: (msg: string) => void
): Promise<BulkSyncResult> {
  const result: BulkSyncResult = {
    totalCalls: 0, newCalls: 0, transcribed: 0, analyzed: 0, errors: 0,
  }

  // 1. Получить список всех звонков
  onProgress?.("Получаю список звонков...")
  const calls = await fetchGcCalls(accountUrl, cookie)
  result.totalCalls = calls.length

  // 2. Для каждого звонка — парсинг + транскрибация + анализ
  for (const call of calls) {
    try {
      // Проверяем не обработан ли уже
      const existing = await db.callRecord.findFirst({
        where: { crmId: call.id, tenantId },
      })
      if (existing) continue

      // Парсим детали
      onProgress?.(`Парсинг звонка ${call.id}...`)
      const detail = await fetchGcCallDetail(accountUrl, cookie, call.id)

      // Создаём CallRecord
      const callRecord = await db.callRecord.create({
        data: {
          tenantId,
          crmId: call.id,
          direction: "INCOMING",
          audioUrl: detail.audioUrl,
          transcript: detail.transcription,
          clientPhone: detail.clientPhone,
          createdAt: new Date(detail.date || Date.now()),
        },
      })
      result.newCalls++

      // Транскрибация (если есть аудио но нет текста)
      if (detail.audioUrl && !detail.transcription) {
        onProgress?.(`Транскрибация ${call.id}...`)
        try {
          const text = await transcribeAudio(detail.audioUrl)
          await db.callRecord.update({
            where: { id: callRecord.id },
            data: { transcript: text },
          })
          result.transcribed++
        } catch (e) {
          console.error(`Transcription failed for ${call.id}:`, e)
          result.errors++
        }
      }
    } catch (e) {
      console.error(`Failed to process call ${call.id}:`, e)
      result.errors++
    }
  }

  return result
}
```

**Step 2: Commit**

```bash
git commit -m "feat: bulk GetCourse call sync — mass transcription pipeline"
```

---

### Task 14: Шифрование API ключей

**Files:**
- Create: `src/lib/crypto.ts`
- Modify: `src/lib/crm/adapter.ts` (decrypt при создании адаптера)
- Modify: `src/app/api/settings/crm/route.ts` (encrypt при сохранении)

**Step 1: Create crypto module**

```typescript
// src/lib/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from "crypto"

const ALGORITHM = "aes-256-gcm"

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error("ENCRYPTION_KEY not set")
  return Buffer.from(key, "hex")
}

export function encrypt(text: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`
}

export function decrypt(data: string): string {
  const [ivHex, tagHex, encHex] = data.split(":")
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, "hex"))
  decipher.setAuthTag(Buffer.from(tagHex, "hex"))
  return Buffer.concat([
    decipher.update(Buffer.from(encHex, "hex")),
    decipher.final(),
  ]).toString("utf8")
}
```

**Step 2: Добавить ENCRYPTION_KEY в .env**

```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 "echo 'ENCRYPTION_KEY='$(openssl rand -hex 32) >> /root/smart-analyze/.env"
```

**Step 3: Commit**

```bash
git commit -m "feat: AES-256-GCM encryption for API keys and credentials"
```

---

### Task 15: Auth в audio proxy

**Files:**
- Modify: `src/app/api/audio/route.ts`

**Step 1: Добавить проверку сессии**

```typescript
import { requireAuth } from "@/lib/auth"

export async function GET(request: Request) {
  // Добавить в начало:
  try {
    await requireAuth()
  } catch {
    return new Response("Unauthorized", { status: 401 })
  }
  // ... existing proxy logic
}
```

**Step 2: Commit**

```bash
git commit -m "fix: add auth check to audio proxy"
```

---

### Task 16: Тест полного цикла

**Step 1: Деплой**

```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 "cd /root/smart-analyze && docker compose build app && docker compose up -d app"
```

**Step 2: Проверить**

1. Логин → dashboard показывает данные текущего тенанта
2. Без логина → redirect на /login
3. Settings → GetCourse → ввести credentials → test connection
4. Sync → звонки из GC появляются в dashboard
5. Audio proxy без логина → 401

**Step 3: Commit**

```bash
git commit -m "chore: Day 3 complete — mass pipeline, encryption, full cycle tested"
```

---

## День 4: Первый клиент → 50K₽

### Task 17: Concierge onboarding

**Не код — процесс.**

1. Клиент приглашает нас: Ученики → Пригласить специалиста → 3 галочки
2. Мы логинимся Playwright → ставим себе 28 прав
3. Запускаем bulk sync → 100 звонков за 3 часа
4. Клиент видит дашборд sa.qupai.ru
5. **Выставляем счёт 50K₽**

---

## Итог

- Клиент легко и безопасно подключается как с amoCRM так и GetCourse
- Данные изолированы между тенантами
- AI-агент read-only — не может повредить данные клиента
- Видим все воронки в amoCRM и GetCourse
- Переносим в этапы сделок, древа сделок на нашей стороне
- На основании анализа всех звонков, конверсий и переписок выявляем паттерны успеха/неуспеха для каждого менеджера индивидуально
- Далее — фичи: AI-агент чат, автоскрипты, ежедневная выжимка

## Производительность (ДОКАЗАНО)

```
HTTP запрос:                ~0.5 сек (нет API лимитов!)
100 звонков парсинг:        ~50 сек
Whisper + DeepSeek:         ~2 мин/звонок
100 звонков полный анализ:  ~3 часа (1 поток) / ~45 мин (4 потока)
Cookie живёт:               ~30 дней
```
