# Smart Analyze MVP — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Full-stack SaaS-платформа для AI-аналитики отделов продаж — клон "Умный Анализ" + AI-акценты, dark/light тема, DeepSeek V3 как LLM.

**Architecture:** Next.js App Router (frontend + API routes), Prisma ORM + PostgreSQL (data), адаптерный паттерн для CRM-интеграций (Bitrix24 + amoCRM), DeepSeek V3 API для AI-анализа сделок, Whisper API для транскрибации звонков. Мультитенант: tenant_id на всех таблицах.

**Tech Stack:** Next.js 15, TypeScript, shadcn/ui, Tremor (charts), Tailwind CSS, Prisma, PostgreSQL, NextAuth.js, DeepSeek V3 API (OpenAI-compatible SDK), Docker.

**Design reference:** `prototype-final.html` — Premium Apple + AI gradient accents, dark/light toggle.

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
2. **Funnel** — grid of stage cards with conversion %, time, progress bar
3. **Success/Fail cards** — two cards with green/red left border, count + sum
4. **Revenue potential** — big number with AI gradient, received/lost/loss%
5. **Key metrics** — 4 cards: conversion, avg check, avg time, talk ratio
6. **Manager rating** — table with avatar, deals, conversion badge, sortable
7. **AI Insights** — accordion blocks with ✓/! icons, expandable items

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
- 5 stat cards (deals, success, conversion, avg check, talk ratio)
- Success deals section with AI analysis, quotes (from DealAnalysis)
- Failure deals section
- Detected patterns for this manager

**Commit**

---

### Task 8: Pattern Library page

**Files:**
- Create: `src/app/(dashboard)/patterns/page.tsx`
- Create: `src/app/(dashboard)/patterns/_components/pattern-card.tsx`
- Create: `src/app/(dashboard)/patterns/_components/pattern-filter.tsx`
- Create: `src/lib/queries/patterns.ts`

**Implementation:** Filter pills (All/Success/Failure) + grid of pattern cards. Each card: type badge, description, 4 metrics (strength/impact/reliability/coverage), deal/manager count, AI description with gradient label.

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

## Task Summary

| Phase | Tasks | What |
|-------|-------|------|
| 1. Foundation | 1-4 | Next.js, DB schema, auth, theme |
| 2. Pages | 5-9 | Dashboard, managers, patterns, settings |
| 3. CRM | 10-12 | Bitrix24/amoCRM adapters, sync engine |
| 4. AI | 13-16 | DeepSeek analysis, patterns, transcription |
| 5. Deploy | 17-18 | Docker, Timeweb deploy |

**Total: 18 tasks. Estimated implementation order optimized for earliest demo.**

**Demo-first sequence:** Tasks 1→2→3→4→5→6→7→8→9 (seed data, full UI works) → 13→14→15 (AI works) → 10→11→12 (real CRM data) → 16 (audio) → 17→18 (deploy).
