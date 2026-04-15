# Expert Analysis: Client Onboarding & Connection Verification Flow

## Aspect: Onboarding UX for SalesGuru (CRM + GetCourse + Telephony)

---

### Project Context

**Current state of settings UI:**
- Settings page at `/settings?tab=crm` with left nav (7 tabs: CRM, Company, Plan, Users, Scripts, Telegram, Notifications)
- CRM tab shows Bitrix24 (webhook URL + funnel selector) and amoCRM (subdomain + API key) inline, one below another
- Each CRM has a status badge (connected/not connected), input fields, save/test buttons
- No setup wizard, no onboarding flow, no first-time user detection
- Dashboard layout (`layout.tsx`) has no conditional redirect or onboarding check
- Tenant model tracks `plan`, `dealsUsed`, `dealsLimit` but has no `onboardedAt` or setup-complete flag

**Current CRM adapter architecture:**
- Clean adapter pattern: `CrmAdapter` interface in `src/lib/crm/types.ts` with `testConnection()`, `getFunnels()`, `getDeals()`, `getMessages()`, `getManagers()`
- Factory in `src/lib/crm/adapter.ts` creates adapter by provider string
- `CrmProvider` enum in Prisma: currently `BITRIX24 | AMOCRM`
- `CrmConfig` model stores: `provider`, `webhookUrl`, `apiKey`, `subdomain`, `isActive`, `lastSyncAt`
- Test endpoint (`/api/settings/crm/test/route.ts`) validates per provider, returns `{ success, error?, company? }`

**GetCourse API specifics (from research):**
- Auth: secret key (generated at `{account}.getcourse.ru/saas/account/api`)
- Endpoints: `https://{account_name}.getcourse.ru/pl/api/account/users`, `.../deals`
- Export is async: request starts task, returns export_id, poll for results
- Rate limit: 100 requests per 2 hours per account
- Only available on paid GC tariffs
- NO calls/telephony in GetCourse -- calls come from separate telephony (Mango, Sipuni, etc.)

**Key files:**
- `src/app/(dashboard)/settings/_components/crm-settings.tsx` -- main CRM settings UI
- `src/app/(dashboard)/settings/_components/settings-content.tsx` -- tab router
- `src/app/(dashboard)/settings/_components/settings-nav.tsx` -- left nav with tabs
- `src/app/api/settings/crm/test/route.ts` -- test connection endpoint
- `src/lib/crm/adapter.ts` -- adapter factory
- `src/lib/crm/types.ts` -- CrmAdapter interface
- `src/lib/crm/amocrm.ts` -- full amoCRM adapter (~350 lines)
- `prisma/schema.prisma` -- CrmConfig, CrmProvider, Tenant models
- `src/app/(dashboard)/layout.tsx` -- dashboard layout (no onboarding gate)

---

### Expert Analysis

> "Analyzing as Nir Eyal (UX/Product) because onboarding is the single most critical moment for activation -- if users don't complete setup, they never see value. The Hook model applies: we need a clear trigger-action-reward loop where connecting CRM is the action and seeing their first data is the variable reward."
>
> **Principles from 3 experts:**
> 1. Theo Browne (API design): "Fail fast with explicit errors -- test connection must validate thoroughly and give actionable error messages, not generic 'connection failed'"
> 2. Sam Newman (Architecture): "Bounded context -- GetCourse is NOT a CRM, it's an LMS. Don't force it into CrmAdapter interface. Treat data sources (CRM, LMS, telephony) as separate bounded contexts"
> 3. Troy Hunt (Security): "Validate all inputs, least privilege -- API keys should be stored encrypted, test endpoint should not leak account details, GetCourse key permissions should be 'read only'"

---

### Answer to Each Question

#### 1. What should the GetCourse onboarding flow look like?

GetCourse requires two fields:
- **account_name** (the subdomain, e.g., `myschool` from `myschool.getcourse.ru`)
- **secret_key** (API key generated in GC admin panel)

The flow should be:
1. User enters account_name (with helper text showing where to find it)
2. User enters secret_key (with link to `{account_name}.getcourse.ru/saas/account/api` and screenshot)
3. Click "Test connection" -- we verify by calling the users export endpoint
4. If OK: show account confirmation, save config, start initial sync

**IMPORTANT:** GetCourse is NOT a CRM. It has deals (orders) and users, but no funnels/pipelines, no messages/chat, no calls. The CrmAdapter interface partially fits (deals, managers) but `getMessages()` and `getFunnels()` are meaningless for GC.

#### 2. What data do we verify during "test connection" for GetCourse?

Test should verify in this order:
1. **DNS resolution**: `{account_name}.getcourse.ru` resolves (catches typos)
2. **API key validity**: POST to `https://{account_name}.getcourse.ru/pl/api/account/users` with `action=add` and a dummy params payload. A valid key returns structured JSON (even error), invalid key returns 403.
3. **Key permissions**: Check if key has read access (attempt an export request, check for permission error)
4. **Account has paid tariff**: API is only available on paid plans -- detect and show helpful error

Return to UI: `{ success: true, accountName: "...", usersCount?: number }` or `{ success: false, error: "Ключ не имеет прав на чтение. Создайте ключ с правом 'Для чтения'" }`

#### 3. Should we add a "setup wizard" for first-time users?

**Yes, absolutely.** Current flow (register -> land on empty dashboard -> figure out settings) has a high drop-off. At 50K/month, losing even one client to bad onboarding is expensive.

#### 4. How to handle telephony separately?

GetCourse clients need a separate telephony integration (Mango Office, Sipuni, OnlinePBX, etc.) for call recordings. This should be a distinct settings tab ("Telephony") with its own connection flow. Not all clients need it -- GC clients may only want deal analytics without call scoring.

#### 5. What's the ideal UX?

See options below.

#### 6. How to verify sync actually works?

After test connection succeeds, trigger a "pilot sync" that fetches last 5 deals and displays them inline: "We found 5 recent deals. Here's a preview: [Deal 1], [Deal 2]...". This gives the user instant confirmation that real data is flowing.

#### 7. Should we show a "connection health" dashboard?

Yes, but as a lightweight status bar in settings, not a separate page. Show: last sync time, deals synced, error count, next sync time. The `/api/sync/status` endpoint already returns most of this data.

---

### Solution Options

#### A: Inline Settings Enhancement (No Wizard)

- **Essence:** Keep the current settings page architecture. Add GetCourse as a third section in `crm-settings.tsx` below amoCRM. Add a "Telephony" tab to settings-nav. Add a banner on the dashboard when no CRM is connected: "Connect your CRM to get started" with a link to settings.
- **Pros:**
  - Minimal code changes (~200 lines)
  - No new routes or pages
  - Consistent with current architecture
  - Works fine for users who know what they're doing
- **Cons:**
  - No guided experience for first-time users
  - Empty dashboard is confusing and demotivating
  - Showing 3 CRM options (Bitrix, amoCRM, GetCourse) simultaneously is overwhelming
  - No "aha moment" during setup
- **When suitable:** If you have very few clients and can hand-hold each one via Zoom/chat

#### B: Post-Login Setup Wizard (3-Step Modal)

- **Essence:** After first login (detect via `Tenant.dealsUsed === 0 && no active CrmConfig`), show a full-screen modal wizard:
  - Step 1: "Choose your platform" (cards: amoCRM, Bitrix24, GetCourse) -- pick one
  - Step 2: Enter credentials (fields depend on chosen platform) + "Test connection" button
  - Step 3: "Pilot sync" -- fetch 5 deals, show preview, confirm setup complete
  
  After wizard completion, set a flag and never show again. Settings page still works for changes/additions.
- **Pros:**
  - Clear, guided path to value -- reduces time-to-first-insight from "??" to 3 minutes
  - One platform at a time, not overwhelming
  - Pilot sync gives instant "aha moment" (user sees their real data)
  - Can be skipped ("I'll set up later") but nudges completion
  - Reusable for future integrations
- **Cons:**
  - ~500-600 lines of new code (wizard component + state machine)
  - Need to add `onboardedAt` field to Tenant model (migration)
  - Need to handle edge cases (user closes browser mid-wizard, second user in same tenant)
  - Modal wizards can feel intrusive if poorly timed
- **When suitable:** Best for B2B SaaS at 50K/month -- clients expect polish and guided setup

#### C: Dedicated Onboarding Page (/setup route)

- **Essence:** Create a new `/setup` page (not a modal, a full page) that lives outside the dashboard layout. After registration, redirect to `/setup`. The page has a vertical stepper:
  1. Platform selection
  2. CRM credentials + test
  3. Telephony (optional, skip for GetCourse)
  4. Pilot sync + preview
  5. "Go to dashboard"
  
  Dashboard layout checks for active CRM config; if none, redirects to `/setup`.
- **Pros:**
  - Full-page experience, no distraction
  - Can include contextual help, screenshots, video guides per platform
  - Natural place to upsell telephony integration
  - Stepper UX shows progress, reduces anxiety
  - Clean separation: `/setup` = onboarding, `/settings` = ongoing config
- **Cons:**
  - Most code (~800-1000 lines): new page, stepper, per-platform forms, redirect logic
  - Duplicate logic with settings page (same credential forms exist in both places)
  - Risk of getting out of sync if settings page changes but setup page doesn't
  - Redirect logic adds complexity to auth flow
- **When suitable:** If onboarding has 4+ steps and includes non-CRM setup (telephony, scripts, team invites)

#### D: Progressive Onboarding (Empty States + Checklist)

- **Essence:** No wizard at all. Instead, every page shows a helpful empty state when no data exists. Dashboard shows a "Getting Started" checklist card:
  - [ ] Connect your CRM
  - [ ] Run first sync
  - [ ] Configure scripts (optional)
  - [ ] Set up Telegram alerts (optional)
  
  Each item links to the relevant settings tab. Checklist disappears when all required items are done.
- **Pros:**
  - Most flexible -- user chooses their own path
  - Empty states serve as documentation
  - Checklist provides progress tracking
  - No new routes or modals
  - Works for returning users who add new integrations
- **Cons:**
  - User still lands on an empty, potentially confusing dashboard
  - No guided "test connection" flow -- relies on settings page UX
  - Checklist can feel like homework, not reward
  - Harder to ensure users complete critical steps (CRM connection)
- **When suitable:** Power users, developer-oriented products, or when there are many optional setup steps

---

### Decision from Nir Eyal

**Choice: Option B -- Post-Login Setup Wizard (3-Step Modal)**

**Reasoning:**

The Hook model demands that the time between trigger (signing up) and variable reward (seeing your own sales data) be as short as possible. Option B achieves this in 3 clicks:

1. **Trigger**: User logs in for the first time, wizard appears automatically
2. **Action**: Select platform, paste credentials -- minimal friction
3. **Variable Reward**: Pilot sync shows their actual deals -- "wow, it pulled my data!"
4. **Investment**: They've now invested credentials and seen value, creating switching cost

At 50K/month, every client matters. The wizard costs ~500 lines of code but prevents the #1 SaaS killer: users who sign up, see an empty dashboard, and never come back.

**Why not C (full page)?** Overkill for 3 steps. A modal wizard achieves the same guidance with less code and no route duplication. If we later need 5+ steps (telephony, team invites, script config), upgrade to a full page then.

**Why not D (checklist)?** Checklists work for products with many optional features. SalesGuru has ONE critical step (connect CRM). A wizard ensures it happens immediately. Add a checklist LATER for optional features (Telegram, scripts).

**Why not A (inline)?** At 50K/month, "figure it out yourself" is unacceptable. The current settings page is fine for changes, but first-time setup needs hand-holding.

---

### Implementation Specification

#### Data Model Changes

```prisma
// Add to CrmProvider enum:
enum CrmProvider {
  BITRIX24
  AMOCRM
  GETCOURSE  // NEW
}

// Add to CrmConfig model -- reuse existing fields:
// account_name goes in `subdomain` field
// secret_key goes in `apiKey` field
// No new columns needed

// Add to Tenant model:
model Tenant {
  // ... existing fields ...
  onboardedAt  DateTime?  // NULL = show wizard, non-NULL = skip
}
```

#### GetCourse Connection Fields

| Field | UI Label | Placeholder | Where to find |
|-------|----------|-------------|---------------|
| `subdomain` | "Имя аккаунта" | `myschool` | "Часть URL до .getcourse.ru" |
| `apiKey` | "Секретный ключ API" | `abc123...` | Link: "{account}.getcourse.ru/saas/account/api" |

#### Test Connection for GetCourse

```
POST /api/settings/crm/test
Body: { provider: "GETCOURSE", subdomain: "myschool", apiKey: "abc123" }

Steps:
1. POST https://{subdomain}.getcourse.ru/pl/api/account/users
   Headers: none (GC uses POST params, not headers)
   Body: { action: "add", key: apiKey, params: base64({}) }
2. If 403 -> "Invalid API key"
3. If JSON with error about params -> key is valid, connection works
4. If timeout -> "Account not found or unavailable"
Return: { success: true, accountName: subdomain }
```

#### Wizard Component Structure

```
src/app/(dashboard)/_components/
  setup-wizard/
    setup-wizard.tsx        -- Main modal with step state machine
    step-platform.tsx       -- Card selector: amoCRM | Bitrix24 | GetCourse
    step-credentials.tsx    -- Dynamic form based on selected platform
    step-pilot-sync.tsx     -- Runs mini-sync, shows deal preview
```

#### Wizard State Machine

```
IDLE -> PLATFORM_SELECTED -> CREDENTIALS_ENTERED -> TESTING -> 
  -> TEST_OK -> SYNCING -> SYNC_DONE -> COMPLETE
  -> TEST_FAILED (back to CREDENTIALS_ENTERED with error)
```

#### Detection Logic (in dashboard layout)

```typescript
// In layout.tsx or a wrapper component:
// 1. Check session -> get tenantId
// 2. Query: tenant.onboardedAt === null AND no active CrmConfig
// 3. If true -> render <SetupWizard /> overlay
// 4. On wizard complete -> PATCH tenant.onboardedAt = now()
```

#### GetCourse Adapter (Partial -- deals only, no messages/calls)

The `GetCourseAdapter` should implement `CrmAdapter` with these caveats:
- `testConnection()`: verify API key as described above
- `getFunnels()`: return single dummy funnel (GC has no pipelines)
- `getDeals()`: use export API (async: start export -> poll -> parse)
- `getMessages()`: return empty array (GC has no messaging)
- `getManagers()`: export users with "admin" role

#### Telephony Tab (Future, Not in Wizard)

Add a "Telephony" tab in settings-nav for clients who need call analysis:
- Mango Office (webhook URL)
- Sipuni (API key)
- OnlinePBX (API key)

This is NOT part of the wizard -- it's an optional advanced setup. GetCourse clients may not need it at all if they only want deal analytics.

#### Connection Health (Lightweight)

Add to the existing CRM settings tab (not a new page):
```
[Green dot] Last sync: 2 hours ago | 1,234 deals | 45 managers | Next sync: in 1 hour
```

Use the existing `/api/sync/status` endpoint which already returns `configs`, `stats.deals`, `stats.managers`.

---

### Risks

1. **GetCourse async export is slow** -- exports can take 10-60 seconds. The pilot sync step needs a loading animation and timeout handling. Consider showing "We're importing your data, this usually takes 30-60 seconds" with a progress indicator.

2. **GetCourse rate limits are harsh** -- 100 requests per 2 hours. The pilot sync must be efficient (one export request, not per-deal fetches). Full sync scheduling needs careful rate limit management.

3. **Wizard shows on wrong user** -- If tenant already has data (second user joining), wizard should not appear. Detection: check `tenant.onboardedAt` OR `crmConfig.isActive === true`, not just deal count.

4. **GetCourse doesn't fit CrmAdapter perfectly** -- `getMessages()` and `getFunnels()` are meaningless. Options: (a) return empty/dummy data, (b) make these optional in the interface, (c) create a separate `LmsAdapter` interface. Recommendation: option (a) for now -- least code, works fine since the sync engine already handles empty arrays.

5. **Duplicate forms** -- Wizard credential forms and settings page forms will share the same fields. Extract shared form components to avoid drift: `<BitrixForm />`, `<AmoCrmForm />`, `<GetCourseForm />` used in both wizard and settings page.
