# Expert Analysis: Security & Secrets Management for Multi-Tenant SalesGuru

## Aspect: Security & Secrets Management

### Project Context

**Critical findings from code audit:**

1. **CRITICAL: Broken tenant isolation in 3 settings routes.** Files `/root/smart-analyze/src/app/api/settings/crm/route.ts`, `telegram/route.ts`, and `scripts/route.ts` use a `getTenantId()` function that calls `db.tenant.findFirst()` with NO filter — it returns the FIRST tenant in the database, not the authenticated user's tenant. Any authenticated user hitting these endpoints reads/writes the first tenant's CRM keys and Telegram tokens. This is a show-stopping bug for multi-tenant.

2. **API keys stored in plaintext.** `CrmConfig.apiKey` (amoCRM bearer tokens), `CrmConfig.webhookUrl` (Bitrix24 webhook with embedded auth), and `TelegramConfig.botToken` are all stored as plain `String` in PostgreSQL with zero encryption.

3. **No Row-Level Security.** Tenant isolation relies entirely on application-level `WHERE tenantId = X` clauses. A single missed filter (like the `getTenantId` bug above) exposes all tenants' data.

4. **Inconsistent auth patterns.** Some API routes (sync, analyze, quality, transcribe) properly use `getServerSession(authOptions)` to extract `session.user.tenantId`. Settings routes skip auth entirely and use the broken `getTenantId()` helper.

5. **Sensitive PII stored.** `CallRecord` stores `clientName`, `clientPhone`, `transcript` (full call text), `audioUrl`. `Message.content` contains sales conversation text. `Deal.amount` contains financial data. None encrypted.

6. **No rate limiting.** No per-tenant or global rate limiting on any API route.

7. **Env vars contain global CRM credentials.** `.env` has `AMOCRM_SUBDOMAIN` and `AMOCRM_ACCESS_TOKEN` at the app level — these appear to be a single-tenant legacy. Multi-tenant should only use per-tenant `CrmConfig` records.

8. **JWT session strategy.** Using JWT (not database sessions) via NextAuth. JWT tokens contain `tenantId` and `role`. NEXTAUTH_SECRET is set. This is acceptable but JWT cannot be revoked server-side.

**Relevant files:**
- `/root/smart-analyze/src/lib/auth.ts` — NextAuth config, JWT callbacks
- `/root/smart-analyze/src/lib/db.ts` — Prisma client singleton
- `/root/smart-analyze/prisma/schema.prisma` — full data model
- `/root/smart-analyze/src/app/api/settings/crm/route.ts` — BROKEN tenant isolation
- `/root/smart-analyze/src/app/api/settings/telegram/route.ts` — BROKEN tenant isolation
- `/root/smart-analyze/src/app/api/settings/scripts/route.ts` — BROKEN tenant isolation
- `/root/smart-analyze/src/app/api/sync/route.ts` — CORRECT session-based auth

---

### Expert Analysis

> "Analyzing as Troy Hunt (Security) because this is fundamentally about protecting customer secrets, preventing cross-tenant data leakage, and compliance with data protection laws for a paid B2B SaaS."
>
> **Principles from 3 experts:**
> 1. **Sam Newman (Architecture):** "Bounded context — each tenant's data must be a hard boundary, not a soft convention"
> 2. **Theo Browne (API design):** "Fail fast, explicit errors — auth middleware should reject before business logic runs"
> 3. **Martin Kleppmann (Distributed systems):** "Defense against Byzantine faults — assume any component can behave incorrectly, design for safe defaults"

---

### Vulnerability Triage (Priority Order)

#### P0 (Fix Before Any Paying Customer)

**V1: Broken Tenant Isolation in Settings Routes**
- **What:** `getTenantId()` in crm/telegram/scripts routes calls `db.tenant.findFirst()` with no filter. Returns first tenant regardless of who is logged in.
- **Impact:** Tenant A can read/modify Tenant B's CRM API keys and Telegram bot tokens.
- **Fix:** Replace all `getTenantId()` calls with session-based auth:
```typescript
// Create shared helper: src/lib/api/auth.ts
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function requireTenantId(): Promise<string> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    throw new ApiError(401, "Unauthorized")
  }
  return session.user.tenantId
}
```
- **Effort:** 1 hour. Search-replace in 3 files.

**V2: Plaintext API Keys**
- **What:** CRM bearer tokens and Telegram bot tokens stored as plain strings.
- **Impact:** Database breach = instant access to all customers' CRM systems.
- **Fix:** See Options A/B/C below.

#### P1 (Fix Before 5+ Customers)

**V3: No Row-Level Security**
- Application-level `WHERE tenantId` is the only barrier. Missing it anywhere = data leak.

**V4: No Rate Limiting**
- One tenant can exhaust API quota, causing DoS for all tenants.

**V5: Audio/Transcript PII**
- Call recordings, transcripts, client phone numbers stored without encryption or retention policy.
- 152-FZ (Russian data protection law) requires: consent for recording, limited retention, access controls.

#### P2 (Fix Before Scale)

**V6: JWT Cannot Be Revoked**
- If a user's session needs to be terminated (employee fired, account compromised), JWT stays valid until expiry.

**V7: No Audit Logging**
- No record of who accessed what data, when. Required for B2B compliance.

---

### Solution Options

#### Question 1: How to Encrypt API Keys at Rest

**Option A: App-Level AES-256-GCM Encryption (Recommended)**
- **Essence:** Create `src/lib/crypto.ts` with `encrypt(plaintext)` / `decrypt(ciphertext)` using Node.js `crypto` module. AES-256-GCM with random IV per value. Master key from `ENCRYPTION_KEY` env var.
- **Implementation:**
```typescript
// src/lib/crypto.ts
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex') // 32 bytes

export function encrypt(text: string): string {
  const iv = randomBytes(16)
  const cipher = createCipheriv(ALGORITHM, KEY, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // Format: iv:tag:ciphertext (all base64)
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`
}

export function decrypt(data: string): string {
  const [ivB64, tagB64, encB64] = data.split(':')
  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const encrypted = Buffer.from(encB64, 'base64')
  const decipher = createDecipheriv(ALGORITHM, KEY, iv)
  decipher.setAuthTag(tag)
  return decipher.update(encrypted) + decipher.final('utf8')
}
```
- **Prisma integration:** Encrypt before `create/update`, decrypt after `findFirst/findMany` in a thin wrapper or Prisma middleware.
- **Pros:** Simple, no DB extensions needed, works with any PostgreSQL, key rotation possible by re-encrypting.
- **Cons:** Key management is on you (env var). If ENCRYPTION_KEY leaks alongside DB, encryption is moot.
- **When:** Single-server deployment, small team, need it working in 1-2 hours.

**Option B: PostgreSQL pgcrypto Extension**
- **Essence:** Use `pgp_sym_encrypt()`/`pgp_sym_decrypt()` in raw SQL queries.
- **Pros:** Encryption at DB layer, transparent to some queries.
- **Cons:** Breaks Prisma's type system. Raw SQL everywhere for encrypted fields. Key still passed as query parameter. Harder to test. Poor DX.
- **When:** If you were using raw SQL anyway and wanted DB-level guarantee.

**Option C: External Secrets Manager (HashiCorp Vault / AWS KMS)**
- **Essence:** Store encryption keys in Vault/KMS. App fetches key at startup or delegates encrypt/decrypt to the service.
- **Pros:** Key never in env vars. Audit trail. Key rotation built-in. Industry standard.
- **Cons:** Massive overkill for current scale (1 server, <10 tenants). Adds infrastructure dependency. Latency on every decrypt.
- **When:** 50+ tenants, SOC2/ISO27001 compliance required, dedicated DevOps team.

**Decision (Troy Hunt): Option A.** For a 1-server deployment with <10 tenants, app-level AES-256-GCM is the right balance. The master key in an env var is acceptable IF the server has restricted SSH access (which it does — key-based only). Upgrade to Vault when you hit 50+ tenants or need SOC2.

---

#### Question 2-3: Tenant Data Isolation & Row-Level Security

**Option A: Application-Level Isolation with Centralized Auth Middleware (Recommended Now)**
- **Essence:** Create `requireTenantId()` helper that ALL API routes must use. Enforce via lint rule or code review. Add `@@index([tenantId])` to all tenant-scoped models.
- **Pros:** Simple, works immediately, no DB migration.
- **Cons:** Relies on developer discipline. One missed WHERE = data leak.
- **When:** <10 tenants, small codebase, fast iteration needed.

**Option B: PostgreSQL Row-Level Security (RLS)**
- **Essence:** Enable RLS on all tenant-scoped tables. Create policies like `CREATE POLICY tenant_isolation ON "Deal" USING ("tenantId" = current_setting('app.tenant_id'))`. Set `app.tenant_id` at connection start via `SET LOCAL`.
- **Implementation complexity with Prisma:** Prisma doesn't natively support `SET LOCAL`. You'd need to use `$executeRawUnsafe` before each query block or use a connection pool middleware.
- **Pros:** Database-level guarantee. Even raw SQL mistakes can't leak data. Defense in depth.
- **Cons:** Complex with Prisma. Performance overhead for SET on each request. Harder to debug. Migration is non-trivial (must create policies for ~15 tables).
- **When:** 10+ tenants, regulatory pressure, or after a near-miss data leak.

**Option C: Schema-Per-Tenant**
- **Essence:** Each tenant gets their own PostgreSQL schema. Prisma connects to different schemas.
- **Pros:** Strongest isolation. Easy per-tenant backup/restore. No RLS complexity.
- **Cons:** Schema migrations must run N times. Prisma doesn't handle multi-schema well. Connection pooling nightmare. Doesn't scale past ~50 tenants on single server.
- **When:** Enterprise customers demand data isolation guarantees (e.g., banks).

**Decision (Troy Hunt): Option A now, migrate to Option B at 10+ tenants.** The immediate priority is fixing the broken `getTenantId()` function. RLS is the right long-term answer but the Prisma integration friction means it's a 2-3 day project. Do it as a planned sprint, not a hotfix.

---

#### Question 4: Audio File Storage Isolation

**Option A: Prefixed Paths in Single Bucket (Recommended)**
- **Essence:** Store audio at `/{tenantId}/calls/{callRecordId}.wav`. Generate pre-signed URLs with tenant prefix validation.
- **Pros:** Simple. One bucket to manage. Works with local disk or S3-compatible storage.
- **Cons:** Misconfigured access could expose cross-tenant files.
- **When:** <50 tenants, single storage backend.

**Option B: Separate Bucket Per Tenant**
- **Essence:** One S3 bucket per tenant with separate IAM policies.
- **Pros:** Strongest isolation. Easy to delete all tenant data on churn.
- **Cons:** Operational overhead. Bucket proliferation. Not practical with local disk.
- **When:** Enterprise compliance requirements, 50+ tenants.

**Decision: Option A.** Currently audio URLs point to external CRM sources (amoCRM serves the audio). When/if you cache audio locally, use prefixed paths with tenant ID validation in the serving layer.

---

#### Question 5: 152-FZ Compliance for Call Recordings

**Minimum requirements:**
1. **Consent notice:** Clients must inform their callers that calls are recorded and analyzed by AI. Add a disclaimer in onboarding flow.
2. **Data processing agreement (DPA):** SalesGuru acts as a data processor. Need a standard DPA template for each client.
3. **Retention policy:** Add `retentionDays` field to Tenant model. Cron job to delete call records + transcripts older than N days. Default: 90 days.
4. **Data export/deletion:** Implement tenant data export (GDPR Article 20 equivalent) and full deletion on contract termination.
5. **Access logging:** Log who accessed which call records (see V7 audit logging).
6. **Data localization:** Server is already in Russia (Timeweb), which satisfies 152-FZ data residency requirement.

**Implementation priority:** Add retention policy and DPA template before onboarding paid customers. The rest can follow within 30 days.

---

#### Question 6: Session Security

**Current state:** JWT strategy with `tenantId` in token. NEXTAUTH_SECRET is set.

**Improvements needed:**
1. **Set JWT expiry.** Add `maxAge: 24 * 60 * 60` (24h) to session config. Currently defaults to 30 days — too long for B2B SaaS with financial data.
2. **Add CSRF protection.** NextAuth handles this for form submissions but custom API routes may need explicit CSRF tokens.
3. **Validate tenantId on each request.** The JWT contains tenantId, but if a user is removed from a tenant, the JWT still works. Add a lightweight DB check (cache for 5 minutes):
```typescript
// In requireTenantId():
const user = await db.user.findUnique({
  where: { id: session.user.id },
  select: { tenantId: true }
})
if (user?.tenantId !== session.user.tenantId) {
  throw new ApiError(401, "Session invalidated")
}
```
4. **Secure cookie flags.** Ensure `secureCookie: true` in production (NextAuth does this by default when `NEXTAUTH_URL` uses https).

---

#### Question 7: Rate Limiting Per Tenant

**Recommended approach: In-memory rate limiter with `next-rate-limit` or custom middleware.**

```typescript
// src/middleware.ts (Next.js middleware)
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const rateLimits = new Map<string, { count: number; resetAt: number }>()

export function middleware(request: NextRequest) {
  // Only rate-limit API routes
  if (!request.nextUrl.pathname.startsWith('/api/')) return NextResponse.next()

  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  const now = Date.now()
  const window = 60_000 // 1 minute
  const maxRequests = 100 // per minute per IP

  const entry = rateLimits.get(ip)
  if (!entry || entry.resetAt < now) {
    rateLimits.set(ip, { count: 1, resetAt: now + window })
    return NextResponse.next()
  }

  entry.count++
  if (entry.count > maxRequests) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  return NextResponse.next()
}
```

For tenant-level limits (e.g., 1000 API calls/day per tenant on BASIC plan), add a `tenantRateLimit` table or use Redis when available.

---

### Implementation Roadmap

| Priority | Task | Effort | Risk if Skipped |
|----------|------|--------|-----------------|
| P0-1 | Fix `getTenantId()` in 3 settings routes — use session auth | 1h | **Cross-tenant data leak** |
| P0-2 | Create `requireTenantId()` centralized helper | 1h | Inconsistent auth patterns |
| P0-3 | Implement `src/lib/crypto.ts` (AES-256-GCM) | 2h | Plaintext API keys in DB |
| P0-4 | Encrypt CrmConfig.apiKey, webhookUrl, TelegramConfig.botToken | 2h | Credential theft on DB breach |
| P0-5 | Migration script to encrypt existing plaintext values | 1h | Existing data unprotected |
| P1-1 | Add JWT maxAge (24h) | 15min | Stale sessions persist 30 days |
| P1-2 | Add basic rate limiting middleware | 2h | DoS risk |
| P1-3 | Add retentionDays to Tenant + cleanup cron | 3h | 152-FZ non-compliance |
| P1-4 | Audit all API routes for auth consistency | 2h | Unknown auth gaps |
| P2-1 | Implement PostgreSQL RLS | 1-2 days | App-level isolation only |
| P2-2 | Add audit logging for sensitive operations | 1 day | No forensics capability |
| P2-3 | Implement tenant data export/deletion | 1 day | GDPR/152-FZ gaps |

**Total P0 effort: ~7 hours. Must be done before second paying customer.**

---

### Decision from Troy Hunt

**The single most dangerous issue is the `getTenantId()` function that returns `db.tenant.findFirst()` with no filter.** This is not a theoretical risk — it is an active cross-tenant data leak waiting to happen the moment a second tenant is created. Fix this before anything else.

For encryption, Option A (app-level AES-256-GCM) is the pragmatic choice. Generate a 32-byte key with `openssl rand -hex 32`, store it in `.env` as `ENCRYPTION_KEY`, and encrypt all secrets before they hit the database. This takes 2 hours and eliminates the "database backup = credential theft" attack vector.

RLS (Option B for isolation) is the correct long-term architecture but should be implemented as a planned sprint after the P0 fixes, not rushed alongside them.

**Risks to watch during implementation:**
- Key rotation strategy: document how to rotate ENCRYPTION_KEY without downtime (re-encrypt all values with new key, support reading both old and new format during transition).
- Prisma middleware for transparent encrypt/decrypt can hide complexity — consider explicit encrypt/decrypt calls in the CRM config service layer instead.
- The `.env` file contains `AMOCRM_ACCESS_TOKEN` at the global level — this should be removed once per-tenant CRM configs are working. It is a single-tenant remnant.
