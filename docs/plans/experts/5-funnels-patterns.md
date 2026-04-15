# Expert 5: GetCourse Funnels/Processes to SalesGuru Analytics Mapping

## Aspect: Mapping GetCourse data model to SalesGuru Deal-centric analytics

### Project Context

**Current SalesGuru data model (Prisma schema):**
- `CrmProvider` enum: `BITRIX24 | AMOCRM` (no GETCOURSE yet)
- `CrmAdapter` interface: `testConnection()`, `getFunnels()`, `getDeals()`, `getMessages()`, `getManagers()`
- `Deal`: has `managerId`, `funnelId`, `status` (OPEN/WON/LOST), `messages[]`, `stageHistory[]`
- `Manager`: has `deals[]`, `callRecords[]`, conversion metrics
- `Funnel` -> `FunnelStage[]` -> `DealStageHistory[]`
- `Message`: sender (MANAGER/CLIENT/SYSTEM), content, timestamp, isAudio
- AI analysis expects: manager-client conversation, deal status, talk ratio, response time

**Current QUP project already has GetCourse webhook handler:**
- `/root/qup/router/webhooks/getcourse.py` parses order webhooks (order_id, status, cost, UTM, email/phone)
- Uses GetCourse process variables: `{object.id}`, `{object.status}`, `{object.cost_money_value}`, `{create_session.utm_*}`
- RID matching by UTM parameters (no click_id needed)

**GetCourse data model (from API research):**
- Orders (zakazyy) with statuses: `new`, `payed`, `cancelled`, `in_work`, `payment_waiting`, `part_payed`, `waiting_for_return`, `not_confirmed`, `pending`
- Order Board (doska zakazov) with custom stages (independent of statuses)
- Processes (protsessy) = automated funnels (webinar sequences, auto-funnels, email chains)
- Users = learners/buyers (not traditional contacts/leads)
- Manager assignment: `manager_email` field on orders, tasks assigned to order managers
- Partners: `partner_email`, `partner_id` (affiliate attribution)
- Export API: `/pl/api/account/deals` with async 2-step export (request -> poll -> download)
- Rate limit: 100 export requests per 2 hours
- Export fields include: deal_number, deal_id, deal_cost, offer_code, product_title, deal_status, deal_is_paid, deal_created_at, deal_finished_at, manager (pos 21), partner_id (pos 24)
- NO native messaging/conversation API (no chat between manager and client like in amoCRM)

### Expert Analysis

> "Analyzing as Sam Newman (Architecture) because we're designing a bounded context mapping between two fundamentally different domain models -- B2B CRM sales vs. course/info-product sales."
>
> **Principles from 3 experts:**
> 1. Theo Browne (API design): "type-safe contracts, fail fast, explicit errors" -- adapter must clearly communicate what GetCourse can and cannot provide
> 2. Martin Fowler (Refactoring): "small steps, preserve behavior" -- extend existing CrmAdapter, don't break amoCRM/Bitrix
> 3. Matt Pocock (TypeScript types): "infer over explicit, type narrowing" -- discriminated unions for provider-specific behavior

---

## Question 1: How to map GetCourse orders to our Deal model?

### Mapping Table

| SalesGuru Deal field | GetCourse Source | Notes |
|---|---|---|
| `crmId` | `deal_id` or `deal_number` | Use `deal_id` (unique), `deal_number` for display |
| `title` | `product_title` + `offer_code` | e.g. "Курс по маркетингу [offer-123]" |
| `amount` | `deal_cost` | Numeric, in account currency |
| `status` | `deal_status` mapping (see below) | |
| `managerId` | `manager_email` -> resolve to Manager | Manager lookup by email |
| `funnelId` | Synthetic, see below | |
| `createdAt` | `deal_created_at` | |
| `closedAt` | `deal_finished_at` | Only for terminal statuses |
| `duration` | Calculated | closedAt - createdAt in hours |

### Status Mapping

| GetCourse status | SalesGuru DealStatus | Rationale |
|---|---|---|
| `new` | OPEN | Fresh order, not processed |
| `in_work` | OPEN | Being processed by manager |
| `payment_waiting` | OPEN | Awaiting payment |
| `pending` | OPEN | Pending confirmation |
| `not_confirmed` | OPEN | Needs verification |
| `part_payed` | OPEN | Partially paid, still active |
| `payed` | WON | Full payment received = success |
| `cancelled` | LOST | Client cancelled |
| `waiting_for_return` | LOST | Refund requested = effectively lost |

**Key insight:** In GetCourse, `payed` is the ONLY definitive win signal. Unlike B2B CRM where "deal won" is an explicit stage, GetCourse win = payment received.

---

## Question 2: What are "stages" in GetCourse context?

GetCourse has TWO separate concepts that map to stages:

### A. Order Statuses (system-defined, immutable)
`new -> in_work -> payment_waiting -> payed/cancelled`

These are the real pipeline. They're system-defined and cannot be customized by the user.

### B. Order Board Stages (custom, per-account)
Users create custom columns on the "Order Board" (doska zakazov) like:
- "Novye" (New)
- "Pozvonil" (Called)
- "Otpravil KP" (Sent proposal)
- "Ozhidaet oplatu" (Waiting for payment)
- "Oplachen" (Paid)

These are analogous to amoCRM pipeline stages and are the more meaningful stages for sales analysis.

### Mapping Strategy

**Option A: Use order statuses as stages (simple)**
Create a single synthetic funnel with stages matching GetCourse statuses.

```
Funnel: "GetCourse Orders"
Stages: New(0) -> In Work(1) -> Payment Waiting(2) -> [Payed(3) | Cancelled(3)]
```

**Option B: Use Order Board stages (accurate but requires API)**
The GetCourse Export API does NOT expose board stages. This data is only available inside GetCourse admin UI.

**Option C: Use Offers as funnels (product-oriented)**
Each product/offer becomes a "funnel" since GetCourse experts typically sell multiple courses.

```
Funnel: "Курс по маркетингу" (offer_code: mkt-101)
Funnel: "Вебинар введение" (offer_code: webinar-intro)
```

### Recommendation: Hybrid (A + C)

- Create funnels PER OFFER (product_title / offer_code)
- Use order statuses as universal stages within each funnel
- This gives meaningful segmentation: "Which product converts best?" + "Where do orders drop off?"

---

## Question 3: How to extract "manager" concept from GetCourse?

### GetCourse has three "seller" roles:

| Role | Field | What they do |
|---|---|---|
| **Manager** | `manager_email` | Manually assigned to process orders. Makes calls, sends messages. This is the closest to amoCRM manager. |
| **Partner** | `partner_email`, `partner_id` | Affiliate who drove the traffic. Gets commission. NOT a seller. |
| **Account Admin** | (no specific field) | School owner/team who runs webinars, creates content. |

### Mapping to SalesGuru Manager model:

**Primary: Order Manager (`manager_email`)**
- This is the direct equivalent of amoCRM manager
- GetCourse allows assigning managers to orders manually or via processes
- Schools with sales teams use this extensively
- Export field position 21 = "Manager"

**Secondary: Consider partner as attribution, not manager**
- Partners should NOT be mapped to Manager model
- Instead, store `partner_id` as metadata on the Deal for ROI analysis
- This could be a future feature: "which affiliates bring best-converting leads?"

**Edge case: No manager (fully automated sales)**
- Many GetCourse schools have zero managers -- 100% automated funnels
- Webinar -> landing -> payment, no human interaction
- In this case, SalesGuru shifts from "manager performance analysis" to "funnel performance analysis"
- We need a synthetic "Auto-funnel" manager or make managerId truly optional

### Implementation:

```typescript
// In GetCourse adapter:
async getManagers(): Promise<CrmManager[]> {
  // Export orders, extract unique manager_email values
  // GetCourse has no "list managers" API endpoint
  const orders = await this.exportOrders()
  const managerEmails = new Set(orders.map(o => o.manager_email).filter(Boolean))
  return Array.from(managerEmails).map(email => ({
    crmId: email, // email as unique ID
    name: email.split('@')[0], // fallback name from email
    email: email,
  }))
}
```

---

## Question 4: What patterns are meaningful in GetCourse sales?

### GetCourse-specific patterns to analyze:

**A. Conversion funnel metrics (per offer/product):**
- `new -> payed` conversion rate (the primary KPI)
- `new -> cancelled` rate (immediate rejection)
- `in_work -> payed` rate (manager effectiveness, if managers exist)
- `payment_waiting -> payed` rate (payment page effectiveness)
- Average time from `new` to `payed` (sales cycle length)

**B. Manager patterns (when managers exist):**
- Orders per manager (workload distribution)
- Conversion rate per manager (who closes best)
- Average processing time per manager
- Cancel rate per manager (who loses most)

**C. Product/offer patterns:**
- Which offers convert best?
- Which offers have highest average order value?
- Revenue per offer over time (trending up/down)
- Offer A vs Offer B comparison

**D. Traffic source patterns (from UTM):**
- Conversion rate by utm_source (which channels work)
- Average order value by traffic source
- Partner attribution effectiveness
- Which webinar/landing generates most paid orders

**E. Temporal patterns:**
- Day-of-week conversion rates (best days for sales)
- Seasonal trends
- Time-to-payment distribution (impulse vs deliberate buyers)

### Key difference from B2B:
In B2B (amoCRM), patterns are about **negotiation quality** (how the manager talks).
In GetCourse, patterns are about **funnel efficiency** (which automated sequence converts better) + **manager speed** (how fast they process warm leads).

---

## Question 5: How does AI analysis need to adapt for course/expert sales?

### Current AI prompts are B2B-focused:
- `DEAL_ANALYSIS_PROMPT`: Expects manager-client conversation, analyzes negotiation tactics
- `PATTERN_EXTRACTION_PROMPT`: Looks for communication patterns across deals
- `CALL_SCORING_PROMPT`: Scores calls against scripts

### Adaptations needed:

**Scenario 1: GetCourse school WITH managers (sales team)**

The analysis model is closest to current B2B. Managers handle orders, make calls, chat with leads.
- AI analysis works as-is IF we can get conversations
- GetCourse doesn't expose manager-client messages via API
- BUT: managers often use external channels (WhatsApp, Telegram) or GetCourse's built-in comments
- Solution: Support manual transcript upload or phone system integration

**Scenario 2: GetCourse school WITHOUT managers (fully automated)**

This is the majority case. No human conversations to analyze.
- `DEAL_ANALYSIS_PROMPT` is irrelevant (no conversation)
- Need NEW prompt: `FUNNEL_ANALYSIS_PROMPT`
- Analyze order flow data, not conversations
- Focus on: conversion rates, timing, offer effectiveness, UTM source quality

### New prompt needed: FUNNEL_ANALYSIS_PROMPT

```
Ты -- аналитик онлайн-школ. Проанализируй данные о заказах и найди инсайты.

Входные данные:
- Список заказов с: статус, сумма, дата создания, дата оплаты, продукт, источник трафика, менеджер (если есть)
- Общая статистика: конверсия, средний чек, распределение по статусам

Найди:
1. Какие продукты конвертируют лучше/хуже всех?
2. Какие источники трафика приносят самые качественные заказы (высокая конверсия в оплату)?
3. Есть ли временные паттерны (дни недели, время суток)?
4. Если есть менеджеры -- кто обрабатывает быстрее/эффективнее?
5. Где главные точки потери (какой статус -- "кладбище" заказов)?
```

### Adaptation matrix:

| Feature | B2B (amoCRM) | Course (GetCourse with managers) | Course (GetCourse automated) |
|---|---|---|---|
| Deal analysis | Conversation analysis | Limited (no native messages) | Order flow analysis |
| Patterns | Communication patterns | Processing speed patterns | Funnel conversion patterns |
| Call scoring | Script compliance | Script compliance (if calls exist) | N/A |
| Manager rating | By conversation quality | By processing speed & conversion | N/A (no managers) |
| Key metric | Talk ratio, response time | Time-to-process, conversion rate | Funnel conversion, traffic ROI |
| AI prompt | DEAL_ANALYSIS | DEAL_ANALYSIS (adapted) | FUNNEL_ANALYSIS (new) |

---

## Question 6: Can we extract meaningful sales conversations from GetCourse?

### Short answer: Very limited, compared to amoCRM.

### What GetCourse has:

| Data source | API accessible? | Quality for analysis |
|---|---|---|
| Order comments | NOT via export API | Low (internal notes, not conversations) |
| Process task comments | NOT via API | Low (task-level notes) |
| Email campaigns | NOT as conversations | Medium (one-way, not dialogue) |
| Webinar chat | NOT via API | Medium (many-to-many, noisy) |
| Support tickets | NOT via API | High (but rare for sales) |
| Phone calls (SIP) | Via telephony integration | High (if school uses GC telephony) |

### Realistic conversation sources for GetCourse users:

1. **External phone systems** (Mango Office, UIS, Zadarma)
   - Many GC schools use separate IP telephony
   - SalesGuru can integrate directly with these (same as for amoCRM)
   - Call recordings + transcription = full analysis
   - This is the HIGHEST VALUE path

2. **Manual transcript upload**
   - Manager uploads call recording or chat export
   - SalesGuru transcribes and analyzes
   - Low friction for small teams

3. **GetCourse webhook enrichment**
   - Capture order status changes via webhook
   - Track time between status transitions
   - No conversation content, but process metrics

### Strategy for GetCourse:

**Phase 1 (MVP):** Order-level analytics only
- Import orders via Export API
- Map to Deal model
- Funnel conversion analysis (no AI conversation analysis)
- Manager speed/conversion metrics

**Phase 2:** Phone integration
- Integrate with popular telephony (Mango, UIS)
- Match calls to orders by phone number
- Full conversation analysis like amoCRM

**Phase 3:** Omnichannel
- WhatsApp Business API integration
- Telegram bot messages capture
- Unified conversation view per order

---

## Solution Options

### Option A: Minimal Adapter (Order Analytics Only)

**Essence:** Create `GetCourseAdapter` implementing `CrmAdapter` interface. Use Export API to fetch orders. Map to Deal model. No message/conversation support. Focus on funnel metrics.

**What we build:**
- `GetCourseAdapter` class in `src/lib/crm/getcourse.ts`
- Add `GETCOURSE` to `CrmProvider` enum
- Synthetic funnels per offer/product
- Order statuses as funnel stages
- Managers extracted from order export
- New `FUNNEL_ANALYSIS_PROMPT` for AI analysis of order patterns
- Dashboard widgets: conversion funnel, offer comparison, source ROI

**Pros:**
- Fast to implement (2-3 days)
- Uses existing Export API (documented, stable)
- Immediately valuable: conversion analytics, manager speed, offer comparison
- No need to solve the "no conversations" problem

**Cons:**
- No AI conversation analysis (the core SalesGuru differentiator)
- Limited pattern detection (order-level, not interaction-level)
- Export API rate limit (100/2h) means slow initial sync for large accounts
- Some users will feel the product is "incomplete"

**When suitable:** MVP launch, proving market fit with GetCourse users. Quick win.

---

### Option B: Adapter + Telephony Bridge

**Essence:** Option A plus integration with popular telephony providers used by GetCourse schools (Mango Office, UIS, Zadarma). Match calls to orders by phone number.

**What we build:**
- Everything from Option A
- `TelephonyAdapter` interface: `getCalls(since: Date): Promise<CallRecord[]>`
- Implementations for Mango Office API, UIS API
- Phone-to-order matching logic (order.user_phone == call.phone)
- Full AI analysis pipeline for calls

**Pros:**
- Unlocks AI conversation analysis for GetCourse users
- Differentiator: "analytics for your online school's sales team"
- High value for schools with active sales departments
- Reusable for any CRM (not just GetCourse)

**Cons:**
- More complex (5-7 days)
- Requires user to have external telephony
- Phone matching is imperfect (multiple numbers, formatting)
- Additional third-party API dependencies

**When suitable:** When targeting GetCourse schools with sales teams (schools selling high-ticket courses).

---

### Option C: Webhook-Only (Real-time, No Export API)

**Essence:** Skip Export API entirely. Use GetCourse process webhooks (already supported in QUP) to stream order events in real-time. Build analytics from event stream.

**What we build:**
- Webhook receiver endpoint in SalesGuru
- Event-sourced Deal construction from webhook events
- Real-time dashboard updates
- No batch sync needed

**Pros:**
- Real-time data (vs Export API polling)
- No rate limits
- Already have webhook parsing code in QUP
- Event sourcing gives stage transition timeline for free

**Cons:**
- No historical data (only new events after setup)
- Requires user to configure GetCourse process (friction)
- Less reliable (missed webhooks = missing data)
- Cannot extract manager info from webhook (limited fields)
- GetCourse webhook sends limited data compared to Export API

**When suitable:** Real-time dashboards, second phase addition alongside Export API.

---

### Option D: Hybrid (Export API + Webhooks + Telephony-Ready)

**Essence:** Initial sync via Export API (historical data), then real-time updates via webhooks. Prepare telephony adapter interface for Phase 2. New AI prompts for funnel analysis.

**What we build:**
- `GetCourseAdapter` using Export API for initial/periodic sync
- Webhook endpoint for real-time order status updates
- `CrmAdapter` interface extended with optional `getCallRecords()` method
- Funnel-oriented AI prompts alongside existing conversation prompts
- Provider-aware dashboard: show conversation analysis for amoCRM, funnel analysis for GetCourse

**Pros:**
- Complete historical data + real-time updates
- Clean architecture for future telephony
- Best analytics quality (two data sources complement each other)
- Dashboard adapts to data availability

**Cons:**
- Most complex (7-10 days)
- Two sync mechanisms to maintain
- Webhook + Export API data reconciliation needed
- Over-engineering risk for MVP

**When suitable:** Long-term architecture, after product-market fit confirmed.

---

### Decision from Sam Newman

**Choice: Option A (Minimal Adapter) with preparation for Option D**

**Reasoning:**

The bounded context mapping between amoCRM (conversation-rich, manager-centric) and GetCourse (order-flow, funnel-centric) reveals these are fundamentally different sales paradigms. Trying to force GetCourse into the existing conversation-analysis model would produce a mediocre experience.

Instead, Option A creates a genuinely useful product for GetCourse users by focusing on what GetCourse data is GOOD at: funnel conversion analytics, offer comparison, traffic source ROI, and manager processing speed. This is valuable on its own -- many GetCourse schools have no analytics beyond the built-in dashboard.

The key architectural decision: **make the CrmAdapter interface aware that not all providers supply conversations.** Add an optional `capabilities` field:

```typescript
interface CrmAdapter {
  capabilities: {
    hasMessages: boolean      // amoCRM: true, GetCourse: false
    hasFunnelStages: boolean  // amoCRM: true, GetCourse: synthetic
    hasCallRecords: boolean   // Both: depends on telephony
    hasRealTimeWebhook: boolean // GetCourse: true, amoCRM: true
  }
  // ... existing methods
}
```

This lets the dashboard and AI analysis adapt gracefully: show conversation analysis when available, show funnel analytics when not.

**Implementation plan (3 days):**
1. Day 1: `GetCourseAdapter` (Export API, async export with polling), add GETCOURSE to enum, Prisma migration
2. Day 2: Mapping logic (orders->deals, statuses->stages, offers->funnels, manager extraction by email), sync-engine integration
3. Day 3: `FUNNEL_ANALYSIS_PROMPT`, provider-aware dashboard (hide conversation widgets for GetCourse, show funnel widgets)

**Risks:**
1. Export API rate limit (100/2h) -- mitigate with incremental sync using `created_at[from]` filter
2. Async export (request then poll) -- need retry logic, timeout handling
3. Manager extraction from orders is lossy (only email, no name) -- may need manual manager naming in UI
4. GetCourse accounts with 50K+ orders will hit rate limits during initial sync -- need pagination strategy
5. Schools without managers (majority) will see empty "Managers" tab -- need graceful UI handling

---

## Appendix: GetCourse CrmConfig fields needed

```prisma
// New enum value
enum CrmProvider {
  BITRIX24
  AMOCRM
  GETCOURSE  // NEW
}

// CrmConfig for GetCourse needs:
// subdomain: "myschool" (from myschool.getcourse.ru)
// apiKey: secret API key (from account settings)
// webhookUrl: not needed for export, but used for incoming webhooks
```

## Appendix: GetCourse Export API flow

```
1. POST https://{subdomain}.getcourse.ru/pl/api/account/deals
   Body: { action: "deals", key: "{api_key}", params: { created_at: { from: "2026-01-01" } } }
   Response: { success: true, info: { export_id: 12345 } }

2. POST https://{subdomain}.getcourse.ru/pl/api/account/exports
   Body: { action: "exports", key: "{api_key}", params: { export_id: 12345 } }
   Response: { success: true, info: { status: "exported", items: [...] } }
   (Poll until status == "exported", typically 5-60 seconds)
```

## Appendix: Key file paths in SalesGuru

- Schema: `/Users/kirillmalahov/smart-analyze/prisma/schema.prisma`
- CRM types: `/Users/kirillmalahov/smart-analyze/src/lib/crm/types.ts`
- CRM adapter factory: `/Users/kirillmalahov/smart-analyze/src/lib/crm/adapter.ts`
- amoCRM adapter: `/Users/kirillmalahov/smart-analyze/src/lib/crm/amocrm.ts`
- Sync engine: `/Users/kirillmalahov/smart-analyze/src/lib/sync/sync-engine.ts`
- AI prompts: `/Users/kirillmalahov/smart-analyze/src/lib/ai/prompts.ts`
- QUP GetCourse webhook (reference): `/root/qup/router/webhooks/getcourse.py` (on server)
- QUP GetCourse docs: `/root/qup/GETCOURSE_INTEGRATION.md`, `/root/qup/GETCOURSE_COST_VARIABLE.md` (on server)
