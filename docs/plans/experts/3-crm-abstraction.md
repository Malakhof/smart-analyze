# Expert Analysis: CRM Integration Abstraction Layer

## Aspect: Supporting amoCRM + GetCourse + future CRMs/LMS systems

---

## Project Context

### Existing Architecture (studied via SSH)

**CrmAdapter interface** (`src/lib/crm/types.ts`):
```ts
interface CrmAdapter {
  testConnection(): Promise<boolean>
  getFunnels(): Promise<CrmFunnel[]>
  getDeals(funnelId?: string, since?: Date): Promise<CrmDeal[]>
  getMessages(dealCrmId: string): Promise<CrmMessage[]>
  getManagers(): Promise<CrmManager[]>
}
```

**Factory** (`src/lib/crm/adapter.ts`): simple switch on `config.provider` returning concrete adapter.

**Implementations**: `AmoCrmAdapter` (full, ~350 lines), `Bitrix24Adapter` (full, ~300 lines). Both implement the same interface cleanly.

**Sync engine** (`src/lib/sync/sync-engine.ts`): ~200 lines, calls adapter methods in sequence: managers -> funnels -> deals -> messages. Creates `CallRecord` entries from audio messages. **Tightly coupled to CRM-shaped data** (funnels, stages, deals).

**Prisma schema**: `CrmProvider` enum with `BITRIX24 | AMOCRM`. `CrmConfig` model stores provider-specific fields (webhookUrl, apiKey, subdomain). Separate models for Funnel, FunnelStage, Deal, Manager, Message, CallRecord.

**API routes**: `src/app/api/settings/crm/route.ts` uses discriminated union validation per provider. `src/app/api/settings/crm/test/route.ts` handles connection testing.

### The GetCourse Challenge

GetCourse data model differs fundamentally:
- **No funnels** -- has "processes" (autovoronki) which are marketing automation, not sales pipelines
- **No deals** -- has "orders" (zakazy) and "payments" (platezhi), which map loosely to deals
- **No call recordings** -- calls live in external telephony (Mango, Sipuni, etc.)
- **No stages** -- orders have statuses (new, paid, cancelled, refunded) but not pipeline stages
- **Managers** = admins/partners, different semantics
- **API is webhook/export-based**, not REST-like -- GetCourse pushes data via webhooks or exports CSV

---

## Expert Analysis

> "Analyzing as **Sam Newman** (Architecture) because this is fundamentally a bounded context and interface design problem -- how to create an abstraction that serves two very different domains without leaking implementation details."
>
> **Principles from 3 experts:**
> 1. **Martin Fowler** (Refactoring): "Don't abstract prematurely; extract commonality only when you have 3+ examples. With 2 CRMs + 1 LMS, we're at the threshold."
> 2. **Matt Pocock** (TypeScript): "Use discriminated unions and type narrowing over wide interfaces with optional everything. Let the type system guide correct usage."
> 3. **Theo Browne** (API Design): "Fail fast, explicit errors. If GetCourse can't provide funnels, don't return empty arrays silently -- make the type system prevent calling getFunnels() on GetCourse."

---

## Solution Options

### Option A: Adapter Mapping (GetCourse implements CrmAdapter as-is)

**Essence:** GetCourse adapter implements the same `CrmAdapter` interface. Map GC concepts to CRM concepts:
- GC orders -> CrmDeal (status: new=open, paid=won, cancelled=lost)
- GC processes -> CrmFunnel (if available, else return single "default" funnel)
- GC admins -> CrmManager
- getMessages() -> return empty array (no messages in GC)

**Pros:**
- Zero changes to sync engine, UI, or any existing code
- Fastest to implement (just write the adapter)
- sync-engine.ts works unchanged
- Other adapters unaffected

**Cons:**
- **Semantic mismatch** -- GC "order" is NOT a "deal"; forced mapping loses meaning
- `getMessages()` returning `[]` is a silent lie -- caller can't distinguish "no messages yet" from "this system doesn't support messages"
- Funnel/stage model doesn't fit -- GC processes are automation sequences, not sales pipelines
- Future analysis features that depend on funnel stages will produce garbage for GC tenants
- Calls gap is unaddressed -- GC users have calls in Mango/Sipuni but no way to bring them in

**When suitable:** Quick MVP / proof of concept where you need GC data flowing ASAP and plan to refactor later.

---

### Option B: Extended Interface with Capabilities (Recommended)

**Essence:** Add a `capabilities` property to the adapter interface that declares what each source supports. Sync engine checks capabilities before calling methods. Methods that aren't supported are never called.

```ts
interface DataSourceCapabilities {
  hasFunnels: boolean
  hasDeals: boolean
  hasMessages: boolean
  hasCalls: boolean
  hasManagers: boolean
}

interface DataSourceAdapter {
  readonly capabilities: DataSourceCapabilities
  testConnection(): Promise<boolean>
  getFunnels(): Promise<CrmFunnel[]>         // only if hasFunnels
  getDeals(funnelId?: string, since?: Date): Promise<CrmDeal[]>
  getMessages(dealCrmId: string): Promise<CrmMessage[]>  // only if hasMessages
  getManagers(): Promise<CrmManager[]>
}
```

Rename `CrmProvider` -> `IntegrationType` in Prisma: `AMOCRM | BITRIX24 | GETCOURSE | MANGO | SIPUNI`.

Sync engine becomes capability-aware:
```ts
if (adapter.capabilities.hasFunnels) {
  // sync funnels
}
if (adapter.capabilities.hasDeals) {
  // sync deals
}
```

For calls gap: add `MANGO` and `SIPUNI` as separate integration types with their own adapters that only implement `hasCalls: true`. A tenant can have multiple active integrations (GC for deals + Mango for calls).

**Pros:**
- Clean, explicit -- no silent empty arrays or fake mappings
- Sync engine changes are minimal (~10 lines of capability checks)
- **Multiple integrations per tenant** solves the calls gap naturally
- Type-safe: capabilities are compile-time constants per adapter
- Extensible: adding Tildapay, RetailCRM, etc. just means a new adapter + capability declaration
- Existing amoCRM/Bitrix adapters get `{ hasFunnels: true, hasDeals: true, hasMessages: true, hasCalls: false, hasManagers: true }` -- minimal change

**Cons:**
- Requires sync engine modification (capability checks)
- Prisma migration needed (rename enum, add values)
- UI needs to handle "this integration doesn't support funnels" state
- Multi-integration per tenant adds complexity to CrmConfig (currently one config per provider)

**When suitable:** When you have 3+ integration types with different capabilities, which is exactly the current situation (amoCRM, Bitrix, GetCourse, and telephony on the horizon).

---

### Option C: Dual-Layer Abstraction (SalesAdapter + TelephonyAdapter)

**Essence:** Split the monolithic CrmAdapter into two separate interfaces:

```ts
interface SalesAdapter {
  testConnection(): Promise<boolean>
  getManagers(): Promise<CrmManager[]>
  getDeals(since?: Date): Promise<CrmDeal[]>
  getFunnels?(): Promise<CrmFunnel[]>  // optional
}

interface TelephonyAdapter {
  testConnection(): Promise<boolean>
  getCalls(since?: Date): Promise<CallRecord[]>
}
```

amoCRM implements both (it has deals AND calls). GetCourse implements only SalesAdapter. Mango/Sipuni implement only TelephonyAdapter.

Two separate sync engines: `syncSalesData()` and `syncCallData()`.

**Pros:**
- Clean separation of concerns -- sales data and telephony are genuinely different domains
- Each interface is small and focused (Interface Segregation Principle)
- No capability flags needed -- type system enforces what's available
- amoCRM implements both interfaces (composition)

**Cons:**
- **Significant refactoring** -- sync engine needs to be split in two
- amoCRM's messages include both chat messages and calls -- splitting them across two interfaces is awkward
- Current `Message` model conflates text messages and call records -- architectural debt surfaces
- More files, more interfaces, more cognitive overhead
- The split point is debatable -- where do chat messages go? They're neither purely "sales" nor "telephony"

**When suitable:** When you're building a platform with many telephony integrations (5+ telephony providers) and the telephony domain deserves its own bounded context.

---

### Option D: Plugin Architecture with Event Bus

**Essence:** Each integration is a plugin that emits normalized events (DealCreated, CallRecorded, MessageReceived, etc.). A central event processor handles storage. Plugins register themselves with their event types.

**Pros:**
- Maximum flexibility and decoupling
- Adding new integrations requires no changes to core
- Webhook-based sources (GetCourse) fit naturally as event emitters

**Cons:**
- **Massive over-engineering** for 3-4 integrations
- Event sourcing complexity (ordering, dedup, replay)
- Debugging becomes harder (indirect data flow)
- 5-10x more development time than Option B

**When suitable:** When you're building an iPaaS or integration platform with 20+ connectors. Not this project.

---

## Decision from Sam Newman

**Choice: Option B -- Extended Interface with Capabilities**

### Reasoning

1. **Bounded context alignment.** GetCourse, amoCRM, and Mango/Sipuni are genuinely different bounded contexts. Option B acknowledges this by letting each adapter declare its capabilities honestly, rather than forcing a CRM-shaped peg into an LMS-shaped hole (Option A) or over-splitting into microservices (Option C).

2. **Minimal disruption.** The existing sync engine is well-written and only needs ~10 lines of `if (adapter.capabilities.X)` guards. AmoCRM and Bitrix24 adapters need only a `capabilities` property added -- zero logic changes. This follows Fowler's "small steps, preserve behavior."

3. **Multi-integration solves the calls gap.** The real insight is that a GetCourse tenant will ALSO need a telephony integration. The `capabilities` pattern + allowing multiple active integrations per tenant handles this naturally. CrmConfig already has `tenantId + provider` -- we just allow multiple rows per tenant.

4. **Type safety.** Pocock's principle applies: the capabilities object is a compile-time constant per adapter class. TypeScript can narrow based on it. Future code can do `if (adapter.capabilities.hasFunnels)` and know it's safe.

5. **Not over-engineered.** Option D (event bus) is tempting but premature. Option C (dual interfaces) is clean in theory but creates awkward splitting of amoCRM's messages (which contain both chat and calls). Option B keeps one interface with explicit capability declarations -- the right level of abstraction for 3-5 integrations.

### Implementation Plan

**Phase 1: Schema + Interface (no behavior change)**
1. Add `GETCOURSE` to `CrmProvider` enum in Prisma
2. Add `capabilities` readonly property to `CrmAdapter` interface
3. Add capabilities to existing AmoCRM and Bitrix24 adapters (all true except `hasCalls`)
4. No sync engine changes yet -- existing behavior preserved

**Phase 2: Capability-aware sync engine**
1. Add capability checks to `syncFromCrm()` -- skip steps when capability is false
2. Create `GetCourseAdapter` implementing the interface with appropriate capabilities
3. Update factory function, API routes, and Zod schemas
4. Update UI settings to show GetCourse option with appropriate fields

**Phase 3: Telephony integrations (later)**
1. Add `MANGO | SIPUNI` to provider enum
2. Create telephony adapters (capabilities: only `hasCalls: true`)
3. Allow multiple active integrations per tenant in UI
4. Sync engine already handles this via capability checks

### Key Files to Modify
- `/root/smart-analyze/prisma/schema.prisma` -- add enum values
- `/root/smart-analyze/src/lib/crm/types.ts` -- add capabilities interface
- `/root/smart-analyze/src/lib/crm/amocrm.ts` -- add capabilities property
- `/root/smart-analyze/src/lib/crm/bitrix24.ts` -- add capabilities property
- `/root/smart-analyze/src/lib/crm/adapter.ts` -- add GETCOURSE case to factory
- `/root/smart-analyze/src/lib/crm/getcourse.ts` -- new file
- `/root/smart-analyze/src/lib/sync/sync-engine.ts` -- add capability guards
- `/root/smart-analyze/src/app/api/settings/crm/route.ts` -- add GC schema
- `/root/smart-analyze/src/app/api/settings/crm/test/route.ts` -- add GC test

### Risks

1. **GetCourse API limitations.** GC's API is webhook/export-oriented, not REST. The adapter may need to work with webhook payloads pushed TO us, not pulled BY us. This means `getDeals()` might need to read from a local cache populated by webhooks, not call GC API directly. Investigate GC API docs before implementing.

2. **Order-to-Deal mapping fidelity.** GC orders have different lifecycle semantics than CRM deals. "Partial payment" and "refund" don't map cleanly to open/won/lost. May need to extend `DealStatus` enum.

3. **Multi-integration UI complexity.** Current settings UI assumes one CRM. Allowing GC + Mango means the settings page needs a list of integrations with add/remove. Moderate UI work.

4. **Telephony call-to-deal linking.** When calls come from Mango and deals come from GC, linking them requires phone number matching. This is non-trivial (phone format normalization, multiple phones per client, etc.).
