# Expert Analysis: GetCourse API & Call Recordings

## Aspect: GetCourse API integration for SalesGuru (CRM adapter)

### Project Context

**Current state:**
- Smart Analyze (SalesGuru) has a `CrmAdapter` interface at `/root/smart-analyze/src/lib/crm/types.ts`
- Working adapters: `AmoCrmAdapter` (amocrm.ts), `Bitrix24Adapter` (bitrix24.ts)
- Factory: `adapter.ts` with `createCrmAdapter()` switch on provider
- QUP project already has GetCourse webhook integration (inbound webhooks for order events)
- QUP's `GETCOURSE_INTEGRATION.md` documents callback URL variables: `{object.id}`, `{object.number}`, `{object.status}`, `{object.cost}`, `{object.email}`, `{object.phone}`, `{create_session.utm_*}`

**Key interface to implement:**
```typescript
export interface CrmAdapter {
  testConnection(): Promise<boolean>
  getFunnels(): Promise<CrmFunnel[]>
  getDeals(funnelId?: string, since?: Date): Promise<CrmDeal[]>
  getMessages(dealCrmId: string): Promise<CrmMessage[]>
  getManagers(): Promise<CrmManager[]>
}
```

**Critical question: where do CALLS come from?**

---

### Expert Analysis

> "Analyzing as Theo Browne (API design) because the core challenge is designing a type-safe adapter against GetCourse's limited and unconventional API that lacks native call data."
>
> **Principles from 3 experts:**
> 1. Sam Newman (Architecture): "bounded context -- GetCourse is NOT a CRM, it's a course platform with CRM-like features; adapter must bridge two different domain models"
> 2. Martin Kleppmann (Distributed Systems): "eventual consistency -- GetCourse export API is async (start job -> poll -> get data), must handle delays and partial data"
> 3. Troy Hunt (Security): "validate all inputs -- secret keys in query params, base64-encoded payloads require careful handling"

---

### GetCourse API Deep Dive

#### 1. API Architecture

GetCourse API is HTTPS-only, POST-based, with an unusual format:
- **Auth**: Secret key as `key` POST parameter (no OAuth, no Bearer tokens)
- **Actions**: Passed as `action` POST parameter
- **Params**: Base64-encoded JSON in `params` POST parameter
- **Rate limits**: Max 100 export requests per account per 2 hours; exports are sequential (one at a time)

#### 2. Available Endpoints

| Endpoint | Type | What it does |
|---|---|---|
| `/pl/api/users` | Import | Add/update users |
| `/pl/api/deals` | Import | Add/update orders (called "deals" in API but are really orders) |
| `/pl/api/account/users` | Export | Export users with filters |
| `/pl/api/account/deals` | Export | Export orders with filters |
| `/pl/api/account/payments` | Export | Export payments with filters |
| `/pl/api/account/groups` | Export | Export user groups |
| `/pl/api/account/exports/{id}` | Status | Check export job status, get data |
| `/pl/api/fields` | Read | Get custom field definitions |

#### 3. Export API Flow (Two-Step Async)

```
Step 1: POST /pl/api/account/deals?key={secret}
        + filters as query params (created_at[from], status, etc.)
        -> Returns: { "success": true, "info": { "export_id": "12345" } }

Step 2: GET /pl/api/account/exports/12345?key={secret}
        -> If not ready: { "success": true, "info": { "status": "processing" } }
        -> If ready: { "success": true, "info": { "status": "exported", "items": [...] } }
```

#### 4. Order (Deal) Export Filters

- `created_at[from]` / `created_at[to]` (YYYY-MM-DD)
- `payed_at[from]` / `payed_at[to]`
- `finished_at[from]` / `finished_at[to]`
- `status_changed_at[from]` / `status_changed_at[to]`
- `status` = new | payed | cancelled | false | in_work | payment_waiting | part_payed | waiting_for_return | not_confirmed | pending

#### 5. Order Status Mapping to CrmDeal

| GetCourse Status | CrmDeal Status |
|---|---|
| `new`, `in_work`, `payment_waiting`, `pending`, `not_confirmed` | `open` |
| `payed`, `part_payed` | `won` |
| `cancelled`, `false`, `waiting_for_return` | `lost` |

#### 6. Entity Mapping: GetCourse -> CrmAdapter

| CrmAdapter concept | GetCourse equivalent | Notes |
|---|---|---|
| **CrmDeal** | Order (заказ) | Has id, number, status, cost, user info, manager |
| **CrmFunnel** | Product/Offer or Order Board columns | GetCourse has "order board" (доска заказов) with custom stages. No direct API for board config. Products/offers can serve as pseudo-funnels |
| **CrmManager** | Account employees | Not directly exposed via export API. `manager_email` field exists on orders but no employee list endpoint |
| **CrmMessage** | **DOES NOT EXIST** | GetCourse has no messaging/conversation API. No chat, no notes on orders via API |
| **CrmFunnel stages** | Order statuses (fixed) or custom board stages | Fixed set: new -> in_work -> payment_waiting -> payed -> cancelled etc. |

---

### THE CRITICAL ISSUE: Calls/Audio

#### GetCourse has NO native call storage or call API

GetCourse itself does NOT make or store calls. It integrates with exactly 2 IP-telephony providers:

1. **onlinePBX** -- SIP-based cloud PBX
2. **Novofon** (formerly Zadarma) -- VoIP provider with its own API

The integration works like this:
```
Manager clicks "Call" in GetCourse UI
  -> GetCourse sends command to onlinePBX/Novofon
  -> PBX initiates the call
  -> Call recording stored IN THE PBX, not in GetCourse
  -> GetCourse shows call log in the user card (via PBX webhook back to GC)
```

**Call recordings are NOT accessible through GetCourse API.** They live in the telephony provider.

#### Path to Call Recordings: Via Telephony Provider Directly

##### Option A: Novofon/Zadarma API (well-documented)

```
GET /v1/pbx/record/request/
  Params: call_id OR pbx_call_id, lifetime (180-5184000 sec)
  Response: { "links": ["https://api.zadarma.com/v1/pbx/record/download/{token}/{file}.mp3"] }

GET /v1/statistics/pbx/
  Params: start, end, version (2), skip, limit (max 1000), call_type
  Response: { "stats": [{ "call_id": "...", "pbx_call_id": "...", "caller_id": "...", "duration": 120, ... }] }
```

Rate limits: 100 req/min general, 3 req/min for statistics.
Recording links expire (default 30 min, max 60 days).
Recordings stored for up to 180 days.

##### Option B: onlinePBX API

Less documented. PHP API client on GitHub shows:
- `callHistory` method with date range params
- Auth via domain + API key
- Recording download available but docs are sparse

##### Option C: GetCourse Callback Webhooks (for real-time)

GetCourse can send webhooks via "Call URL" operations in processes. When an order changes status, it POSTs/GETs to your URL with variables:
- `{object.id}` - order ID
- `{object.number}` - order number
- `{object.status}` - order status
- `{object.cost}` - amount
- `{object.user.email}` - user email
- `{object.user.phone}` - user phone
- `{object.user.first_name}` - user name

**But NO call data is available in callbacks either.**

---

### Solution Options

#### A: GetCourse Orders + Novofon/Zadarma Direct Integration (Recommended)

**Essence:** Implement GetCourseAdapter for orders/users via GC Export API + separate telephony adapter (NovofonAdapter) that pulls call history and recordings directly from Novofon/Zadarma API. Match calls to orders by phone number + time window.

**Implementation:**
```typescript
class GetCourseAdapter implements CrmAdapter {
  private gcClient: GetCourseApiClient    // Export API
  private phoneAdapter: NovofonAdapter     // Novofon/Zadarma API (optional)
  
  async getDeals(funnelId?, since?): Promise<CrmDeal[]> {
    // 1. Start export job via /pl/api/account/deals
    // 2. Poll /pl/api/account/exports/{id} until ready
    // 3. Map GC orders -> CrmDeal[]
  }
  
  async getMessages(dealCrmId: string): Promise<CrmMessage[]> {
    // 1. Get deal's phone number from order data
    // 2. Query Novofon /v1/statistics/pbx/ for calls to/from that phone
    // 3. For each call, request recording URL via /v1/pbx/record/request/
    // 4. Return as CrmMessage[] with isAudio=true
  }
  
  async getFunnels(): Promise<CrmFunnel[]> {
    // Return fixed "funnel" based on GC order statuses
    // Or: export products list as pseudo-funnels
  }
  
  async getManagers(): Promise<CrmManager[]> {
    // Extract unique manager_email from orders
    // No direct employee list API exists
  }
}
```

**Pros:**
- Gets both order data AND call recordings
- Novofon/Zadarma API is well-documented with clear endpoints
- Phone-based matching is reliable for course/info-business context (1 phone = 1 client)
- Covers ~60-70% of GetCourse telephony users (Novofon is popular)

**Cons:**
- Requires TWO sets of credentials (GC key + Novofon API key)
- GC Export API is async with polling (adds latency)
- 100 export requests per 2 hours is a hard limit
- Phone matching may miss calls from different numbers
- onlinePBX users need a different telephony adapter

**When:** Best for clients who use GetCourse + Novofon/Zadarma (common combo in infobiz)

---

#### B: Webhook-First (Push Model)

**Essence:** Instead of polling GetCourse API, use GetCourse process callbacks to push order events to SalesGuru in real-time. Combine with Novofon webhooks for call events.

**Implementation:**
```typescript
// No "pull" adapter -- instead:
// 1. Client sets up GC process with "Call URL" operation pointing to our webhook
// 2. Our webhook endpoint receives order events in real-time
// 3. Novofon sends call webhooks (NOTIFY_START, NOTIFY_END, NOTIFY_RECORD)
// 4. We match and store both streams

// Adapter becomes a "reader" of locally stored webhook data:
class GetCourseWebhookAdapter implements CrmAdapter {
  async getDeals(): Promise<CrmDeal[]> {
    // Read from local DB where webhook events were stored
  }
  async getMessages(dealCrmId: string): Promise<CrmMessage[]> {
    // Read call events matched to this deal from local DB
  }
}
```

**Pros:**
- Real-time data (no polling delays)
- No rate limit issues (GC pushes to us)
- Simpler GC auth (just our webhook URL, no API key needed)
- Already proven in QUP project

**Cons:**
- Client must configure GC processes manually (complex onboarding)
- Misses historical data (only events after setup)
- No backfill capability
- Two webhook streams to correlate (GC orders + Novofon calls)
- If client's GC process breaks, we lose data silently

**When:** Best for new clients who don't need historical data, or when GC API key is unavailable

---

#### C: Hybrid (Export API + Webhooks for Real-Time)

**Essence:** Use Export API for initial backfill and periodic sync, plus webhooks for real-time updates. Novofon API for calls.

**Implementation:**
- Initial sync: Export API pulls all orders from last N days
- Ongoing: GC process webhook pushes new order events
- Calls: Novofon API polls every 15 min for new call records
- Dedup: Match by order ID (from export and webhook)

**Pros:**
- Best of both worlds: historical data + real-time
- Resilient (if webhook fails, export catches up)

**Cons:**
- Most complex to implement and maintain
- Requires both API key AND webhook setup from client
- Deduplication logic adds complexity
- Still limited by 100 exports/2h for backfill

**When:** Enterprise clients who need complete data

---

#### D: "GetCourse is Not a CRM" -- Minimal Adapter with Telephony Focus

**Essence:** Accept that GetCourse is fundamentally different from amoCRM/Bitrix24. Implement a minimal adapter that focuses on what matters for SalesGuru: call analysis. Skip order/funnel mapping. Connect directly to telephony.

**Implementation:**
```typescript
class GetCourseTelephonyAdapter implements CrmAdapter {
  // Thin wrapper: all "deals" come from telephony call log
  // Each call = one "deal" (or group by phone number)
  // Messages = call recordings from Novofon
  // Funnels = not applicable (return single default funnel)
  // Managers = SIP extensions from Novofon
  
  async getDeals(funnelId?, since?): Promise<CrmDeal[]> {
    // Each unique phone number in call history = one "deal"
    const stats = await novofon.getCallStatistics(since)
    return groupByPhone(stats).map(toCrmDeal)
  }
  
  async getMessages(dealCrmId: string): Promise<CrmMessage[]> {
    // dealCrmId = phone number
    const calls = await novofon.getCallsByPhone(dealCrmId)
    return calls.map(toCrmMessage)  // with audio URLs
  }
}
```

**Pros:**
- Simplest implementation
- Directly gets what SalesGuru actually needs (call recordings for AI analysis)
- No GC API dependency at all (just Novofon)
- Fast to ship

**Cons:**
- Loses order/financial context (amount, product, status)
- Can't correlate calls to specific orders
- Misleading "GetCourse integration" label when it's really a Novofon integration
- CrmDeal semantics are stretched

**When:** When the primary use case is "analyze sales calls" and order data is secondary

---

### Decision from Theo Browne

**Choice: Option A (GetCourse Orders + Novofon/Zadarma Direct)**

**Reasoning:**

The SalesGuru value proposition is "AI analyzes your sales calls and gives feedback." For GetCourse clients (infobiz, online courses), the workflow is:

1. Lead comes in (order created)
2. Manager calls the lead (via Novofon/onlinePBX)
3. Call is recorded
4. **SalesGuru analyzes the recording**

We NEED both pieces: the order context (to know who was called and why) AND the recording (to analyze). Option A gives us both with a clean separation:
- GetCourse API handles order data (CrmDeal, CrmFunnel mapped to statuses)
- Novofon API handles call data (CrmMessage with audio)
- Phone number is the join key

The async export API is annoying but manageable -- we can cache results and poll intelligently (export once per sync, not per request).

**Key implementation details:**

1. **Two credential sets required**: GC secret key + Novofon API key/secret. UI must collect both.
2. **Export polling**: Start export -> poll every 3-5 seconds -> timeout after 60s. Cache export results for 15 min.
3. **Phone matching**: Normalize all phones to E.164 format before matching calls to orders.
4. **Manager resolution**: Extract unique `manager_email` values from exported orders. No direct manager list API.
5. **Funnel simulation**: Return a single "funnel" with GetCourse order statuses as stages (new -> in_work -> payment_waiting -> payed/cancelled).
6. **Rate limit guard**: Track export request count per 2-hour window. Queue if approaching limit.

**Risks:**
- **Not all GC clients use Novofon/onlinePBX** -- some use external telephony (Mango, Sipuni, etc.) that we can't access. Must detect and communicate this clearly.
- **100 exports/2h limit** -- with many clients on same GC account, could hit ceiling. Need account-level rate limit tracking.
- **Export API returns ALL orders matching filter** -- no pagination within export. Large accounts (100K+ orders) may return huge payloads.
- **Recording link expiration** -- Novofon recording URLs expire (default 30 min). Must download or generate fresh links just before AI analysis.
- **Onboarding complexity** -- client must provide 2 API keys and understand which telephony they use. Need clear detection/onboarding flow.

---

### Appendix: GetCourse API Reference Summary

#### Auth
```
POST https://{account}.getcourse.ru/pl/api/{endpoint}
Body: key={secret_key}&action={action}&params={base64_json}
```

#### Order Import (Create/Update)
```
Endpoint: /pl/api/deals
Action: add
Params (base64 JSON): {
  "user": { "email": "...", "phone": "..." },
  "deal": {
    "offer_code": "...",
    "product_title": "...",
    "deal_cost": 5000,
    "deal_status": "new",
    "manager_email": "manager@example.com"
  },
  "system": { "refresh_if_exists": 1 }
}
```

#### Order Export
```
POST https://{account}.getcourse.ru/pl/api/account/deals?key={secret}
Query: created_at[from]=2026-01-01&status=payed

Response: { "success": true, "info": { "export_id": "12345" } }

GET https://{account}.getcourse.ru/pl/api/account/exports/12345?key={secret}
Response (when ready): {
  "success": true,
  "info": {
    "status": "exported",
    "items": [
      { "id": 1, "number": "ORD-001", "user_email": "...", "status": "payed", "cost": "5000", ... }
    ]
  }
}
```

#### Novofon/Zadarma API for Calls
```
GET /v1/statistics/pbx/
Params: start=2026-04-01, end=2026-04-15, version=2
Auth: API key + secret (HMAC signature)

GET /v1/pbx/record/request/
Params: pbx_call_id=12345 (or call_id)
Response: { "links": ["https://api.zadarma.com/.../recording.mp3"], "lifetime_till": "..." }
```

#### GetCourse Callback Variables (for webhooks)
```
Order process: {object.id}, {object.number}, {object.status}, {object.cost}
User fields: {object.user.email}, {object.user.phone}, {object.user.first_name}
Session UTMs: {create_session.utm_source}, {create_session.utm_medium}, etc.
```

#### Rate Limits
- Export API: 100 requests per account per 2 hours
- Exports run sequentially (one at a time per account)
- Novofon: 100 req/min general, 3 req/min for statistics
- Recording links: expire in 30 min by default (configurable up to 60 days)
