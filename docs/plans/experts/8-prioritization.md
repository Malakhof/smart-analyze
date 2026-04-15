# Prioritization & MVP Scope -- First Revenue from Queued Clients

## Aspect: What to do FIRST to start taking money from queued GetCourse clients

### Project Context

**What exists today (deployed at sa.qupai.ru):**
- Next.js 15 + Prisma + PostgreSQL SaaS app
- Multi-tenant schema already in DB (Tenant model with `id`, `plan`, `dealsLimit`)
- User auth via NextAuth.js (email/password + sessions)
- CRM adapter pattern: `CrmAdapter` interface with `Bitrix24Adapter` and `AmoCrmAdapter` implementations
- Sync engine that pulls deals, managers, funnels, messages from CRM via adapter
- AI analysis pipeline: DeepSeek for deal analysis + patterns + insights
- QC module: scripts, call scoring, transcription via Whisper
- Single demo tenant currently active
- Registration endpoint exists (`/api/auth/register`)

**Key technical files:**
- `/root/smart-analyze/src/lib/crm/types.ts` -- CrmAdapter interface (getDeals, getMessages, getManagers, getFunnels, testConnection)
- `/root/smart-analyze/src/lib/crm/adapter.ts` -- Factory with switch on provider
- `/root/smart-analyze/src/lib/sync/sync-engine.ts` -- Generic sync that works with any CrmAdapter
- `/root/smart-analyze/prisma/schema.prisma` -- Full schema with Tenant, User, CrmConfig, Deal, etc.
- CrmProvider enum currently: `BITRIX24`, `AMOCRM`

**GetCourse reality:**
- GetCourse is NOT a CRM. It's an LMS (learning management system) for course creators/experts.
- GetCourse API: limited. Can PUSH users/orders IN, can set up CALLBACK webhooks OUT. No real pull/export API for orders/deals.
- GetCourse has no call storage. Telephony (Sipuni, Mango, etc.) is always separate.
- QUP project already has GetCourse webhook integration (receiving order events via URL callbacks with `{object.id}`, `{object.status}`, `{object.cost}`, etc.)

**The gap:**
- Current CrmAdapter assumes you can PULL data (getDeals, getManagers). GetCourse is PUSH-only (webhooks).
- GetCourse "deals" are actually "orders" -- different mental model.
- Calls come from telephony (Sipuni, Mango Office, Zadarma), not from GetCourse.
- Multi-tenancy schema exists but auth flow only creates one tenant. No tenant isolation tested at scale.

---

### Expert Analysis

> "Analyzing as a Product Strategist (inspired by Marty Cagan / Des Traynor) because this is fundamentally a product-market-fit and prioritization question -- not an architecture one. The code is secondary to getting revenue flowing."
>
> **Principles from 3 experts:**
> 1. Sam Newman (Architecture): "Bounded context -- GetCourse adapter is a separate context from CRM sync. Don't force GetCourse into a CRM-shaped hole."
> 2. Theo Browne (API design): "Fail fast, explicit errors -- if GetCourse can only push, build a push receiver, don't fake a pull adapter."
> 3. Nir Eyal (UX/Product): "Trigger -> action -> variable reward -> investment. First client onboarding IS the trigger. Manual setup IS acceptable if time-to-value is fast."

---

### Answer to Each Question

#### 1. Absolute minimum to charge the first client?

**For a GetCourse client who sells courses/coaching:**

What they actually need from "sales analytics AI":
- See their orders/deals flowing in (from GetCourse webhooks)
- Get AI analysis of their sales conversations (calls from telephony)
- See patterns: what works, what doesn't
- QC on their sales team's calls

**Minimum viable:**
- Create their tenant manually (1 SQL command)
- Set up GetCourse webhook URL (they paste it into GetCourse processes -- identical to what QUP already does)
- Orders flow in as "deals" automatically
- Telephony integration: START WITH MANUAL UPLOAD of call recordings (MP3/WAV upload button)
- AI analysis runs on uploaded calls
- Dashboard shows their data

**What can be manual/hacky:**
- Tenant creation (you do it, not self-service registration)
- GetCourse webhook URL generation (you generate it, send to client)
- Call upload (manual file upload vs auto-pull from Sipuni)
- Mapping GetCourse "managers" (they tell you who handles what, you create Manager records)

#### 2. Concierge MVP -- yes, absolutely

This is the textbook correct approach for 50K/month clients. They are paying for the RESULT (AI insights on their sales), not for the SETUP experience. Manual setup is 30-60 minutes per client. At 50K/month that's extremely profitable.

**Concierge flow:**
1. Client signs contract, pays
2. You create tenant, user account, send credentials
3. You generate GetCourse webhook URL, send with screenshot instructions
4. Client pastes URL into GetCourse processes (5 min on their side)
5. Orders start flowing in automatically
6. For calls: client uploads MP3 files (or sends via Telegram bot, or you pull from Sipuni API manually)
7. You trigger sync + AI analysis
8. Client sees dashboard with insights

#### 3. Critical path

```
Day 0: Tenant creation works (registration endpoint exists, just needs testing)
       |
Day 1: GetCourse webhook receiver (adapt existing QUP webhook to Smart Analyze format)
       |
Day 2: Call upload (MP3 file upload -> Whisper -> transcript -> AI analysis)
       |
Day 3: Tenant isolation verified (data properly filtered by tenantId)
       |
Day 4: First client onboarded
```

Tenant isolation is already baked into the schema (every table has `tenantId`). The sync engine already filters by `tenantId`. Risk is LOW -- just need to verify it works.

#### 4. Separate GetCourse integration from multi-tenancy? Which first?

**Multi-tenancy first. It's already 90% done.**

The schema has tenantId everywhere. Auth has tenantId in session. The gap is:
- Registration flow creates tenant + user (exists at `/api/auth/register`)
- Need to verify data isolation (each query filters by tenantId)
- Need to test with 2+ tenants

GetCourse integration is the HARDER problem and should be built as a new adapter type.

**Order: Multi-tenancy verification (1 day) -> GetCourse webhook adapter (1-2 days) -> Call upload (1 day)**

#### 5. Can we offer amoCRM clients first?

Yes, but the QUEUE is GetCourse clients. Offering amoCRM to people who don't use amoCRM is pointless. However:

- If you ALSO have amoCRM leads, absolutely onboard them -- it already works.
- amoCRM clients can be onboarded TODAY with zero additional development.
- Use them as proof: "Here's a live client dashboard" for GetCourse prospects.

**Recommendation:** Onboard 1 amoCRM client this week as a reference case. In parallel, build GetCourse adapter.

#### 6. Beta program?

**Yes, but frame it differently.** Don't say "beta" (implies broken). Say:

"Founding member program: 30K/month (instead of 50K) for first 5 clients. You get priority support, we set up everything for you, and your feedback shapes the product."

Benefits:
- Lower barrier to "yes"
- Justification for manual setup ("white glove service")
- Feedback loop built in
- Creates urgency (only 5 spots)

#### 7. Seven-day sprint plan

**Day 1 (Tuesday): Multi-tenant verification + amoCRM client**
- Create second tenant manually, verify data isolation
- Onboard 1 amoCRM client (if available) -- prove the system works
- Fix any multi-tenant bugs found

**Day 2 (Wednesday): GetCourse webhook receiver**
- Add `GETCOURSE` to CrmProvider enum
- Create GetCourse "push adapter" -- webhook endpoint that receives order events
- Map GetCourse fields to Deal model (order_id -> crmId, cost -> amount, status -> status)
- Auto-create Manager records from GetCourse user data
- Test with mock webhook calls

**Day 3 (Thursday): Call upload pipeline**
- Add file upload endpoint: POST /api/audio (already exists! check if it handles raw uploads)
- UI: "Upload call recording" button on deals page
- Flow: upload MP3 -> Whisper transcription -> store as CallRecord + Message
- Solve Whisper access (OpenRouter proxy or local)

**Day 4 (Friday): GetCourse onboarding flow**
- Settings page: "Connect GetCourse" -> shows webhook URL with instructions
- Auto-generate webhook URL per tenant (with tenant token)
- Test end-to-end: GetCourse webhook -> Deal created -> visible in dashboard

**Day 5 (Saturday): AI analysis on real data**
- Run DeepSeek analysis on uploaded calls
- Verify patterns/insights generate correctly with GetCourse data
- Fix edge cases (GetCourse orders have different statuses than CRM deals)

**Day 6 (Sunday): Polish + first client onboarding**
- Fix UI bugs found during testing
- Prepare onboarding guide (screenshots for client)
- Onboard first GetCourse client (concierge style)

**Day 7 (Monday): Stabilize + second client**
- Monitor first client's data flowing
- Fix issues that arise
- Onboard second client

---

### Solution Options

**A: Full Self-Service (build everything, then launch)**
- Essence: Build registration flow, GetCourse adapter, auto-telephony integration, multi-tenant admin panel. Then open for signups.
- Pros: Scalable from day 1. Professional. No manual work per client.
- Cons: 3-4 weeks minimum. Clients churn from waiting. Revenue delayed by a month.
- When: When you have 50+ clients queued and can afford the wait.

**B: Concierge MVP (manual setup, minimum code)**
- Essence: Manual tenant creation, GetCourse webhook URL generated by you, call upload (not auto-pull), you trigger analysis. Build only what breaks without code.
- Pros: First client in 4-5 days. Revenue starts this week. Learn what actually matters.
- Cons: Does not scale past 5-10 clients. Your time becomes the bottleneck. Each onboarding is 30-60 min.
- When: Exactly now -- small queue of high-value clients, product-market fit still being validated.

**C: Hybrid (concierge + progressive automation)**
- Essence: Start with concierge for first 3 clients. Each pain point you do manually, automate after the third time. Within 2-3 weeks, most of the setup is self-service.
- Pros: Revenue from day 5. Automation driven by real needs (not assumptions). Best of both worlds.
- Cons: Requires discipline to automate (easy to keep doing manual forever). Code gets messy if not refactored.
- When: When you have 3-10 clients queued and expect growth. This is the classic startup pattern.

**D: Pivot to amoCRM-first (ignore GetCourse queue)**
- Essence: Since amoCRM already works, find amoCRM clients instead. GetCourse integration later.
- Pros: Zero development needed. Can onboard today.
- Cons: Ignores the actual queue of paying clients. GetCourse is a bigger market for this product (course creators = sales teams selling courses).
- When: Only if GetCourse clients aren't actually ready to pay or the integration proves too complex.

---

### Decision (as Product Strategist)

**Choice: Option C -- Hybrid (concierge + progressive automation)**

**Reasoning:**

The queued clients at 50K/month are the most important signal this business has. Every day without revenue is not just lost money -- it's lost validation. The existing codebase is 80% ready: multi-tenant schema exists, adapter pattern exists, webhook handling exists (in QUP). The gap is smaller than it looks.

The critical insight is that **GetCourse is push-only (webhooks), not pull.** This actually makes integration EASIER, not harder. You don't need to build a full CrmAdapter with getDeals/getManagers. You need a webhook endpoint that receives events and creates Deal records. This is a 1-day build, not a 1-week build.

The hardest part is **calls** -- GetCourse has no call storage. The concierge answer is: manual upload first, Sipuni/Mango API integration second. Most GetCourse clients use Sipuni or Mango Office. Ask the first client which telephony they use, then build that specific integration.

**Sprint priority:**
1. **Day 1-2:** Verify multi-tenancy + build GetCourse webhook receiver
2. **Day 3:** Call upload pipeline (manual MP3 upload)
3. **Day 4:** Onboard first paying client (concierge)
4. **Day 5-7:** Automate whatever the first client's experience reveals as painful

**Risks:**
- Whisper API access from Russian server (403 from OpenAI). Mitigation: use OpenRouter as proxy, or Deepgram, or self-hosted Whisper.
- GetCourse webhook reliability (they sometimes retry, sometimes don't). Mitigation: idempotent webhook handler (check order_id before creating duplicate).
- Client expects "magic" but gets "upload MP3 manually". Mitigation: frame it as "white glove setup" and automate telephony integration within the first week.
- Tenant data leakage (wrong tenantId). Mitigation: add middleware that injects tenantId from session into every DB query. Test with 2 tenants before onboarding real client.

**The non-obvious move:** Offer the first client a 1-week free trial where you do everything manually. Use that week to build automation. By the time you invoice them, the automation exists. They never know it was manual.

---

### Concrete Technical Tasks (ordered)

#### Task 1: Multi-tenant registration (Day 1, 2 hours)
- File: `/root/smart-analyze/src/app/api/auth/register/route.ts`
- Verify: creating user creates tenant, tenantId propagates to session
- Test: create 2 users, verify they see only their data
- If broken: fix session to include tenantId

#### Task 2: GetCourse webhook endpoint (Day 1-2, 4 hours)
- Add `GETCOURSE` to CrmProvider enum in schema.prisma
- Create: `src/lib/crm/getcourse.ts` -- NOT a full CrmAdapter, just a webhook handler
- Create: `src/app/api/webhooks/getcourse/route.ts`
- Accept: order_id, status, cost, user_email, user_phone, utm_* params
- Create: Deal + Manager (from sales rep info) + Funnel (from offer/product type)
- Idempotent: upsert by crmId (order_id)
- Auth: token in URL params (per-tenant webhook token stored in CrmConfig)

#### Task 3: Call upload endpoint (Day 3, 3 hours)
- File: `src/app/api/audio/route.ts` (already exists -- check if handles file upload)
- Accept: MP3/WAV file + dealId (optional) + managerId (optional)
- Flow: save file -> create CallRecord -> queue Whisper transcription
- UI: "Upload call" button on deals list or deal detail page

#### Task 4: Settings page -- "Connect GetCourse" (Day 4, 2 hours)
- File: `src/app/(dashboard)/settings/page.tsx`
- Add GetCourse tab: show webhook URL, copy button, instructions with screenshots
- Auto-generate token per tenant if not exists

#### Task 5: First client onboarding (Day 4-5)
- Manual: create tenant, create CrmConfig with GETCOURSE provider
- Send client: webhook URL + instruction screenshots
- Client sets up webhook in GetCourse processes
- Orders start flowing in
- Client uploads first calls (or sends via email/Telegram)
- You run analysis, client sees dashboard

#### Task 6: Telephony integration -- Sipuni (Day 6-7, if client uses Sipuni)
- Sipuni has an API to pull call recordings
- Build: SipuniAdapter that periodically pulls new calls
- Auto-match calls to deals by phone number
- This replaces manual upload for this specific client

---

### Revenue Timeline

| Day | Milestone | Revenue |
|-----|-----------|---------|
| 1-3 | Build GetCourse webhook + call upload | 0 |
| 4 | First client onboarded (concierge) | Invoiced 50K |
| 7 | Second client onboarded | Invoiced 50K |
| 14 | 3-5 clients running | 150-250K/month |
| 30 | Self-service registration works | Scaling |

**Bottom line: First invoice on Day 4. Not Day 30.**
