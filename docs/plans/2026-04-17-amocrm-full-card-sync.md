# amoCRM Full Card Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract every piece of sales-relevant data from amoCRM lead cards (correct funnel, current stage, stage history, tasks) into our DB so Phase-2 analytics has complete input.

**Architecture:** Three surgical gaps are fixed in one coherent pass: (1) the `stageMap` funnel-assignment bug is rewritten to use `lead.pipeline_id` directly (amoCRM status IDs 142/143 are *global* and collide across pipelines); (2) `Deal.currentStageId` is populated on upsert, and `DealStageHistory` is accumulated from each sync run (open record on entry, close on stage change); (3) a new `Task` model and adapter method import `/api/v4/tasks` per tenant. After code lands we re-sync reklamalift74 and vastu with their agreed filter sets to replace the current partial data.

**Tech Stack:** Next.js 16, Prisma 7 (custom output `src/generated/prisma/client`), PostgreSQL in Docker, tsx for scripts, amoCRM v4 REST API (7 req/s throttle).

**IMPORTANT — repo caveats:**
- Next.js 16 has breaking changes — this plan does NOT touch Next.js routes/components, only adapters/schema/scripts, so no need to read `node_modules/next/dist/docs/` for this work. If you discover a route change is needed, STOP and consult the docs first.
- No test framework in repo (no jest/vitest). Verification is SQL assertions + smoke-scripts run in a helper container.
- Server `/root/smart-analyze` git is diverged from origin — deploy via `scp`, not `git pull`.
- Prisma migrations on server apply via idempotent raw SQL (`IF NOT EXISTS`).

**Helper-run (use this everywhere a script needs to execute on the server):**
```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 \
  'docker run --rm --network smart-analyze_default \
     -v /root/smart-analyze:/app -w /app node:22-slim \
     sh -c "set -a && . /app/.env && set +a && ./node_modules/.bin/tsx scripts/<script>.ts [args]"'
```

---

## Task 1: Diagnose and fix the `stageMap` funnel collision (bug #14)

**Why this is first:** Any subsequent work on stages re-uses `status_id` lookup. If the bug stays, `currentStageId` will also be wrong. Fix the foundation before building on top.

**Files:**
- Modify: `src/lib/crm/amocrm.ts:274-305` (the `stageMap` build and the `.map(l => ...)` block)
- No schema change yet (that's Task 2)

**Root cause (confirmed by code reading):** `stageMap` is keyed by `status_id` alone. amoCRM reuses status IDs `142` (Успешно реализовано) and `143` (Закрыто и не реализовано) as *global* terminal statuses across every pipeline. The for-loop overwrites earlier pipelines when a later pipeline declares the same status_id, so every WON/LOST deal gets reassigned to whichever pipeline comes last in `getFunnels()` output.

**Fix approach:** Use `lead.pipeline_id` directly as the funnel identity (it's already on every `AmoLead`). `stageMap` remains useful only to resolve the *stage name*, and its key must become `${pipeline_id}:${status_id}` to avoid the collision.

**Step 1: Read current code to confirm the exact window**

Run: `sed -n '274,305p' /Users/kirillmalahov/smart-analyze/src/lib/crm/amocrm.ts`
Expected output includes `stageMap.set(s.crmId, { funnelId: f.crmId, ... })` on one line and `const stageInfo = stageMap.get(String(l.status_id))` below.

**Step 2: Apply the fix**

Edit `src/lib/crm/amocrm.ts`. Replace lines 274-305 (the `stageMap` construction and the `.map(l => ...)` return block).

Old block (exact):
```ts
    // Build stage map from pipelines
    const funnels = await this.getFunnels()
    const stageMap = new Map<
      string,
      { funnelId: string; funnelName: string; stageName: string }
    >()
    for (const f of funnels) {
      for (const s of f.stages) {
        stageMap.set(s.crmId, {
          funnelId: f.crmId,
          funnelName: f.name,
          stageName: s.name,
        })
      }
    }

    return leads.map((l) => {
      const stageInfo = stageMap.get(String(l.status_id))
      const user = l.responsible_user_id
        ? userMap.get(l.responsible_user_id)
        : null

      return {
        crmId: String(l.id),
        title: l.name ?? "",
        amount: l.price ?? null,
```

New block:
```ts
    // Build lookup tables from pipelines.
    // IMPORTANT: amoCRM status IDs 142/143 (Успех/Неуспех) are GLOBAL — they appear in
    // every pipeline with the same ID. Keying stageMap by status_id alone causes the
    // last-iterated pipeline to overwrite all earlier ones. Key by pipeline+status.
    const funnels = await this.getFunnels()
    const funnelNameById = new Map<string, string>()
    const stageByPipeAndStatus = new Map<
      string, // `${pipeline_id}:${status_id}`
      { stageCrmId: string; stageName: string }
    >()
    for (const f of funnels) {
      funnelNameById.set(f.crmId, f.name)
      for (const s of f.stages) {
        stageByPipeAndStatus.set(`${f.crmId}:${s.crmId}`, {
          stageCrmId: s.crmId,
          stageName: s.name,
        })
      }
    }

    return leads.map((l) => {
      const pipelineId = String(l.pipeline_id)
      const statusId = String(l.status_id)
      const stageInfo = stageByPipeAndStatus.get(`${pipelineId}:${statusId}`)
      const user = l.responsible_user_id
        ? userMap.get(l.responsible_user_id)
        : null

      return {
        crmId: String(l.id),
        title: l.name ?? "",
        amount: l.price ?? null,
```

Then further down in that same `.map()` body (still within the same file), ensure these three fields are present (they already exist — verify wording):
```ts
        funnelId: pipelineId,                     // from lead, not from status lookup
        funnelName: funnelNameById.get(pipelineId) ?? null,
        stageName: stageInfo?.stageName ?? null,
```

If the current code has `funnelId: stageInfo?.funnelId ?? String(l.pipeline_id) ?? null` and `funnelName: stageInfo?.funnelName ?? null` (as of today), replace those two lines with the cleaner versions above. The `funnelId` becomes always `pipelineId`, `funnelName` comes from the new `funnelNameById` map.

**Step 3: Type-check**

Run: `cd /Users/kirillmalahov/smart-analyze && npx tsc --noEmit 2>&1 | grep -E "amocrm\.ts" | head -10`
Expected: no errors mentioning `amocrm.ts`. Pre-existing unrelated errors in other files are acceptable.

**Step 4: Commit**

```bash
cd /Users/kirillmalahov/smart-analyze
git add src/lib/crm/amocrm.ts
git commit -m "fix(amocrm): resolve funnel via pipeline_id, not status_id

amoCRM system statuses 142/143 (Успех/Неуспех) are global across every
pipeline. Keying stageMap by status_id alone caused the last-loaded pipeline
to overwrite all earlier ones — reklama filter sync (Горячие+Холодные) put
557/681 deals into the unused Отказ funnel.

Fix: use lead.pipeline_id directly as funnelId. Keep stageMap keyed by
\`pipeline_id:status_id\` for stage-name resolution only."
```

---

## Task 2: Schema migration — `Deal.currentStageCrmId`, `Task` model

**Files:**
- Modify: `prisma/schema.prisma` (add `currentStageCrmId` to `Deal`, add `Task` model)
- Create: `prisma/migrations/20260418000000_add_stage_and_tasks/migration.sql`

**Why we store `currentStageCrmId` (not a FK to `FunnelStage.id`):** `FunnelStage.id` is our internal cuid. We already have the amoCRM status_id (stable between syncs) on the deal via the adapter. Storing the CRM-side id as a plain string lets us populate `Deal.currentStageCrmId` in the same upsert call as the deal itself, without a JOIN round-trip. A simple SQL query later joins `Deal` to `FunnelStage` on `(Deal.currentStageCrmId = FunnelStage.crmId AND FunnelStage.funnelId = Deal.funnelId)` when we need the stage name in UI.

**Step 1: Edit the Prisma schema**

Open `/Users/kirillmalahov/smart-analyze/prisma/schema.prisma` and add one field to the `Deal` model (insert right after `duration`, before `createdAt`):

```prisma
  currentStageCrmId String?
```

Then add the new `Task` model and `TaskType` enum at the bottom of the file (before or after `DealStageHistory`, consistent with existing style):

```prisma
enum TaskType {
  CALL
  MEETING
  LETTER
  OTHER
}

model Task {
  id            String    @id @default(cuid())
  tenantId      String
  tenant        Tenant    @relation(fields: [tenantId], references: [id])
  dealId        String?
  deal          Deal?     @relation(fields: [dealId], references: [id], onDelete: SetNull)
  managerId     String?
  manager       Manager?  @relation(fields: [managerId], references: [id])

  crmId         String?   // amoCRM task id
  type          TaskType
  text          String
  createdAt     DateTime
  dueAt         DateTime?
  completedAt   DateTime?
  isCompleted   Boolean   @default(false)

  @@index([tenantId, managerId])
  @@index([tenantId, dealId])
}
```

Don't forget to add the `tasks Task[]` back-relation on `Tenant`, `Manager`, and `Deal` (Prisma requires both sides for 1-to-many). Locate those three models and add:

- `Tenant`: add `tasks Task[]` alongside `deals Deal[]` etc.
- `Manager`: add `tasks Task[]`
- `Deal`: add `tasks Task[]`

**Step 2: Write the raw-SQL migration**

Create `/Users/kirillmalahov/smart-analyze/prisma/migrations/20260418000000_add_stage_and_tasks/migration.sql`:

```sql
-- Add currentStageCrmId to Deal
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Deal' AND column_name = 'currentStageCrmId'
  ) THEN
    ALTER TABLE "Deal" ADD COLUMN "currentStageCrmId" TEXT;
  END IF;
END$$;

-- Create TaskType enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TaskType') THEN
    CREATE TYPE "TaskType" AS ENUM ('CALL', 'MEETING', 'LETTER', 'OTHER');
  END IF;
END$$;

-- Create Task table
CREATE TABLE IF NOT EXISTS "Task" (
  "id"          TEXT PRIMARY KEY,
  "tenantId"    TEXT NOT NULL,
  "dealId"      TEXT,
  "managerId"   TEXT,
  "crmId"       TEXT,
  "type"        "TaskType" NOT NULL,
  "text"        TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL,
  "dueAt"       TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "isCompleted" BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT "Task_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "Task_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "Task_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "Task_tenantId_managerId_idx" ON "Task"("tenantId", "managerId");
CREATE INDEX IF NOT EXISTS "Task_tenantId_dealId_idx" ON "Task"("tenantId", "dealId");
```

**Step 3: Regenerate Prisma client locally + type-check**

Run: `cd /Users/kirillmalahov/smart-analyze && npx prisma generate`
Expected: `Generated Prisma Client ... to ./src/generated/prisma`.

Run: `npx tsc --noEmit 2>&1 | grep -E "prisma|schema|Task" | head -10`
Expected: no errors about missing `Task` or `currentStageCrmId`.

**Step 4: Apply migration on server (idempotent)**

```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 \
  'docker exec -i smart-analyze-db psql -U smartanalyze -d smartanalyze' \
  < prisma/migrations/20260418000000_add_stage_and_tasks/migration.sql
```

Expected: zero errors (each step is wrapped in `IF NOT EXISTS`).

Verify column exists:
```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 \
  'docker exec smart-analyze-db psql -U smartanalyze -d smartanalyze -c "\d \"Deal\"" | grep currentStageCrmId'
```
Expected: `currentStageCrmId | text |`.

Verify Task table:
```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 \
  'docker exec smart-analyze-db psql -U smartanalyze -d smartanalyze -c "\dt \"Task\""'
```
Expected: one row naming `Task` as a table.

**Step 5: Regenerate Prisma client on the server**

```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 \
  'docker run --rm -v /root/smart-analyze:/app -w /app node:22-slim \
     sh -c "set -a && . /app/.env && set +a && ./node_modules/.bin/prisma generate"'
```
Expected: `Generated Prisma Client`.

**Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260418000000_add_stage_and_tasks/
git commit -m "feat(schema): add Deal.currentStageCrmId + Task model

Two schema additions in one migration to minimise server round-trips.
Task model covers amoCRM /tasks (and will be reused for Bitrix24 later).
currentStageCrmId is a plain string (amoCRM status_id) — FunnelStage FK
resolution happens via join at query time."
```

---

## Task 3: Extend `CrmDeal` and `CrmAdapter` types

**Files:**
- Modify: `src/lib/crm/types.ts`

**Step 1: Add `stageCrmId` to `CrmDeal`**

Open `src/lib/crm/types.ts` and add one field to the `CrmDeal` interface (right after `stageName`):

```ts
  stageCrmId: string | null
```

**Step 2: Add `CrmTask` and extend `CrmAdapter`**

Append to the same file:
```ts
export interface CrmTask {
  crmId: string
  dealCrmId: string | null
  managerCrmId: string | null
  type: "CALL" | "MEETING" | "LETTER" | "OTHER"
  text: string
  createdAt: Date
  dueAt: Date | null
  completedAt: Date | null
  isCompleted: boolean
}
```

Then inside the `CrmAdapter` interface add one method:
```ts
  getTasks(since?: Date): Promise<CrmTask[]>
```

**Step 3: Type-check — existing adapters will fail**

Run: `cd /Users/kirillmalahov/smart-analyze && npx tsc --noEmit 2>&1 | grep -E "CrmAdapter|getTasks|stageCrmId" | head -10`
Expected: errors saying `Bitrix24Adapter`, `GetCourseAdapter`, `AmoCrmAdapter` don't implement `getTasks`. These are intentional — we'll satisfy them next. If errors mention other problems, stop and diagnose.

**Step 4: Stub non-amoCRM adapters (return empty)**

In `src/lib/crm/bitrix24.ts`, add at the end of the class body (before the closing brace):
```ts
  async getTasks(): Promise<CrmTask[]> {
    // TODO: implement in B24 pre-Phase-1 task #9
    return []
  }
```
Add the import if missing: `import { CrmTask } from "./types"` (or whatever the existing import path for other types is).

In `src/lib/crm/getcourse.ts` do the same — `async getTasks(): Promise<CrmTask[]> { return [] }`.

Also in both adapters, update the `getDeals` return to include `stageCrmId: null` in every emitted `CrmDeal` object (find the `return { crmId: ..., title: ... }` block and add `stageCrmId: null,`).

**Step 5: Type-check again**

Run: `cd /Users/kirillmalahov/smart-analyze && npx tsc --noEmit 2>&1 | grep -E "CrmAdapter|getTasks|stageCrmId" | head -10`
Expected: no errors. If `amocrm.ts` complains about missing `getTasks` and missing `stageCrmId` — good, that's Task 4 and Task 5.

**Step 6: Commit**

```bash
git add src/lib/crm/types.ts src/lib/crm/bitrix24.ts src/lib/crm/getcourse.ts
git commit -m "feat(crm-types): add CrmTask + CrmDeal.stageCrmId

Non-amoCRM adapters stub getTasks and emit stageCrmId=null until their
own implementations land (tasks #8, #9)."
```

---

## Task 4: `AmoCrmAdapter.getDeals` — emit `stageCrmId`

**Files:**
- Modify: `src/lib/crm/amocrm.ts` (the `.map()` block already touched in Task 1)

**Step 1: Add `stageCrmId` to the emitted object**

In the `.map(l => ...)` block, add the `stageCrmId` field to the returned `CrmDeal`:

```ts
        stageCrmId: String(l.status_id),
```

Place it immediately after the existing `stageName` line, to keep grouping intuitive.

**Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "amocrm\.ts" | head -10`
Expected: no errors in amocrm.ts.

**Step 3: Commit**

```bash
git add src/lib/crm/amocrm.ts
git commit -m "feat(amocrm): emit stageCrmId on every deal"
```

---

## Task 5: `AmoCrmAdapter.getTasks` implementation

**Files:**
- Modify: `src/lib/crm/amocrm.ts`

**API docs for reference (don't hit the endpoint yet):**
- `GET /api/v4/tasks?filter[entity_type]=leads&filter[updated_at][from]=<unix-ts>&page=N&limit=250`
- Response: `_embedded.tasks[]` with fields `id`, `entity_id`, `entity_type`, `responsible_user_id`, `task_type_id` (1=call, 2=meeting, 3=letter, else=other), `text`, `created_at`, `complete_till`, `is_completed`, `updated_at`.
- Pagination: same `_page_count` logic as other endpoints. `fetchAll` handles it.

**Step 1: Add the interface for the raw response**

Near the other `Amo*` interfaces (top of the class or adjacent section), add:

```ts
interface AmoTask {
  id: number
  entity_id: number      // lead id
  entity_type: "leads" | "contacts" | "companies" | "customers"
  responsible_user_id: number
  task_type_id: number
  text: string
  created_at: number
  complete_till: number
  updated_at: number
  is_completed: boolean
}
```

**Step 2: Add helper — map `task_type_id` → internal type**

Above the class or as a top-level function:

```ts
function mapTaskType(id: number): CrmTask["type"] {
  switch (id) {
    case 1: return "CALL"
    case 2: return "MEETING"
    case 3: return "LETTER"
    default: return "OTHER"
  }
}
```

**Step 3: Add the method on `AmoCrmAdapter`**

Place it next to `getMessages`:

```ts
  async getTasks(since?: Date): Promise<CrmTask[]> {
    const params: Record<string, unknown> = {
      "filter[entity_type]": "leads",
    }
    if (since) {
      params["filter[updated_at][from]"] = Math.floor(since.getTime() / 1000)
    }

    const raw = await this.fetchAll<AmoTask>("/tasks", "tasks", params)

    return raw.map((t) => ({
      crmId: String(t.id),
      dealCrmId: t.entity_type === "leads" ? String(t.entity_id) : null,
      managerCrmId: t.responsible_user_id ? String(t.responsible_user_id) : null,
      type: mapTaskType(t.task_type_id),
      text: t.text ?? "",
      createdAt: new Date(t.created_at * 1000),
      dueAt: t.complete_till ? new Date(t.complete_till * 1000) : null,
      completedAt: t.is_completed ? new Date(t.updated_at * 1000) : null,
      isCompleted: Boolean(t.is_completed),
    }))
  }
```

**Step 4: Import `CrmTask` at top of file**

At the top of `amocrm.ts`, add `CrmTask` to the existing import from `./types`:

```ts
import { CrmAdapter, CrmDeal, CrmFunnel, CrmManager, CrmMessage, CrmTask } from "./types"
```

(The exact current import line should already exist — just add `CrmTask`.)

**Step 5: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "amocrm\.ts" | head -10`
Expected: no errors.

**Step 6: Commit**

```bash
git add src/lib/crm/amocrm.ts
git commit -m "feat(amocrm): implement getTasks() — amoCRM /api/v4/tasks leads filter"
```

---

## Task 6: `sync-engine` — populate `currentStageCrmId`, upsert `DealStageHistory` on change, sync tasks

**Files:**
- Modify: `src/lib/sync/sync-engine.ts`

**Step 1: Read current deal-upsert section to find the right insertion point**

Run: `grep -n "upsert\|await db.deal" src/lib/sync/sync-engine.ts | head -20`
Note the line numbers where `db.deal.upsert` happens in the deals loop. In the current code it's around line 190-220. Locate the actual call by reading lines 180-240.

**Step 2: Add `currentStageCrmId` to the deal upsert**

In both `create:` and `update:` blocks of `db.deal.upsert(...)`:

```ts
        currentStageCrmId: cd.stageCrmId,
```

Place it next to `funnelId`. This is a single line added to two places.

**Step 3: Add `DealStageHistory` tracking**

Right after the `db.deal.upsert(...)` call (still inside the `for (const cd of crmDeals)` loop), add:

```ts
        // Stage history: open new record when stage changes, close prior one
        if (cd.stageCrmId) {
          const dealRow = await db.deal.findUnique({
            where: { id: existingDealId ?? upsertedDeal.id },
            select: { id: true, currentStageCrmId: true },
          })
          // If we're about to change stage (old differs from new) — close prior record
          // Note: the upsert above ALREADY wrote currentStageCrmId. So at this point
          // dealRow.currentStageCrmId === cd.stageCrmId. We need a different hook —
          // read the prior stage BEFORE upsert. See refactor below.
        }
```

That comment exposes a problem: we need the prior stage *before* overwriting. Refactor: read the existing deal (by `crmId + tenantId`) first, compare `currentStageCrmId`, then upsert, then if changed: close old history record + open new one.

Implemented as:

```ts
      // Read prior stage BEFORE upsert so we can detect transitions
      const priorDeal = await db.deal.findFirst({
        where: { tenantId, crmId: cd.crmId ?? "" },
        select: { id: true, currentStageCrmId: true },
      })
      const priorStageCrmId = priorDeal?.currentStageCrmId ?? null

      // ... existing db.deal.upsert block (with currentStageCrmId: cd.stageCrmId) ...
      const upsertedDealId = priorDeal?.id ?? (
        await db.deal.findFirstOrThrow({
          where: { tenantId, crmId: cd.crmId ?? "" },
          select: { id: true },
        })
      ).id

      // Stage transition detection
      if (cd.stageCrmId && cd.stageCrmId !== priorStageCrmId) {
        // Resolve our FunnelStage.id (by funnelId + crmId)
        const stageRow = await db.funnelStage.findFirst({
          where: {
            funnel: { tenantId, crmId: cd.funnelId ?? "" },
            crmId: cd.stageCrmId,
          },
          select: { id: true },
        })
        if (stageRow) {
          // Close any prior open history record for this deal
          await db.dealStageHistory.updateMany({
            where: { dealId: upsertedDealId, leftAt: null },
            data: { leftAt: new Date() },
          })
          // Open a new one
          await db.dealStageHistory.create({
            data: {
              dealId: upsertedDealId,
              stageId: stageRow.id,
              enteredAt: new Date(),
              leftAt: null,
            },
          })
        }
      }
```

**IMPORTANT about history semantics:** this generates history relative to *our sync cadence*, not to the truth inside amoCRM. First sync of a deal opens one history record. Subsequent syncs extend or close it. This is a pragmatic compromise — amoCRM's `/leads/{id}/events?filter[type]=lead_status_changed` would give true history but requires one request per deal (N+1). Phase-2 can add that later; for now "when did we last see it in this stage" is already far better than nothing.

**Step 4: Add tasks sync at the end of the loop**

After the `for (const cd of crmDeals)` loop closes, add a new section that syncs tasks:

```ts
  // 6. Sync tasks
  onProgress?.({ step: "tasks", current: 0, total: 0 })
  const sinceForTasks = options?.sinceDays
    ? new Date(Date.now() - options.sinceDays * 24 * 60 * 60 * 1000)
    : undefined
  const crmTasks = await adapter.getTasks(sinceForTasks)
  onProgress?.({ step: "tasks", current: 0, total: crmTasks.length })

  for (let i = 0; i < crmTasks.length; i++) {
    const ct = crmTasks[i]

    // Resolve deal (may be null if task isn't attached to a lead we synced)
    const deal = ct.dealCrmId
      ? await db.deal.findFirst({
          where: { tenantId, crmId: ct.dealCrmId },
          select: { id: true },
        })
      : null

    // Resolve manager (same approach as deals)
    const manager = ct.managerCrmId
      ? await db.manager.findFirst({
          where: { tenantId, crmId: ct.managerCrmId },
          select: { id: true },
        })
      : null

    // Upsert by crmId
    const existing = await db.task.findFirst({
      where: { tenantId, crmId: ct.crmId },
      select: { id: true },
    })
    const commonData = {
      tenantId,
      dealId: deal?.id ?? null,
      managerId: manager?.id ?? null,
      crmId: ct.crmId,
      type: ct.type,
      text: ct.text,
      createdAt: ct.createdAt,
      dueAt: ct.dueAt,
      completedAt: ct.completedAt,
      isCompleted: ct.isCompleted,
    }
    if (existing) {
      await db.task.update({ where: { id: existing.id }, data: commonData })
    } else {
      await db.task.create({ data: commonData })
    }
    stats.tasks = (stats.tasks ?? 0) + 1
    onProgress?.({ step: "tasks", current: i + 1, total: crmTasks.length })
  }
```

Also update the `SyncResult` return type (either extend in place or in `types.ts` / sync-engine header). Add `tasks?: number` to the `SyncResult` interface and initialise `stats.tasks = 0` near the top where other stats are zeroed.

**Step 5: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "sync-engine\.ts" | head -20`
Expected: no errors.

**Step 6: Commit**

```bash
git add src/lib/sync/sync-engine.ts
git commit -m "feat(sync): populate currentStageCrmId, track stage history, sync tasks

- Deal upsert now writes currentStageCrmId from CrmDeal.stageCrmId
- Stage transitions detected vs prior DB row; DealStageHistory records
  opened on entry and closed (leftAt) on change — pragmatic history
  derived from sync cadence rather than amoCRM events
- New section imports amoCRM tasks per tenant (bulk /tasks endpoint)
  with same sinceDays filter as deals, upserts by crmId"
```

---

## Task 7: Deploy code to server

**Files:** none (deploy only)

**Step 1: scp adapter + sync-engine + types**

```bash
scp -i ~/.ssh/timeweb src/lib/crm/amocrm.ts    root@80.76.60.130:/root/smart-analyze/src/lib/crm/amocrm.ts
scp -i ~/.ssh/timeweb src/lib/crm/bitrix24.ts  root@80.76.60.130:/root/smart-analyze/src/lib/crm/bitrix24.ts
scp -i ~/.ssh/timeweb src/lib/crm/getcourse.ts root@80.76.60.130:/root/smart-analyze/src/lib/crm/getcourse.ts
scp -i ~/.ssh/timeweb src/lib/crm/types.ts     root@80.76.60.130:/root/smart-analyze/src/lib/crm/types.ts
scp -i ~/.ssh/timeweb src/lib/sync/sync-engine.ts root@80.76.60.130:/root/smart-analyze/src/lib/sync/sync-engine.ts
```

Expected: each scp prints a single line confirming transfer. No errors.

**Step 2: (Optional but recommended) Rebuild the production app container**

The sync scripts run via `tsx` from mounted source, so the files above are already picked up. But the **running** Next.js container still has the old sync-engine compiled in. If a user triggers "Sync" from the dashboard UI, old code would run. Rebuild:

```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 \
  'cd /root/smart-analyze && \
   docker compose -f docker-compose.prod.yml build app && \
   docker compose -f docker-compose.prod.yml up -d app && sleep 10 && \
   docker network connect qup_qupnet smart-analyze-app 2>/dev/null || true'
```

Expected: build completes in 1-3 min, container restarts cleanly. Log tail:
```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 'docker logs smart-analyze-app --tail 10'
```
Expected: `▲ Next.js 16.2.3 ... ✓ Ready`.

---

## Task 8: Pre-flight sanity — smoke one deal and one task

Before re-syncing both tenants, do a tiny dry run to catch blockers cheap.

**Files:** none (read-only)

**Step 1: Fetch a single deal from reklamalift74 via the new adapter path**

Write a tiny inline script on the server (or use the smoke-sync with a minimal filter). Easiest: run the full smoke-sync with `--pipelines=1916449 --days=1` (just today's Горячие):

```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 \
  'rm -f /root/smart-analyze/logs/smoke-dryrun.log; \
   docker run --rm --network smart-analyze_default -v /root/smart-analyze:/app -w /app node:22-slim \
     sh -c "set -a && . /app/.env && set +a && \
            ./node_modules/.bin/tsx scripts/smoke-sync.ts reklamalift74 --pipelines=1916449 --days=1" \
     > /root/smart-analyze/logs/smoke-dryrun.log 2>&1'
```

Wait for completion (should be under 1-2 min). Then:

```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 'tail -10 /root/smart-analyze/logs/smoke-dryrun.log'
```
Expected: a `Result:` line with non-zero counts AND `tasks: N`. An `Elapsed:` line follows. No `Error` lines.

**Step 2: Verify the new fields are populated in DB**

```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 \
  'docker exec smart-analyze-db psql -U smartanalyze -d smartanalyze -c \
   "SELECT t.name, COUNT(*) FILTER (WHERE d.\"currentStageCrmId\" IS NOT NULL) AS stages_set, \
           (SELECT COUNT(*) FROM \"Task\" WHERE \"tenantId\"=t.id) AS total_tasks, \
           (SELECT COUNT(*) FROM \"DealStageHistory\" dsh JOIN \"Deal\" d2 ON d2.id=dsh.\"dealId\" WHERE d2.\"tenantId\"=t.id) AS history_rows \
    FROM \"Tenant\" t \
    JOIN \"Deal\" d ON d.\"tenantId\"=t.id \
    WHERE t.name='"'"'reklamalift74'"'"' GROUP BY t.name;"'
```

Expected: `stages_set > 0`, `total_tasks >= 0` (may legitimately be 0 if no tasks today), `history_rows > 0`. If `stages_set = 0` — something is wrong with the upsert write or the adapter doesn't emit `stageCrmId`; stop and diagnose.

**Step 3: (No commit — read-only sanity check)**

---

## Task 9: Full re-sync reklamalift74 (Горячие + Холодные, 3 months)

**Files:** none (sync run only)

**Step 1: Launch in background, wait via monitor**

```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 \
  'rm -f /root/smart-analyze/logs/smoke-sync-reklama-v2.log; \
   nohup docker run --rm --network smart-analyze_default \
     -v /root/smart-analyze:/app -w /app node:22-slim \
     sh -c "set -a && . /app/.env && set +a && \
            ./node_modules/.bin/tsx scripts/smoke-sync.ts reklamalift74 --pipelines=1916449,1923097 --days=90" \
     > /root/smart-analyze/logs/smoke-sync-reklama-v2.log 2>&1 & disown'
```

Wait until the log contains `Elapsed:` (via Monitor tool, 30-min timeout).

Expected final line: `Elapsed: ~400-700s` (previous run without tasks took 384s, tasks add ~20-50%).

**Step 2: Verify result**

```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 \
  'docker exec smart-analyze-db psql -U smartanalyze -d smartanalyze -c \
   "SELECT (SELECT COUNT(*) FROM \"Deal\" WHERE \"tenantId\"=t.id) AS deals, \
           (SELECT COUNT(*) FROM \"Deal\" WHERE \"tenantId\"=t.id AND \"currentStageCrmId\" IS NOT NULL) AS deals_with_stage, \
           (SELECT COUNT(*) FROM \"Task\" WHERE \"tenantId\"=t.id) AS tasks, \
           (SELECT COUNT(*) FROM \"DealStageHistory\" dsh JOIN \"Deal\" d ON d.id=dsh.\"dealId\" WHERE d.\"tenantId\"=t.id) AS history_rows, \
           (SELECT f.name FROM \"Deal\" d JOIN \"Funnel\" f ON f.id=d.\"funnelId\" WHERE d.\"tenantId\"=t.id GROUP BY f.name ORDER BY COUNT(*) DESC LIMIT 1) AS dominant_funnel \
    FROM \"Tenant\" t WHERE t.name='"'"'reklamalift74'"'"';"'
```

Expected:
- `deals_with_stage / deals` ratio ≈ 1.0 (every synced deal has a stage)
- `tasks > 0`
- `history_rows >= deals_with_stage` (at least one per deal on first transition)
- `dominant_funnel = "Горячие"` (NOT "Отказ" — that was the bug we fixed)

**Step 3: No commit — verification only**

---

## Task 10: Full re-sync vastu (selected funnels, 3 months)

**Files:** none

**Step 1: Launch**

vastu's chosen pipelines (from anketa): `3216775` (1. Заказы), `5622598` (Регистрации), `10098890` (Стипендия).

```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 \
  'rm -f /root/smart-analyze/logs/smoke-sync-vastu-v2.log; \
   nohup docker run --rm --network smart-analyze_default \
     -v /root/smart-analyze:/app -w /app node:22-slim \
     sh -c "set -a && . /app/.env && set +a && \
            ./node_modules/.bin/tsx scripts/smoke-sync.ts vastu --pipelines=3216775,5622598,10098890 --days=90" \
     > /root/smart-analyze/logs/smoke-sync-vastu-v2.log 2>&1 & disown'
```

Wait via monitor.

Expected: `Elapsed:` present, no errors. Given vastu's higher activity (7333 updates in 3 months vs reklama's 840), this sync may take 30-60 minutes.

**Step 2: Verify**

Same SQL as Task 9 Step 2 but with `name='vastu'`. Expected:
- `deals_with_stage / deals ≈ 1.0`
- `tasks > 0` (школа явно ведёт задачи менеджерам)
- `history_rows >= deals_with_stage`
- `dominant_funnel = "1. Заказы"` (основная продажная воронка)

---

## Task 11: Final verification dashboard queries

**Files:**
- Create (optional, for reuse): `docs/plans/2026-04-17-amocrm-full-card-sync.verify.sql`

These SQL queries are what Phase-2 dashboards will build on — run them now as acceptance tests.

**Query A — Revenue & conversion per manager (reklama, already works, should now include currentStageCrmId availability):**

```sql
SELECT m.name AS manager,
       COUNT(*) FILTER (WHERE d.status='WON') AS won,
       COUNT(*) FILTER (WHERE d.status='LOST') AS lost,
       COUNT(*) FILTER (WHERE d.status='OPEN') AS open,
       TO_CHAR(COALESCE(SUM(d.amount) FILTER (WHERE d.status='WON'), 0), 'FM999 999 999') AS revenue
FROM "Deal" d
JOIN "Manager" m ON m.id = d."managerId"
WHERE d."tenantId" = (SELECT id FROM "Tenant" WHERE name='reklamalift74')
GROUP BY m.name
ORDER BY SUM(d.amount) FILTER (WHERE d.status='WON') DESC NULLS LAST;
```

**Query B — Deal distribution by funnel (should show mostly Горячие/Холодные, NO Отказ):**

```sql
SELECT f.name AS funnel, COUNT(*) AS deals
FROM "Deal" d JOIN "Funnel" f ON f.id = d."funnelId"
WHERE d."tenantId" = (SELECT id FROM "Tenant" WHERE name='reklamalift74')
GROUP BY f.name ORDER BY deals DESC;
```

**Query C — Deals per stage (the new capability):**

```sql
SELECT f.name AS funnel, fs.name AS stage, COUNT(*) AS deals
FROM "Deal" d
JOIN "Funnel" f ON f.id = d."funnelId"
LEFT JOIN "FunnelStage" fs ON fs."funnelId" = f.id AND fs."crmId" = d."currentStageCrmId"
WHERE d."tenantId" = (SELECT id FROM "Tenant" WHERE name='reklamalift74')
GROUP BY f.name, fs.name
ORDER BY deals DESC;
```

Expected: most deals in a handful of active stages ("Новая заявка", "КП отправлено", "Счёт выставлен", "Успешно реализовано", "Закрыто и не реализовано"). If every row has `stage = NULL` — stage resolution is broken; diagnose the FunnelStage.crmId values vs Deal.currentStageCrmId.

**Query D — Task workload per manager:**

```sql
SELECT m.name AS manager,
       COUNT(*) FILTER (WHERE NOT t."isCompleted") AS open_tasks,
       COUNT(*) FILTER (WHERE NOT t."isCompleted" AND t."dueAt" < NOW()) AS overdue,
       COUNT(*) FILTER (WHERE t."isCompleted") AS done
FROM "Task" t JOIN "Manager" m ON m.id = t."managerId"
WHERE t."tenantId" = (SELECT id FROM "Tenant" WHERE name='reklamalift74')
GROUP BY m.name
ORDER BY open_tasks DESC;
```

Expected: visible distribution — at least some managers with open tasks. If everything is 0 — amoCRM tasks filter may be wrong; check `/tasks` response directly.

**Step 1: Run A-D against reklama, then against vastu**

For each tenant, execute all four queries:
```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 \
  'docker exec smart-analyze-db psql -U smartanalyze -d smartanalyze -c "<QUERY>"'
```

**Step 2: Screenshot or save outputs into a comment on the plan for record.**

No commit — verification only.

---

## Task 12: Push all commits to origin

**Step 1:**

```bash
cd /Users/kirillmalahov/smart-analyze
git log --oneline origin/main..HEAD
git push origin main
```

Expected: 6 new commits pushed.

---

## Post-mortem checklist

- [ ] Task 1 commit present — `stageMap` bug fixed, funnelId uses `pipeline_id`
- [ ] Task 2 commit present — schema has `Deal.currentStageCrmId` and `Task` model
- [ ] Task 2 migration applied on server (`\d "Deal"` shows column, `\dt "Task"` lists table)
- [ ] Task 5 commit present — `AmoCrmAdapter.getTasks` implemented
- [ ] Task 6 commit present — sync-engine writes `currentStageCrmId`, opens/closes DealStageHistory, syncs tasks
- [ ] Task 7: files scp'd, production container rebuilt
- [ ] Task 9: reklama re-synced, `dominant_funnel = Горячие`, stages populated, tasks > 0
- [ ] Task 10: vastu re-synced, same checks
- [ ] Task 11: all four verification queries return sensible data

## What we explicitly are NOT doing in this plan

- **Phase 2 (Whisper transcription, DeepSeek pattern extraction).** Separate plan.
- **Back-filling `DealStageHistory` from amoCRM `/leads/{id}/events`.** N+1 cost too high; pragmatic history from sync cadence is enough for initial analytics.
- **UI dashboard rewiring to real data.** Separate plan (it currently reads from seeded tenant).
- **Cron-based delta sync.** Separate plan.
- **Bitrix24 extensions** (contacts, companies, leads, imopenlines, telephony) — tracked as tasks #7/#8/#9.
- **Fixing Bitrix24 tasks import.** Task 3 stubs it to empty; real impl is a dedicated task later.

---

**Plan complete and saved to `docs/plans/2026-04-17-amocrm-full-card-sync.md`. Two execution options:**

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Parallel Session (separate)** — Open a new session in the repo, use `executing-plans` for batch execution with checkpoints.

**Which approach?**
