# Architecture Audit: Multi-Tenant + GetCourse Readiness

## Aspect: Full codebase audit for multi-tenancy correctness and integration extensibility

### Project Context

**Stack:** Next.js (standalone output) + Prisma 7 (PrismaPg adapter) + PostgreSQL 16 + DeepSeek V3 + WhisperX (OpenAI API).
**Deployment:** Single Docker container (app) + postgres container on Timeweb 4GB/50GB. Domain: sa.qupai.ru.
**Auth:** NextAuth with JWT strategy + CredentialsProvider. No middleware.
**Current state:** Registration creates a Tenant + User correctly. Prisma schema is fully tenant-scoped (every major entity has `tenantId`). BUT half the codebase bypasses auth and uses `db.tenant.findFirst()` to resolve tenantId.

---

### Expert Analysis

> "Analyzing as **Sam Newman** (Architecture) because the core issue is bounded context isolation -- tenant data must never leak across boundaries, and the CRM integration pattern must be extensible without coupling."
>
> **Principles from 3 experts:**
> 1. **Troy Hunt (Security):** "Defense in depth -- tenant isolation must be enforced at every layer, not just the API boundary"
> 2. **Martin Fowler (Refactoring):** "Small steps, preserve behavior -- fix tenant resolution first without changing any business logic"
> 3. **Theo Browne (API Design):** "Type-safe contracts, fail fast -- tenantId should be impossible to omit from queries at the type level"

---

## 1. CRITICAL: `getTenantId()` -- The Single-Tenant Backdoor

### The Problem

```typescript
// src/lib/queries/dashboard.ts:186-190
export async function getTenantId(): Promise<string | null> {
  const tenant = await db.tenant.findFirst({
    select: { id: true },
  })
  return tenant?.id ?? null
}
```

This function returns **the first tenant in the database** with no filter. It is the #1 blocker for multi-tenancy.

### Where It's Used (ALL occurrences)

| Location | How Used | Risk Level |
|----------|----------|------------|
| `src/app/(dashboard)/page.tsx:22` | Server Component, no auth check | **CRITICAL** -- shows first tenant's data to any visitor |
| `src/app/(dashboard)/quality/page.tsx:21` | Server Component, no auth check | **CRITICAL** |
| `src/app/(dashboard)/managers/page.tsx:7` | Server Component, no auth check | **CRITICAL** |
| `src/app/(dashboard)/patterns/page.tsx:13` | Server Component, no auth check | **CRITICAL** |
| `src/app/api/settings/crm/route.ts:22-25` | GET + POST, no auth check | **CRITICAL** -- unauthenticated CRM config access |
| `src/app/api/settings/scripts/route.ts:5-8` | GET/POST/PUT/DELETE, no auth check | **CRITICAL** -- unauthenticated script CRUD |
| `src/app/api/settings/telegram/route.ts:6-9` | GET + POST, no auth check | **CRITICAL** -- unauthenticated telegram config |
| Re-exported from `managers.ts`, `patterns.ts`, `quality.ts` | Propagated to 4 pages | Inherited |

### Count: 4 Server Component pages + 3 API route files (8 endpoints) = **12 total call sites** with no auth.

### The Fix

Replace ALL usages with a helper that reads from the session:

```typescript
// Proposed: src/lib/auth.ts (add to existing)
export async function requireTenantId(): Promise<string> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    throw new Error("Unauthorized")  // or redirect("/login")
  }
  return session.user.tenantId
}
```

---

## 2. API Routes Audit -- Auth Status Per Route

### Routes WITH proper auth (session-based tenantId):

| Route | Method | Auth | Tenant Check | Notes |
|-------|--------|------|-------------|-------|
| `api/sync` | POST | Session | `session.user.tenantId` | Correct |
| `api/sync/status` | GET | Session | `session.user.tenantId` | Correct |
| `api/analyze/deal` | POST | Session | Session + body match | Correct (has Forbidden check) |
| `api/analyze/patterns` | POST | Session | Session + body match | Correct (has Forbidden check) |
| `api/transcribe` | POST | Session | Session + body match | Correct for batch, **missing for single** |
| `api/quality/score` | POST | Session | Session + body match | Correct for batch, **missing for single** |
| `api/quality/call/[id]` | GET | Session | Auth check only | **BUG: no tenant-scope on getCallDetail()** |

### Routes WITHOUT auth (broken):

| Route | Method | Issue |
|-------|--------|-------|
| `api/settings/crm` | GET | Uses `getTenantId()` -- returns first tenant's CRM configs to anyone |
| `api/settings/crm` | POST | Uses `getTenantId()` -- anyone can overwrite CRM config |
| `api/settings/crm/test` | POST | No auth at all (acceptable -- just tests a connection) |
| `api/settings/scripts` | GET/POST/PUT/DELETE | Uses `getTenantId()` -- full CRUD without auth |
| `api/settings/telegram` | GET/POST | Uses `getTenantId()` -- telegram config exposed |
| `api/auth/register` | POST | No auth needed (correct -- registration endpoint) |
| `api/landing-lead` | POST | No auth needed (correct -- public lead capture) |
| `api/audio` | GET | No auth, proxies any URL (mild risk -- URL must be known) |

### Specific Bugs

**Bug 1: `api/transcribe` single message** -- when `messageId` is in body, it calls `transcribeSingleMessage(messageId)` without verifying the message belongs to the session's tenant. Any authenticated user could transcribe another tenant's messages.

**Bug 2: `api/quality/score` single call** -- when `callRecordId` is in body, it calls `scoreCall(callRecordId)` without verifying tenant ownership.

**Bug 3: `api/quality/call/[id]`** -- calls `getCallDetail(id)` which does a `findUnique` by callId with no tenant filter. Any authenticated user can read any tenant's call details.

**Bug 4: `api/audio`** -- open proxy with no auth. Anyone who knows an audio URL can access it. Low risk since URLs are internal IPs, but should be gated.

---

## 3. Auth System Analysis

### Current Setup
- **Strategy:** JWT (not database sessions)
- **Provider:** CredentialsProvider only (email + bcrypt password)
- **Session fields:** `id`, `email`, `name`, `tenantId`, `role` (UserRole: OWNER/ADMIN/VIEWER)
- **Type safety:** `next-auth.d.ts` extends Session/JWT/User with `tenantId` and `role`
- **No middleware** -- dashboard layout has NO auth guard. Server Components call `getTenantId()` instead of checking session.

### What Works
- Registration creates Tenant + User in a transaction (correct)
- JWT callback propagates `tenantId` and `role` correctly
- Session callback injects them into `session.user`
- API routes that DO use `getServerSession` work correctly

### What's Broken
- **No auth middleware** -- all `(dashboard)` pages are accessible without login
- **Dashboard layout** (`src/app/(dashboard)/layout.tsx`) has no session check
- **Server Components** use `getTenantId()` instead of `getServerSession()`
- **Role-based access** is defined in schema (OWNER/ADMIN/VIEWER) but never enforced anywhere

### For GetCourse Integration
No OAuth providers configured. Adding GetCourse would likely use a webhook/API key model (not OAuth), so the current CredentialsProvider approach is fine. A new `CrmProvider` enum value (`GETCOURSE`) would be needed.

---

## 4. Sync Engine Analysis (`src/lib/sync/sync-engine.ts`)

### Flow
1. Receives `tenantId` + `crmConfigId` from API route (session-authenticated)
2. Loads `CrmConfig` with `{ id: crmConfigId, tenantId }` filter (correct tenant-scoping)
3. Creates adapter via factory (`createCrmAdapter`) based on provider
4. Syncs sequentially: Managers -> Funnels -> Deals -> Messages -> CallRecords
5. Updates `CrmConfig.lastSyncAt` and `Tenant.dealsUsed`

### Tenant-Scoping Status
- All upserts include `tenantId` filter (correct)
- Manager lookup: `findFirst({ where: { crmId, tenantId } })` (correct)
- Funnel lookup: `findFirst({ where: { crmId, tenantId } })` (correct)
- Deal lookup: `findFirst({ where: { crmId, tenantId } })` (correct)
- CallRecord dedup: `findFirst({ where: { audioUrl, tenantId } })` (correct)

### For GetCourse
The adapter pattern (`createCrmAdapter`) is good -- just needs a new `GetCourseAdapter` implementing the `CrmAdapter` interface. The `CrmProvider` enum needs a `GETCOURSE` value. The sync flow doesn't need structural changes.

### Potential Issue
The `DEAL_BATCH_SIZE = 10` and sequential processing means large syncs are slow. GetCourse tenants with thousands of deals would need pagination support in the adapter interface.

---

## 5. AI Analysis Pipeline

### `analyze-deal.ts`
- **Input:** `dealId` (no tenant check in function itself)
- **Flow:** Loads deal + messages -> formats conversation -> calls DeepSeek -> upserts DealAnalysis
- **Batch mode (`analyzeDeals`):** Takes `tenantId`, queries only that tenant's unanalyzed deals (correct)
- **Single mode (`analyzeDeal`):** Takes `dealId` only -- **no tenant verification** in the function. Relies on API route to validate. This is fine IF the API route validates, which it does for batch but NOT for single (see Bug 1 above -- actually the analyze/deal route doesn't check tenant for single dealId either).

### `extract-patterns.ts`
- Takes `tenantId` as input (correct)
- All queries scoped to `tenantId`
- Transaction-based pattern swap (delete old -> create new) scoped to tenant
- Also updates Manager cached metrics scoped to tenant
- **Fully tenant-safe**

### `score-call.ts`
- Takes `callRecordId` only -- loads callRecord, then uses `callRecord.tenantId` for script lookup
- **Safe internally** (tenantId derived from the record), but the API route doesn't verify the caller owns the record

### `prompts.ts`
- Static prompts, no tenant-specific data embedded
- All prompts are in Russian
- No per-tenant customization yet (would be needed for multi-tenant if different industries)

---

## 6. Audio Transcription Flow

### `src/lib/audio/transcribe.ts`
- Uses OpenAI-compatible Whisper API (configurable base URL)
- **Flow:** Download audio from URL -> create File object -> send to Whisper -> return text
- **Batch mode:** Finds messages where `deal.tenantId = tenantId` (correct scoping)
- **Single mode:** Takes `messageId`, no tenant check

### `src/app/api/audio/route.ts`
- Open proxy: takes `?url=` param and forwards with Range header support
- **No auth** -- anyone can access if they know the audio URL
- Audio URLs are typically internal IPs (e.g., `80.76.60.130:8089/recordings/...`)

---

## 7. Queries Analysis (`src/lib/queries/`)

| File | Functions | Tenant-Scoped? | Notes |
|------|-----------|---------------|-------|
| `dashboard.ts` | `getDashboardStats`, `getFunnelData`, `getManagerRanking`, `getInsights`, `getDailyConversion` | YES (take `tenantId` param) | But callers use broken `getTenantId()` |
| `dashboard.ts` | `getTenantId` | **NO** -- returns first tenant | Root cause of all issues |
| `managers.ts` | `getManagersList` | YES (takes `tenantId`) | Caller uses `getTenantId()` |
| `patterns.ts` | `getPatterns` | YES (takes `tenantId`) | Caller uses `getTenantId()` |
| `quality.ts` | `getQualityDashboard`, `getQcFilterOptions`, `getQcChartData`, `getQcGraphData`, `getRecentCallsEnhanced` | YES (take `tenantId`) | Caller uses `getTenantId()` |
| `quality.ts` | `getManagerQuality`, `getManagerQualityFull` | Takes `managerId` only | **No tenant filter** -- relies on manager existing |
| `quality.ts` | `getCallDetail` | Takes `callId` only | **No tenant filter** -- any callId works |
| `deal-detail.ts` | `getDealDetail` | Takes `dealId` only | **No tenant filter** |
| `manager-detail.ts` | `getManagerDetail` | Takes `managerId` only | Reads `manager.tenantId` internally (safe for data, but doesn't verify caller) |

### Summary
All query functions that take `tenantId` are correctly scoped. The problem is:
1. Callers resolve `tenantId` via broken `getTenantId()`
2. Detail queries (deal, manager, call) take entity IDs without tenant verification -- a user from tenant A could access tenant B's deal by guessing/knowing the CUID

---

## 8. Docker Setup

### `docker-compose.yml`
- postgres:16-alpine with `smartanalyze` user/db
- Port 5433:5432
- Named volume `pgdata`
- **Only postgres** -- the app container is NOT in docker-compose (deployed separately)

### `Dockerfile`
- Multi-stage: deps -> builder -> runner
- node:22-alpine base
- Prisma generate at build time
- Standalone output mode
- Runs as non-root user `nextjs` (good)
- **Missing:** No health check, no resource limits, no logging config

### Production Deployment
- App likely runs via `docker run` separately or a different compose file
- Single container, no horizontal scaling
- **4GB RAM total** -- Node.js app + PostgreSQL sharing the same machine

### For Multi-Tenant Scale
- Current setup handles ~1 tenant fine
- 10+ tenants: need connection pooling (PgBouncer), background job queue for sync/analysis
- No cron/scheduler visible -- sync is manual (user clicks button)

---

## Summary of ALL Issues Found

### CRITICAL (must fix before multi-tenant)

| # | Issue | Files | Impact |
|---|-------|-------|--------|
| C1 | `getTenantId()` returns first tenant, used in 12 call sites | `dashboard.ts`, 4 pages, 3 API route files | Data leak across tenants |
| C2 | No auth middleware -- dashboard pages accessible without login | Missing `middleware.ts` | Anyone can see data |
| C3 | Settings API routes (CRM, Scripts, Telegram) have no auth | `api/settings/crm/route.ts`, `scripts/route.ts`, `telegram/route.ts` | Anyone can modify settings |
| C4 | Detail queries (deal, call, manager) have no tenant filter | `deal-detail.ts`, `quality.ts:getCallDetail`, `quality.ts:getManagerQuality` | Cross-tenant data access |

### HIGH (security holes, fix soon)

| # | Issue | Files | Impact |
|---|-------|-------|--------|
| H1 | Single deal analysis: no tenant ownership check | `api/analyze/deal/route.ts` (dealId path) | Cross-tenant deal analysis |
| H2 | Single call scoring: no tenant ownership check | `api/quality/score/route.ts` (callRecordId path) | Cross-tenant call scoring |
| H3 | Single message transcription: no tenant ownership check | `api/transcribe/route.ts` (messageId path) | Cross-tenant transcription |
| H4 | Audio proxy has no auth | `api/audio/route.ts` | Audio accessible to anyone |
| H5 | Role-based access defined but never enforced | Schema has OWNER/ADMIN/VIEWER | All users have same permissions |

### MEDIUM (architecture prep for GetCourse)

| # | Issue | Files | Impact |
|---|-------|-------|--------|
| M1 | CrmProvider enum lacks GETCOURSE | `schema.prisma` | Need migration |
| M2 | No adapter interface for GetCourse (webhooks vs polling) | `src/lib/crm/adapter.ts` | Need new adapter |
| M3 | No background job queue for sync/analysis | Whole project | Sync blocks request, timeouts on large data |
| M4 | No per-tenant Whisper/DeepSeek config | `ai/client.ts`, `audio/transcribe.ts` | All tenants share one API key |
| M5 | Landing-lead route hardcodes amoCRM subdomain/token | `api/landing-lead/route.ts` | Won't work for other tenants |

---

## Recommended Fix Order

### Phase 1: Auth & Tenant Isolation (1-2 days)
1. Add `middleware.ts` to protect `/(dashboard)` routes -- redirect to `/login` if no session
2. Create `requireTenantId()` helper using `getServerSession`
3. Replace ALL `getTenantId()` calls with `requireTenantId()` in pages (4 files)
4. Add `getServerSession` to settings API routes (3 files, 8 endpoints)
5. Delete `getTenantId()` function entirely

### Phase 2: Entity-Level Tenant Guards (0.5-1 day)
6. Add tenant verification to `getCallDetail(callId, tenantId)` 
7. Add tenant verification to `getDealDetail(dealId, tenantId)`
8. Add tenant verification to `getManagerQuality(managerId, tenantId)`
9. Fix single-entity API routes (analyze/deal, quality/score, transcribe) to check tenant ownership

### Phase 3: GetCourse Integration Prep (1-2 days)
10. Add `GETCOURSE` to CrmProvider enum + migration
11. Create `GetCourseAdapter` implementing CrmAdapter interface
12. Add webhook receiver endpoint for GetCourse events
13. Update settings UI to support GetCourse configuration

---

## Key File Paths

- **Auth config:** `/root/smart-analyze/src/lib/auth.ts`
- **DB client:** `/root/smart-analyze/src/lib/db.ts`
- **Broken tenant resolver:** `/root/smart-analyze/src/lib/queries/dashboard.ts` (line 186)
- **Prisma schema:** `/root/smart-analyze/prisma/schema.prisma`
- **Sync engine:** `/root/smart-analyze/src/lib/sync/sync-engine.ts`
- **AI pipeline:** `/root/smart-analyze/src/lib/ai/analyze-deal.ts`, `extract-patterns.ts`, `score-call.ts`
- **Audio:** `/root/smart-analyze/src/lib/audio/transcribe.ts`
- **CRM adapters:** `/root/smart-analyze/src/lib/crm/adapter.ts`, `amocrm.ts`, `bitrix24.ts`
- **Settings routes (no auth):** `/root/smart-analyze/src/app/api/settings/crm/route.ts`, `scripts/route.ts`, `telegram/route.ts`
- **Dashboard pages (broken tenant):** `/root/smart-analyze/src/app/(dashboard)/page.tsx`, `quality/page.tsx`, `managers/page.tsx`, `patterns/page.tsx`
- **Type defs:** `/root/smart-analyze/src/types/next-auth.d.ts`
- **Docker:** `/root/smart-analyze/Dockerfile`, `/root/smart-analyze/docker-compose.yml`
