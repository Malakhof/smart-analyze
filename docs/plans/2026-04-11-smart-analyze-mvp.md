# Smart Analyze MVP — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Full-stack SaaS-платформа для AI-аналитики отделов продаж — клон "Умный Анализ" + AI-акценты, dark/light тема, DeepSeek V3 как LLM.

**Architecture:** Next.js App Router (frontend + API routes), Prisma ORM + PostgreSQL (data), адаптерный паттерн для CRM-интеграций (Bitrix24 + amoCRM), DeepSeek V3 API для AI-анализа сделок, Whisper API для транскрибации звонков. Мультитенант: tenant_id на всех таблицах.

**Tech Stack:** Next.js 15, TypeScript, shadcn/ui, Tremor (charts), Tailwind CSS, Prisma, PostgreSQL, NextAuth.js, DeepSeek V3 API (OpenAI-compatible SDK), Docker.

**Design reference:** `prototype-final.html` — Premium Apple + AI gradient accents, dark/light toggle.

**UI specification:** `docs/ui-specification.md` — полная спецификация всех экранов, аккордеонов, тултипов, навигационных связей.

---

## Phase 1: Project Foundation (Tasks 1-4)

### Task 1: Initialize Next.js project with dependencies

**Files:**
- Create: `package.json`, `next.config.ts`, `tailwind.config.ts`, `tsconfig.json`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`
- Create: `.env.example`
- Create: `docker-compose.yml` (PostgreSQL dev)

**Step 1: Scaffold Next.js app**

```bash
cd /Users/kirillmalahov/smart-analyze
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack
```

Accept overwrite prompts for existing files.

**Step 2: Install core dependencies**

```bash
npm install @prisma/client next-auth @auth/prisma-adapter
npm install @tremor/react recharts
npm install openai  # DeepSeek uses OpenAI-compatible API
npm install zod server-only
npm install -D prisma
```

**Step 3: Install shadcn/ui**

```bash
npx shadcn@latest init -d
npx shadcn@latest add button card table badge tabs input select separator avatar dropdown-menu dialog sheet toast accordion switch label
```

**Step 4: Create docker-compose.yml for dev PostgreSQL**

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: smartanalyze
      POSTGRES_PASSWORD: devpassword
      POSTGRES_DB: smartanalyze
    ports:
      - "5433:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

**Step 5: Create .env.example**

```env
# Database
DATABASE_URL="postgresql://smartanalyze:devpassword@localhost:5433/smartanalyze"

# Auth
NEXTAUTH_SECRET="generate-with-openssl-rand-base64-32"
NEXTAUTH_URL="http://localhost:3000"

# AI (DeepSeek V3 — OpenAI-compatible)
DEEPSEEK_API_KEY=""
DEEPSEEK_BASE_URL="https://api.deepseek.com"
DEEPSEEK_MODEL="deepseek-chat"

# Whisper API (for audio transcription)
WHISPER_API_KEY=""
WHISPER_API_URL=""
```

**Step 6: Start PostgreSQL, verify Next.js runs**

```bash
docker compose up -d postgres
cp .env.example .env  # edit with real values
npm run dev
```

Expected: Next.js dev server on http://localhost:3000

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: initialize Next.js project with deps, shadcn/ui, PostgreSQL"
```

---

### Task 2: Database schema (Prisma)

**Files:**
- Create: `prisma/schema.prisma`
- Create: `prisma/seed.ts`

**Step 1: Define Prisma schema**

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// === AUTH / MULTI-TENANT ===

model Tenant {
  id        String   @id @default(cuid())
  name      String   // "ООО Рассвет"
  plan      Plan     @default(DEMO)
  dealsUsed Int      @default(0)
  dealsLimit Int     @default(50) // Demo = 50
  createdAt DateTime @default(now())

  users       User[]
  crmConfigs  CrmConfig[]
  funnels     Funnel[]
  managers    Manager[]
  deals       Deal[]
  patterns    Pattern[]
  insights    Insight[]
}

enum Plan {
  DEMO      // 50 deals free
  BASIC     // 50,000₽ — 625 text / 500 audio
  STANDARD  // 100,000₽ — 1351 text / 1081 audio
  PRO       // 250,000₽ — 3571 text / 2857 audio
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  password  String   // hashed
  role      UserRole @default(VIEWER)
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  createdAt DateTime @default(now())

  accounts  Account[]
  sessions  Session[]
}

enum UserRole {
  OWNER
  ADMIN
  VIEWER
}

// NextAuth models
model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// === CRM ===

model CrmConfig {
  id         String    @id @default(cuid())
  tenantId   String
  tenant     Tenant    @relation(fields: [tenantId], references: [id])
  provider   CrmProvider
  webhookUrl String?   // Bitrix24 webhook
  apiKey     String?   // amoCRM key
  subdomain  String?   // amoCRM subdomain
  isActive   Boolean   @default(false)
  lastSyncAt DateTime?
  createdAt  DateTime  @default(now())
}

enum CrmProvider {
  BITRIX24
  AMOCRM
}

// === SALES DATA ===

model Funnel {
  id       String  @id @default(cuid())
  tenantId String
  tenant   Tenant  @relation(fields: [tenantId], references: [id])
  name     String  // "Продажи B2B"
  crmId    String? // ID in CRM system
  stages   FunnelStage[]
  deals    Deal[]
}

model FunnelStage {
  id        String @id @default(cuid())
  funnelId  String
  funnel    Funnel @relation(fields: [funnelId], references: [id])
  name      String // "Квалификация"
  order     Int
  crmId     String? // ID in CRM
  deals     DealStageHistory[]
}

model Manager {
  id        String   @id @default(cuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  name      String
  email     String?
  crmId     String?  // ID in CRM
  createdAt DateTime @default(now())
  deals     Deal[]

  // Computed/cached metrics (updated after analysis)
  totalDeals     Int?
  successDeals   Int?
  conversionRate Float?
  avgDealValue   Float?
  avgDealTime    Float?  // days
  talkRatio      Float?
  status         ManagerStatus?
}

enum ManagerStatus {
  EXCELLENT  // green
  WATCH      // yellow
  CRITICAL   // red
}

model Deal {
  id          String     @id @default(cuid())
  tenantId    String
  tenant      Tenant     @relation(fields: [tenantId], references: [id])
  managerId   String?
  manager     Manager?   @relation(fields: [managerId], references: [id])
  funnelId    String?
  funnel      Funnel?    @relation(fields: [funnelId], references: [id])
  
  crmId       String?    // ID in CRM
  title       String     // "Сделка #1247 — ООО Текстиль-Про"
  amount      Float?     // deal value in rubles
  status      DealStatus
  duration    Float?     // days from creation to close
  
  createdAt   DateTime   @default(now())
  closedAt    DateTime?
  
  // Analysis results
  isAnalyzed  Boolean    @default(false)
  analysisType DealAnalysisType?
  
  messages     Message[]
  stageHistory DealStageHistory[]
  analysis     DealAnalysis?
  dealPatterns DealPattern[]
}

enum DealStatus {
  OPEN
  WON
  LOST
}

enum DealAnalysisType {
  TEXT   // chat only
  AUDIO  // calls only
  MIXED  // both
}

model Message {
  id        String   @id @default(cuid())
  dealId    String
  deal      Deal     @relation(fields: [dealId], references: [id], onDelete: Cascade)
  sender    MessageSender
  content   String   // text content or transcript
  timestamp DateTime
  isAudio   Boolean  @default(false)
  audioUrl  String?  // link to audio file
  duration  Int?     // audio duration in seconds
}

enum MessageSender {
  MANAGER
  CLIENT
  SYSTEM
}

model DealStageHistory {
  id        String      @id @default(cuid())
  dealId    String
  deal      Deal        @relation(fields: [dealId], references: [id], onDelete: Cascade)
  stageId   String
  stage     FunnelStage @relation(fields: [stageId], references: [id])
  enteredAt DateTime
  leftAt    DateTime?
  duration  Float?      // days in this stage
}

// === AI ANALYSIS ===

model DealAnalysis {
  id        String   @id @default(cuid())
  dealId    String   @unique
  deal      Deal     @relation(fields: [dealId], references: [id], onDelete: Cascade)
  
  summary       String   // AI summary of what happened
  successFactors String? // what worked (for won deals)
  failureFactors String? // what went wrong (for lost deals)
  keyQuotes     Json     // array of {text, context, isPositive}
  recommendations String? // AI recommendations
  talkRatio     Float?   // manager talk % vs client
  
  createdAt DateTime @default(now())
}

model Pattern {
  id         String      @id @default(cuid())
  tenantId   String
  tenant     Tenant      @relation(fields: [tenantId], references: [id])
  
  type       PatternType
  title      String      // "Адаптивное конфигурирование заказа"
  description String     // detailed AI description
  
  // Metrics
  strength    Float      // 0-100, how strong the signal
  impact      Float      // percentage points impact on conversion
  reliability Float      // 0-100%, works across managers
  coverage    Float      // 0-100%, % of deals affected
  
  dealCount    Int       // total deals with this pattern
  managerCount Int       // total managers exhibiting this
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  dealPatterns DealPattern[]
}

enum PatternType {
  SUCCESS
  FAILURE
}

model DealPattern {
  id        String  @id @default(cuid())
  dealId    String
  deal      Deal    @relation(fields: [dealId], references: [id], onDelete: Cascade)
  patternId String
  pattern   Pattern @relation(fields: [patternId], references: [id], onDelete: Cascade)
}

model Insight {
  id        String      @id @default(cuid())
  tenantId  String
  tenant    Tenant      @relation(fields: [tenantId], references: [id])
  type      InsightType
  title     String
  content   String
  createdAt DateTime    @default(now())
}

enum InsightType {
  SUCCESS_INSIGHT
  FAILURE_INSIGHT
}
```

**Step 2: Generate and run migration**

```bash
npx prisma migrate dev --name init
```

**Step 3: Create seed file with demo data**

Create `prisma/seed.ts` with a demo tenant, 4 managers, sample deals, and patterns matching the prototype data. Add to `package.json`:

```json
"prisma": { "seed": "npx tsx prisma/seed.ts" }
```

```bash
npm install -D tsx
npx prisma db seed
```

**Step 4: Create Prisma client singleton**

```typescript
// src/lib/db.ts
import { PrismaClient } from "@prisma/client"

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const db = globalForPrisma.prisma || new PrismaClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Prisma schema with full data model, seed, migrations"
```

---

### Task 3: Auth (NextAuth.js + credentials)

**Files:**
- Create: `src/lib/auth.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/register/page.tsx`
- Create: `src/middleware.ts`

**Step 1: Install bcrypt**

```bash
npm install bcryptjs
npm install -D @types/bcryptjs
```

**Step 2: Configure NextAuth with credentials provider**

```typescript
// src/lib/auth.ts
import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { db } from "./db"
import bcrypt from "bcryptjs"

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(db) as any,
  session: { strategy: "jwt" },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null
        const user = await db.user.findUnique({
          where: { email: credentials.email },
          include: { tenant: true },
        })
        if (!user) return null
        const valid = await bcrypt.compare(credentials.password, user.password)
        if (!valid) return null
        return { id: user.id, email: user.email, name: user.name, tenantId: user.tenantId, role: user.role }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) { token.tenantId = (user as any).tenantId; token.role = (user as any).role }
      return token
    },
    async session({ session, token }) {
      if (session.user) { (session.user as any).tenantId = token.tenantId; (session.user as any).role = token.role; (session.user as any).id = token.sub }
      return session
    },
  },
  pages: { signIn: "/login" },
}
```

**Step 3: Create auth route, login page, register page, middleware**

Standard NextAuth route handler. Login/register pages using shadcn/ui form components. Middleware protects all routes except /login and /register.

**Step 4: Create registration API route**

`src/app/api/auth/register/route.ts` — creates User + Tenant (for new signups) or adds User to existing Tenant (for invites).

**Step 5: Verify login/register flow works**

```bash
npm run dev
# Navigate to /register, create account, verify redirect to dashboard
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add auth with NextAuth.js, login/register, middleware"
```

---

### Task 4: Theme system + base layout

**Files:**
- Create: `src/app/(dashboard)/layout.tsx`
- Create: `src/components/theme-provider.tsx`
- Create: `src/components/header.tsx`
- Create: `src/components/theme-toggle.tsx`
- Modify: `src/app/globals.css` — add dark/light CSS variables from prototype-final.html
- Modify: `tailwind.config.ts` — extend with custom colors

**Step 1: Install next-themes**

```bash
npm install next-themes
```

**Step 2: Port CSS variables from prototype-final.html**

Extract all `--ai-*`, `--green-*`, `--red-*`, `--bg-*`, `--text-*` tokens from prototype-final.html into `globals.css` under `:root` (light) and `.dark` (dark) selectors. Map to Tailwind theme in `tailwind.config.ts`.

**Step 3: Create ThemeProvider, ThemeToggle, Header**

Header matches prototype-final.html: logo with AI gradient icon, nav tabs with gradient underline, AI badge with pulsing dot, theme toggle, org name.

**Step 4: Create dashboard layout with header**

`src/app/(dashboard)/layout.tsx` — wraps all dashboard pages with the header, max-width container, padding.

**Step 5: Verify dark/light toggle works**

```bash
npm run dev
# Toggle theme, verify all CSS variables switch correctly
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add theme system (dark/light), header, base dashboard layout"
```

---

## Phase 2: Dashboard Pages (Tasks 5-9)

### Task 5: Main Dashboard page

**Files:**
- Create: `src/app/(dashboard)/page.tsx` (server component)
- Create: `src/app/(dashboard)/_components/period-filter.tsx`
- Create: `src/app/(dashboard)/_components/funnel-chart.tsx`
- Create: `src/app/(dashboard)/_components/success-fail-cards.tsx`
- Create: `src/app/(dashboard)/_components/revenue-potential.tsx`
- Create: `src/app/(dashboard)/_components/key-metrics.tsx`
- Create: `src/app/(dashboard)/_components/manager-rating-table.tsx`
- Create: `src/app/(dashboard)/_components/ai-insights.tsx`
- Create: `src/lib/queries/dashboard.ts`

**Implementation:** Server component fetches all dashboard data via Prisma queries grouped by selected period. Components match prototype-final.html exactly:

1. **Period filter** — pills (Day/Week/Month/Quarter), uses URL search params
2. **Funnel** — grid of stage cards with conversion %, time, progress bar, **⚠ warning icon on problem stages**
3. **Success/Fail cards** — two cards with green/red left border, count + sum
4. **Revenue potential** — big number with AI gradient, received/lost/loss%, **ⓘ tooltips on each metric**
5. **Key metrics** — 4 cards: conversion, avg check, avg time, talk ratio, **each with ⓘ tooltip "как считается"**
6. **Conversion dynamics chart** — line chart, period-dependent (Tremor AreaChart)
7. **Manager rating** — table with avatar, medals (🥇🥈🥉), deals, conversion badge with trend arrow, sortable, **click → /managers/[id]**
8. **AI Insights** — two blocks (✓ success / ⚠ danger), each with **accordion items** that expand to show:
   - Title (uppercase bold)
   - Short description (1-2 sentences)
   - **"Подробное описание:"** — full AI text (2-3 paragraphs)
   - **"Список сделок где встречается:"** — clickable chip badges (#90001, #90003...) → link to /deals/[id]
   - **"Список менеджеров:"** — clickable chip badges (Анна Петрова) → link to /managers/[id]
   - **"Список цитат:"** — actual quotes with deal number in parentheses

**Queries in `src/lib/queries/dashboard.ts`:**
- `getDashboardStats(tenantId, period)` — aggregates from Deal, Manager, DealAnalysis
- `getFunnelData(tenantId, period)` — stages with conversion rates
- `getInsights(tenantId)` — latest AI insights

**Step N: Commit**

```bash
git add -A
git commit -m "feat: add main dashboard page with all widgets"
```

---

### Task 6: Managers list page

**Files:**
- Create: `src/app/(dashboard)/managers/page.tsx`
- Create: `src/app/(dashboard)/managers/_components/manager-grid.tsx`
- Create: `src/app/(dashboard)/managers/_components/manager-table.tsx`
- Create: `src/lib/queries/managers.ts`

**Implementation:** Summary cards (total, excellent, watch, critical) + table with status badges. Click → drill-down.

**Commit**

---

### Task 7: Manager detail (drill-down) page

**Files:**
- Create: `src/app/(dashboard)/managers/[id]/page.tsx`
- Create: `src/app/(dashboard)/managers/[id]/_components/manager-stats.tsx`
- Create: `src/app/(dashboard)/managers/[id]/_components/deal-card.tsx`
- Create: `src/app/(dashboard)/managers/[id]/_components/manager-patterns.tsx`
- Create: `src/lib/queries/manager-detail.ts`

**Implementation:**
- Back link, avatar, name, status pill
- 5 stat cards (deals, success, conversion, avg check, talk ratio) — **each with ⓘ tooltip**
- **Conversion dynamics chart** for this manager (Tremor AreaChart)
- **Response time per lead** metric
- **Success deals section:**
  - Deal card: title, amount, duration, stage count, message count
  - "Что работает лучше всего" — AI recommendations with specific quotes
  - "Выявленный паттерн успеха" — linked pattern
  - **Link to deal page** (/deals/[id])
- **Failure deals section** (for problem managers):
  - "Основной анти-паттерн менеджера" — AI description
  - **"Список цитат"** — specific phrases leading to failure
- Detected patterns for this manager — chip badges linking to /patterns

**Commit**

---

### Task 7.5: Deal detail page (NEW — from screenshot)

**Files:**
- Create: `src/app/(dashboard)/deals/[id]/page.tsx`
- Create: `src/app/(dashboard)/deals/[id]/_components/deal-header.tsx`
- Create: `src/app/(dashboard)/deals/[id]/_components/deal-ai-analysis.tsx`
- Create: `src/app/(dashboard)/deals/[id]/_components/deal-metrics.tsx`
- Create: `src/app/(dashboard)/deals/[id]/_components/deal-stats-sidebar.tsx`
- Create: `src/app/(dashboard)/deals/[id]/_components/stage-tree.tsx`
- Create: `src/app/(dashboard)/deals/[id]/_components/stage-navigation.tsx`
- Create: `src/lib/queries/deal-detail.ts`

**Implementation — 2-column layout:**

**Left column:**
1. **Deal header:** Менеджер: [name] | Сумма: [amount] ₽ | Создана: [date] | Длительность: [days] дн
2. **AI-анализ сделки** — large block with AI icon, full analysis text (1 paragraph summary of what happened)
3. **4 metric cards:**
   - Talk Ratio: XX.XX% (ⓘ)
   - Время ответа: XX.X минут
   - Сообщений: N (М:X К:Y) — manager:client breakdown
   - Звонков: N (М:X К:Y)
4. **Дерево этапов (Stage Tree)** — vertical timeline:
   - Colored dots + vertical line connecting stages
   - Each stage = accordion:
     - **● ЭТАП N: [Stage Name]**
     - Dates: DD.MM.YYYY, HH:MM – DD.MM.YYYY, HH:MM
     - Duration: X.X дн
     - ▾ expand → **messages/conversation of this stage**
   - Inside expanded stage: chronological list of messages (sender, timestamp, text)

**Right column (sidebar):**
1. **Статистика сделки:**
   - Всего коммуникаций: N
   - Сообщений: N | Звонков: N
   - Ср. время ответа: XX.X минут
   - Самый долгий этап: [Name] (X дн)
2. **Быстрая навигация** — clickable list of all stages:
   1. Новый лид
   2. Взят в работу
   3. Квалифицирован
   4. ...
   - Click → scroll to that stage in the tree

**Commit**

---

### Task 8: Pattern Library page

**Files:**
- Create: `src/app/(dashboard)/patterns/page.tsx`
- Create: `src/app/(dashboard)/patterns/_components/pattern-card.tsx`
- Create: `src/app/(dashboard)/patterns/_components/pattern-filter.tsx`
- Create: `src/lib/queries/patterns.ts`

**Implementation:** Filter pills (All/Success/Failure) + grid of pattern cards (2 columns: success left, failure right).

Each pattern card:
- Type badge (✓ Паттерн успеха / ⚠ Паттерн провала)
- Description text
- **4 metrics in row:** Сила (0-100 + label) | Влияние (±XX.X п.п. + label) | Надёжность (% + label) | Охват (% + label)
- Stats row: Сделок: N | Менеджеров: N
- **📖 Подробное описание** (expandable):
  - 2-3 paragraphs AI text (суть, когда возникает, конкретные приёмы/фразы, почему работает/ломает)
  - **"Список сделок где встречается:"** — clickable chip badges (#90001...) → /deals/[id]
  - **"Список менеджеров:"** — clickable chip badges → /managers/[id]
  - **"Список цитат:"** — quotes with deal numbers in parentheses

**Commit**

---

### Task 9: Settings page (CRM connection)

**Files:**
- Create: `src/app/(dashboard)/settings/page.tsx`
- Create: `src/app/(dashboard)/settings/_components/crm-settings.tsx`
- Create: `src/app/(dashboard)/settings/_components/company-settings.tsx`
- Create: `src/app/(dashboard)/settings/_components/plan-settings.tsx`
- Create: `src/app/api/settings/crm/route.ts`

**Implementation:**
- Left nav (CRM / Company / Plan / Users / Notifications)
- CRM page: connected status badge, webhook URL input, funnel selector, sync button, amoCRM section
- API route: save CRM config, trigger sync

**Commit**

---

## Phase 3: CRM Integration (Tasks 10-12)

### Task 10: CRM adapter interface + Bitrix24 adapter

**Files:**
- Create: `src/lib/crm/types.ts` — common CRM interface
- Create: `src/lib/crm/bitrix24.ts` — Bitrix24 REST API adapter
- Create: `src/lib/crm/adapter.ts` — factory function

**Interface:**

```typescript
// src/lib/crm/types.ts
export interface CrmDeal {
  crmId: string
  title: string
  amount: number | null
  status: "open" | "won" | "lost"
  managerId: string | null
  managerName: string | null
  funnelId: string | null
  funnelName: string | null
  stageName: string | null
  createdAt: Date
  closedAt: Date | null
}

export interface CrmMessage {
  dealCrmId: string
  sender: "manager" | "client" | "system"
  content: string
  timestamp: Date
  isAudio: boolean
  audioUrl?: string
}

export interface CrmAdapter {
  testConnection(): Promise<boolean>
  getFunnels(): Promise<{ crmId: string; name: string; stages: { crmId: string; name: string; order: number }[] }[]>
  getDeals(funnelId?: string, since?: Date): Promise<CrmDeal[]>
  getMessages(dealCrmId: string): Promise<CrmMessage[]>
  getManagers(): Promise<{ crmId: string; name: string; email?: string }[]>
}
```

**Bitrix24 adapter:** Uses REST webhook URL. Endpoints: `crm.deal.list`, `crm.dealcategory.list`, `crm.dealcategory.stage.list`, `crm.timeline.comment.list`, `user.get`. Handles Bitrix24's batch API (50 items per request, auto-pagination).

**Factory:**

```typescript
// src/lib/crm/adapter.ts
export function createCrmAdapter(config: CrmConfig): CrmAdapter {
  switch (config.provider) {
    case "BITRIX24": return new Bitrix24Adapter(config.webhookUrl!)
    case "AMOCRM": return new AmoCrmAdapter(config.subdomain!, config.apiKey!)
    default: throw new Error(`Unknown CRM: ${config.provider}`)
  }
}
```

**Commit**

---

### Task 11: amoCRM adapter

**Files:**
- Create: `src/lib/crm/amocrm.ts`

**Implementation:** amoCRM REST API v4. Endpoints: `/api/v4/leads`, `/api/v4/leads/{id}/notes`, `/api/v4/pipelines`, `/api/v4/users`. OAuth or API key auth.

**Commit**

---

### Task 12: Sync engine (CRM → DB)

**Files:**
- Create: `src/lib/sync/sync-engine.ts`
- Create: `src/app/api/sync/route.ts` — manual sync trigger
- Create: `src/app/api/sync/status/route.ts` — sync status

**Implementation:**
1. Get adapter from CrmConfig
2. Fetch managers → upsert to Manager table
3. Fetch funnels + stages → upsert to Funnel/FunnelStage
4. Fetch deals → upsert to Deal, link to Manager/Funnel
5. For each deal, fetch messages → upsert to Message
6. Update CrmConfig.lastSyncAt
7. Track progress for UI feedback

**Commit**

---

## Phase 4: AI Engine (Tasks 13-16)

### Task 13: DeepSeek API client

**Files:**
- Create: `src/lib/ai/client.ts`
- Create: `src/lib/ai/prompts.ts`

**Implementation:** OpenAI SDK configured with DeepSeek base URL:

```typescript
// src/lib/ai/client.ts
import OpenAI from "openai"

export const ai = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL,
})

export const AI_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat"
```

**Prompts in `src/lib/ai/prompts.ts`:**
- `DEAL_ANALYSIS_PROMPT` — analyze single deal, extract success/failure factors, key quotes, talk ratio
- `PATTERN_EXTRACTION_PROMPT` — given N deal analyses, find common patterns
- `PATTERN_METRICS_PROMPT` — calculate strength/impact/reliability/coverage for a pattern
- `INSIGHT_GENERATION_PROMPT` — generate top success/failure insights for department

All prompts in Russian, structured output (JSON mode).

**Commit**

---

### Task 14: Deal analysis pipeline

**Files:**
- Create: `src/lib/ai/analyze-deal.ts`
- Create: `src/app/api/analyze/deal/route.ts`

**Implementation:**

```typescript
// src/lib/ai/analyze-deal.ts
export async function analyzeDeal(dealId: string) {
  // 1. Fetch deal with messages from DB
  // 2. Build conversation string from messages
  // 3. Call DeepSeek with DEAL_ANALYSIS_PROMPT
  // 4. Parse structured response (JSON)
  // 5. Upsert DealAnalysis record
  // 6. Mark deal.isAnalyzed = true
  // 7. Return analysis
}
```

API route triggers analysis for a single deal or batch.

**Commit**

---

### Task 15: Pattern extraction pipeline

**Files:**
- Create: `src/lib/ai/extract-patterns.ts`
- Create: `src/app/api/analyze/patterns/route.ts`

**Implementation:**

```typescript
export async function extractPatterns(tenantId: string) {
  // 1. Fetch all analyzed deals (won + lost) with their DealAnalysis
  // 2. Group success factors and failure factors
  // 3. Call DeepSeek with PATTERN_EXTRACTION_PROMPT (batch of analyses)
  // 4. For each discovered pattern:
  //    a. Calculate metrics (strength, impact, reliability, coverage)
  //    b. Upsert Pattern record
  //    c. Link to deals via DealPattern
  // 5. Generate department-level Insights
  // 6. Update Manager cached metrics (conversionRate, status, etc.)
}
```

**Commit**

---

### Task 16: Audio transcription (Whisper API)

**Files:**
- Create: `src/lib/audio/transcribe.ts`
- Create: `src/app/api/transcribe/route.ts`

**Implementation:**

```typescript
export async function transcribeAudio(audioUrl: string): Promise<string> {
  // 1. Download audio file from URL
  // 2. Send to Whisper API (or DeepSeek Audio if available)
  // 3. Return transcript text
  // For MVP: use external API
  // Post-payment: switch to self-hosted WhisperX
}
```

Integrated into sync engine: when a Message has `isAudio=true` and no `content`, run transcription.

**Commit**

---

## Phase 5: Deploy (Tasks 17-18)

### Task 17: Dockerize application

**Files:**
- Create: `Dockerfile`
- Modify: `docker-compose.yml` — add app service
- Create: `docker-compose.prod.yml`
- Create: `.dockerignore`

**Dockerfile:**

```dockerfile
FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
EXPOSE 3000
CMD ["node", "server.js"]
```

**next.config.ts:** add `output: "standalone"`

**Commit**

---

### Task 18: Deploy to Timeweb server

**Files:**
- Create: `scripts/deploy.sh`

**Steps:**

```bash
# 1. SSH to server
ssh -i ~/.ssh/timeweb root@80.76.60.130

# 2. Clone repo
cd /root
git clone https://github.com/Malakhof/smart-analyze.git
cd smart-analyze

# 3. Create .env with production values
cp .env.example .env
nano .env  # fill in production values

# 4. Build and start
docker compose -f docker-compose.prod.yml up -d --build

# 5. Run migrations
docker exec smart-analyze-app npx prisma migrate deploy
docker exec smart-analyze-app npx prisma db seed

# 6. Configure nginx reverse proxy (or Caddy)
# smart-analyze.qupai.ru → localhost:3001
```

**deploy.sh** for subsequent deploys:

```bash
#!/bin/bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 "cd /root/smart-analyze && git pull && docker compose -f docker-compose.prod.yml up -d --build && docker exec smart-analyze-app npx prisma migrate deploy"
```

**Commit**

---

## Phase 6: Quality Control Module (Tasks 19-24)

> **Spec:** `docs/ui-specification-qc.md`

### Task 19: QC database models + schema update

**Files:**
- Modify: `prisma/schema.prisma` — add QC models
- Modify: `prisma/seed.ts` — add QC seed data

**New models:**

```prisma
model Script {
  id        String   @id @default(cuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  name      String   // "Скрипт входящего звонка"
  category  String?  // "incoming", "outgoing", "upsell"
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  items     ScriptItem[]
  callScores CallScore[]
}

model ScriptItem {
  id         String  @id @default(cuid())
  scriptId   String
  script     Script  @relation(fields: [scriptId], references: [id], onDelete: Cascade)
  text       String  // "Представиться по имени"
  weight     Float   @default(1.0) // influence on total score
  isCritical Boolean @default(false) // triggers TG alert if missed
  order      Int
  scoreItems CallScoreItem[]
}

model CallRecord {
  id          String   @id @default(cuid())
  tenantId    String
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  managerId   String?
  manager     Manager? @relation(fields: [managerId], references: [id])
  dealId      String?
  deal        Deal?    @relation(fields: [dealId], references: [id])
  
  crmId       String?
  clientName  String?
  clientPhone String?
  direction   CallDirection // INCOMING, OUTGOING
  category    String?       // custom category tag
  audioUrl    String?
  transcript  String?       // full transcription text
  duration    Int?          // seconds
  
  createdAt   DateTime @default(now())
  
  score       CallScore?
  tags        CallTag[]
}

enum CallDirection {
  INCOMING
  OUTGOING
}

model CallScore {
  id           String   @id @default(cuid())
  callRecordId String   @unique
  callRecord   CallRecord @relation(fields: [callRecordId], references: [id], onDelete: Cascade)
  scriptId     String
  script       Script   @relation(fields: [scriptId], references: [id])
  totalScore   Float    // 0-100%
  items        CallScoreItem[]
  createdAt    DateTime @default(now())
}

model CallScoreItem {
  id           String     @id @default(cuid())
  callScoreId  String
  callScore    CallScore  @relation(fields: [callScoreId], references: [id], onDelete: Cascade)
  scriptItemId String
  scriptItem   ScriptItem @relation(fields: [scriptItemId], references: [id])
  isDone       Boolean    // checked or not
  aiComment    String?    // AI explanation
}

model CallTag {
  id           String     @id @default(cuid())
  callRecordId String
  callRecord   CallRecord @relation(fields: [callRecordId], references: [id], onDelete: Cascade)
  tag          String     // "не озвучил доставку", custom tags
}

model TelegramConfig {
  id        String   @id @default(cuid())
  tenantId  String   @unique
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  botToken  String
  chatId    String   // chat/group ID for alerts
  isActive  Boolean  @default(true)
  alertOnCritical Boolean @default(true) // alert when critical script item missed
  createdAt DateTime @default(now())
}
```

**Seed:** 1 script with 8 items (3 critical), 5 sample call records with scores, tags.

**Commit**

---

### Task 20: QC Dashboard page

**Files:**
- Create: `src/app/(dashboard)/quality/page.tsx`
- Create: `src/app/(dashboard)/quality/_components/qc-overview.tsx`
- Create: `src/app/(dashboard)/quality/_components/qc-script-compliance.tsx`
- Create: `src/app/(dashboard)/quality/_components/qc-categories.tsx`
- Create: `src/app/(dashboard)/quality/_components/qc-tags.tsx`
- Create: `src/lib/queries/quality.ts`

**Implementation:**
- Script compliance % (gauge/progress for department, breakdown by manager)
- Dynamics chart over period (Tremor AreaChart)
- Categories breakdown (incoming/outgoing/upsell — bar chart)
- Tags cloud/list (top missed items)
- Period filter
- Link to each manager's QC detail

**Commit**

---

### Task 21: QC Manager drill-down + Dialog detail

**Files:**
- Create: `src/app/(dashboard)/quality/manager/[id]/page.tsx`
- Create: `src/app/(dashboard)/quality/calls/[id]/page.tsx`
- Create: `src/app/(dashboard)/quality/_components/call-list.tsx`
- Create: `src/app/(dashboard)/quality/_components/call-detail.tsx`
- Create: `src/app/(dashboard)/quality/_components/script-checklist.tsx`
- Create: `src/app/(dashboard)/quality/_components/audio-player.tsx`

**QC Manager page:**
- Manager header + stats (total calls, avg score, trend)
- List of all dialogs: date, duration, score %, status badge
- Click → call detail

**Call detail page (2-column layout):**
- Left: full transcript (text) + audio player
- Right: Script checklist
  - Each item: ✅ Done / ❌ Not done + AI comment
  - Total score: XX%
- Tags on this call

**Commit**

---

### Task 22: Script management (Settings)

**Files:**
- Create: `src/app/(dashboard)/settings/scripts/page.tsx`
- Create: `src/app/(dashboard)/settings/scripts/_components/script-editor.tsx`
- Create: `src/app/api/settings/scripts/route.ts`

**Implementation:**
- List of scripts (name, category, item count, active/inactive)
- Create/edit script: name, category, list of checklist items
- Each item: text, weight (1-3), isCritical toggle
- Drag-n-drop reorder items
- CRUD API routes

**Commit**

---

### Task 23: Telegram alerts

**Files:**
- Create: `src/lib/telegram/bot.ts`
- Create: `src/app/(dashboard)/settings/telegram/page.tsx`
- Create: `src/app/api/settings/telegram/route.ts`
- Create: `src/lib/qc/alert-engine.ts`

**Implementation:**
- `bot.ts`: send message via Telegram Bot API (simple fetch, no library needed)
- Alert engine: after call is scored, check for critical items missed → send TG alert
- Alert message: "⚠ Менеджер [Имя] не сказал '[пункт]' в звонке #[ID] с [клиент]. Балл: XX%"
- Settings page: bot token, chat ID, test button, enable/disable

**Commit**

---

### Task 24: QC AI scoring pipeline

**Files:**
- Create: `src/lib/ai/score-call.ts`
- Create: `src/app/api/quality/score/route.ts`

**Implementation:**
```typescript
export async function scoreCall(callRecordId: string) {
  // 1. Fetch call record with transcript
  // 2. Fetch active script for tenant
  // 3. Send to DeepSeek: transcript + script items → JSON response
  //    {items: [{scriptItemId, isDone: bool, comment: string}], totalScore: float}
  // 4. Upsert CallScore + CallScoreItems
  // 5. Check for critical items missed → trigger TG alert
  // 6. Return score
}
```

**DeepSeek prompt:** Given transcript and checklist, evaluate each item (done/not done) with brief explanation. Return structured JSON.

**Commit**

---

## Updated Task Summary

| Phase | Tasks | What |
|-------|-------|------|
| 1. Foundation | 1-4 | Next.js, DB schema, auth, theme |
| 2. Pages | 5-9 (+7.5) | Dashboard, managers, **deal detail**, patterns, settings |
| 3. CRM | 10-12 | Bitrix24/amoCRM adapters, sync engine |
| 4. AI | 13-16 | DeepSeek analysis, patterns, transcription |
| 5. Deploy | 17-18 | Docker, Timeweb deploy |
| **6. Quality Control** | **19-24** | **QC schema, dashboard, call scoring, scripts, TG alerts** |

**Total: 25 tasks. Execution order:**

**Phase A (UI with seed data):** 1→2→3→4→5→6→7→7.5→8→9→19→20→21→22
**Phase B (AI engine):** 13→14→15→16→23→24
**Phase C (Real data):** 10→11→12
**Phase D (Deploy):** 17→18

---

## Shared UI Components (created across tasks)

These reusable components are referenced by multiple pages:

| Component | Used In | Description |
|-----------|---------|-------------|
| `tooltip-metric.tsx` | Dashboard, Manager, Deal | ⓘ icon with popover "как считается" |
| `chip-badge.tsx` | Insights, Patterns, Manager | Clickable badge (#90001, Анна Петрова) with link |
| `quote-block.tsx` | Insights, Patterns, Manager, Deal | Mono quote with deal number |
| `accordion-insight.tsx` | Dashboard, Manager | Full insight accordion (title + desc + details + deals + managers + quotes) |
| `status-badge.tsx` | Manager table, Manager detail | Colored status pill (Отлично/На карандаше/Критично) |
| `medal-icon.tsx` | Manager table | 🥇🥈🥉 for top-3 |
| `period-filter.tsx` | Dashboard, QC | Day/Week/Month/Quarter/All pills |
| `ai-badge.tsx` | Header, sections | Pulsing AI dot + label |
| `script-checklist.tsx` | QC Call detail | ✅/❌ checklist with AI comments |
| `audio-player.tsx` | QC Call detail, Deal detail | Simple audio player for recordings |
| `search-input.tsx` | Header | Global search field |
