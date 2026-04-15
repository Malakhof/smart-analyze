# Expert Analysis: Multi-Tenancy Architecture for SalesGuru

## Aspect: Multi-tenancy architecture

### Project Context

**What exists:**
- Schema is already multi-tenant: `Tenant` model, `tenantId` FK on all entities (Deal, Manager, Funnel, Pattern, Insight, Script, CallRecord, etc.)
- Auth via NextAuth with JWT strategy; `tenantId` and `role` are in the JWT token and session (`src/types/next-auth.d.ts`)
- Registration flow already creates Tenant + User(OWNER) in a transaction (`src/app/api/auth/register/route.ts`)
- **Most API routes already use session-based tenantId** correctly: `sync/`, `analyze/`, `quality/`, `transcribe/` all do `getServerSession(authOptions)` and check `session.user.tenantId`

**The actual problem is narrow:** Only 3 settings routes (`scripts`, `telegram`, `crm`) use the broken `getTenantId()` that does `db.tenant.findFirst()`. Everything else already works correctly.

**Key files with the broken pattern:**
- `/root/smart-analyze/src/app/api/settings/scripts/route.ts` (lines 5-10)
- `/root/smart-analyze/src/app/api/settings/telegram/route.ts` (lines 6-11)
- `/root/smart-analyze/src/app/api/settings/crm/route.ts` (lines 22-27)

**Correctly implemented routes (already use session.user.tenantId):**
- `/root/smart-analyze/src/app/api/sync/route.ts`
- `/root/smart-analyze/src/app/api/sync/status/route.ts`
- `/root/smart-analyze/src/app/api/analyze/deal/route.ts`
- `/root/smart-analyze/src/app/api/analyze/patterns/route.ts`
- `/root/smart-analyze/src/app/api/quality/score/route.ts`
- `/root/smart-analyze/src/app/api/quality/call/[id]/route.ts`
- `/root/smart-analyze/src/app/api/transcribe/route.ts`

---

### Expert Analysis

> "Analyzing as Sam Newman (Architecture) because multi-tenancy is fundamentally an architectural boundary decision that affects data isolation, scaling, and security."
>
> **Principles from 3 experts:**
> 1. Troy Hunt (Security): "Defense in depth -- tenant isolation must be enforced at multiple layers, not just application code"
> 2. Martin Fowler (Refactoring): "Small steps, preserve behavior -- fix what is broken without over-engineering"
> 3. Theo Browne (API Design): "Type-safe contracts, fail fast -- make tenant resolution impossible to forget"

---

### Question 1: Database Isolation Strategy

**A: Shared DB with tenant_id (current schema)**
- Essence: Keep the existing shared PostgreSQL database with `tenantId` column on every table. Already implemented in schema.
- Pros: Simplest to operate (one DB, one connection pool, one migration). Cheapest. Already done.
- Cons: Application bug can leak data between tenants. Noisy neighbor on large scale.
- When: SaaS with < 1000 tenants, similar data shapes, cost-sensitive. This is SalesGuru now.

**B: Schema-per-tenant**
- Essence: Each tenant gets a PostgreSQL schema (`CREATE SCHEMA tenant_xyz`). Same DB, different namespaces.
- Pros: Stronger isolation, easy per-tenant backup/restore, can customize indexes per tenant.
- Cons: Prisma has poor schema-per-tenant support (no dynamic schema switching). Migration complexity multiplies. Connection pool per schema.
- When: Regulated industries needing stronger isolation. Not this project.

**C: DB-per-tenant**
- Essence: Each tenant gets their own PostgreSQL database.
- Pros: Maximum isolation, independent scaling, easy tenant deletion.
- Cons: Massive operational overhead, Prisma needs separate client per DB, connection pool explosion. Cost 10-50x.
- When: Enterprise SaaS with massive tenants or compliance requirements. Overkill here.

**Decision: Option A (Shared DB with tenant_id)**
Already implemented. The schema is correct. No reason to change for the current scale (demo/early SaaS). Move on.

---

### Question 2: Resolving tenantId from Authenticated Session

**A: Fix the 3 broken routes inline**
- Essence: Replace `getTenantId()` with `getServerSession(authOptions)` + `session.user.tenantId` in the 3 settings routes, matching the pattern already used by 7+ other routes.
- Pros: Minimal change (3 files). Pattern already proven in codebase. No new abstractions.
- Cons: Still copy-paste pattern across routes. Easy to forget in new routes.
- When: Quick fix, move fast.

**B: Create a shared `requireTenantId()` helper**
- Essence: Create a utility function in `src/lib/auth.ts` (or new `src/lib/tenant.ts`):
  ```typescript
  export async function requireAuth(): Promise<{ userId: string; tenantId: string; role: UserRole }> {
    const session = await getServerSession(authOptions)
    if (!session?.user?.tenantId) {
      throw new AuthError("Unauthorized")
    }
    return { userId: session.user.id, tenantId: session.user.tenantId, role: session.user.role }
  }
  ```
  Then use `const { tenantId } = await requireAuth()` in every route.
- Pros: Single source of truth. Impossible to forget auth check (it throws). Reduces boilerplate from 4 lines to 1. Type-safe.
- Cons: Need to update all routes (but they already have the pattern, so it's a clean refactor). Need error boundary to catch the throw.
- When: Best for maintainability. The right long-term choice.

**C: Next.js middleware for tenant resolution**
- Essence: Use Next.js middleware to decode JWT, extract tenantId, and inject it into request headers before route handlers run.
- Pros: Route handlers never need to call `getServerSession`. Centralized auth.
- Cons: Middleware runs on Edge runtime (limited API). JWT decode without verification risk. Doesn't work well with server components. Over-engineered for the current codebase.
- When: Large teams with many route handlers who want zero-trust-by-default.

**Decision: Option B (Shared `requireAuth()` helper)**
Theo Browne's principle: make the wrong thing impossible. A `requireAuth()` function that throws on missing session makes it a compile-time-obvious pattern. Every route becomes `const { tenantId } = await requireAuth()`. The 3 broken routes get fixed, and all existing routes get simplified. Small refactor, big safety gain.

---

### Question 3: Enforcing Tenant Isolation at Prisma Level

**A: Manual `where: { tenantId }` clauses (current approach)**
- Essence: Every query explicitly includes `tenantId` in the where clause. Already done in all correct routes.
- Pros: Explicit, easy to understand, no magic. Easy to audit (grep for queries missing tenantId).
- Cons: Human error -- forget tenantId and you leak data. No safety net.
- When: Small team, few routes, code review catches mistakes.

**B: Prisma Client Extension with automatic tenant filtering**
- Essence: Use Prisma Client Extensions (`$extends`) to create a tenant-scoped client:
  ```typescript
  function tenantDb(tenantId: string) {
    return db.$extends({
      query: {
        $allModels: {
          async findMany({ args, query }) {
            args.where = { ...args.where, tenantId }
            return query(args)
          },
          // same for findFirst, findUnique, create, update, delete, count...
        }
      }
    })
  }
  ```
- Pros: Cannot forget tenantId. Defense in depth. Clean API: `tenantDb(tenantId).deal.findMany()`.
- Cons: Extension overhead on every query. Complexity in typing (extended client type). Some models (Message, DealStageHistory, FunnelStage) don't have tenantId -- need careful handling. Prisma extensions are still maturing.
- When: Team growing, many models, high data sensitivity.

**C: PostgreSQL Row-Level Security (RLS)**
- Essence: Enable RLS on all tenant-scoped tables. Set `current_setting('app.tenant_id')` at connection level, policies enforce filtering.
  ```sql
  ALTER TABLE "Deal" ENABLE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON "Deal" USING (tenant_id = current_setting('app.tenant_id')::text);
  ```
  Before each request: `SET LOCAL app.tenant_id = 'xxx';`
- Pros: Database-level enforcement -- even raw SQL queries are safe. Ultimate defense in depth.
- Cons: Prisma + RLS is awkward (need `$executeRaw` to SET before queries, or use connection-level hooks). Performance overhead on every query. Migrations become more complex. Debugging is harder (invisible filtering).
- When: Handling PII/financial data with compliance requirements. When you don't trust application code.

**D: Combination -- B + A (Extension for reads, manual for writes)**
- Essence: Use Prisma extension for automatic filtering on reads (findMany, findFirst, count). Keep explicit tenantId on creates (it's a required field anyway). Skip extension for models without tenantId.
- Pros: Best of both worlds. Reads are safe by default. Creates are explicit (you must provide tenantId).
- Cons: Two mental models. Need to document which approach is used where.
- When: Pragmatic middle ground.

**Decision: Option A (Manual where clauses) -- for now. Plan for B later.**

Reasoning: The codebase already uses manual `where: { tenantId }` consistently in 7+ routes. It works. The real risk (the 3 broken settings routes) is a `getTenantId()` problem, not a missing-where problem. Fix the root cause (Question 2), and the where clauses continue to work fine.

Add Prisma Client Extension (Option B) when:
- Team grows beyond 2 developers
- Number of API routes exceeds ~20
- A security audit flags tenant isolation

PostgreSQL RLS (Option C) is not recommended for this project. Prisma's adapter model (`PrismaPg`) makes SET LOCAL commands awkward, and the Prisma team does not officially support RLS. The complexity is not justified for the current scale.

---

### Question 4: Registration and Invitation Flow

**A: Self-registration creates tenant (current approach)**
- Essence: `/api/auth/register` creates a new Tenant + OWNER user in a transaction. Already implemented.
- Pros: Zero friction onboarding. Already works.
- Cons: No way to add users to existing tenant. OWNER is alone.
- When: MVP, single-user-per-company.

**B: Self-registration + invite flow**
- Essence: Keep self-registration for OWNER. Add `/api/invite` endpoint: OWNER/ADMIN generates invite link with tenantId embedded (signed JWT or token in DB). Invited user registers and joins existing tenant.
- Pros: Complete flow. OWNER controls who joins. Common SaaS pattern.
- Cons: Need invite token storage (or JWT), invite email sending, role assignment UI.
- When: When customers ask for team access.

**C: Admin-only registration**
- Essence: Remove self-registration. Admin creates accounts manually.
- Cons: Does not scale. Bad UX. Not for SaaS.

**Decision: Option A now, add Option B when needed.**

The current registration flow is correct. Adding invite flow is a feature request, not an architecture decision. When the first customer asks "how do I add my team?" -- build it then. The schema already supports multiple users per tenant with roles.

---

### Question 5: PostgreSQL RLS as Additional Protection

**Decision: No, not now.**

Detailed reasoning above in Question 3, Option C. Summary:
- Prisma + PrismaPg adapter does not support `SET LOCAL` cleanly
- Manual where clauses + `requireAuth()` helper provide sufficient isolation for current scale
- RLS adds debugging complexity (invisible row filtering causes confusing "no data" bugs)
- Revisit when handling regulated/financial data or when a security audit requires it

---

### Implementation Plan (Recommended)

**Step 1: Create `requireAuth()` helper** (30 min)
- File: `/root/smart-analyze/src/lib/auth.ts` (add to existing file)
- Function returns `{ userId, tenantId, role }` or throws
- Add `AuthError` class that maps to 401 response

**Step 2: Fix 3 broken settings routes** (30 min)
- Replace `getTenantId()` with `requireAuth()` in:
  - `src/app/api/settings/scripts/route.ts`
  - `src/app/api/settings/telegram/route.ts`
  - `src/app/api/settings/crm/route.ts`
- Delete the broken `getTenantId()` function from all 3 files

**Step 3: Refactor existing routes to use `requireAuth()`** (1 hour)
- Update the 7 routes that already do session checks to use the shared helper
- This is optional but reduces duplication and ensures consistency

**Step 4: Add tenant isolation lint rule** (optional, 15 min)
- Add a grep-based CI check: no route.ts file should import `db` without also importing `requireAuth`
- Or: ESLint rule that flags `db.tenant.findFirst()` as an error

---

### Risk Summary

| Risk | Severity | Mitigation |
|------|----------|------------|
| Forget tenantId in new route | Medium | `requireAuth()` helper makes pattern obvious; code review |
| Session expired mid-request | Low | JWT strategy with proper expiry; `requireAuth()` throws early |
| Cross-tenant data leak in aggregation queries | Medium | Always include tenantId in WHERE; test with 2+ tenants in dev |
| Performance at scale (shared DB) | Low (< 1000 tenants) | Add DB indexes on tenantId columns (Prisma already creates FK indexes) |
