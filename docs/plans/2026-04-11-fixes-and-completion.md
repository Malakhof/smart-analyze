# Smart Analyze — Plan: Fixes & Completion to Full Clone

> **For Claude:** REQUIRED SUB-SKILL: Use superpents:executing-plans to implement this plan task-by-task.

**Goal:** Довести MVP до полноценного рабочего продукта: починить баги из аудита, проверить все страницы, подключить реальную amoCRM, протестировать DeepSeek, сверить с оригиналом.

**Context:** 25 задач написаны субагентами, приложение задеплоено на sa.qupai.ru, seed-данные работают. Дашборд и паттерны отображаются корректно. Нужно проверить и починить остальное.

**API keys available:** DeepSeek, OpenAI Whisper, amoCRM (malakhoffkiri.amocrm.ru)

---

## Phase A: Critical Fixes (from audit)

### Fix 1: Security — auth check on /api/quality/score batch

**File:** `src/app/api/quality/score/route.ts`
**Problem:** Batch scoring endpoint accepts any tenantId without auth validation
**Fix:** Add `getServerSession` + verify tenantId matches session user

### Fix 2: Pattern extraction — destructive delete

**File:** `src/lib/ai/extract-patterns.ts`
**Problem:** Deletes ALL patterns before creating new ones. If API fails mid-way, all patterns are lost.
**Fix:** Wrap in Prisma transaction: create new patterns first, then delete old ones on success.

### Fix 3: Manager status calculation baseline

**File:** `src/lib/ai/extract-patterns.ts`
**Problem:** Uses conversion from analyzed deals only, not all tenant deals
**Fix:** Calculate overall conversion from ALL managers' cached metrics

### Fix 4: amoCRM test connection — call real API

**File:** `src/app/api/settings/crm/test/route.ts`
**Problem:** Only validates format for amoCRM, doesn't test actual connection
**Fix:** Call AmoCrmAdapter.testConnection() which hits /account endpoint

**Commit all fixes together**

---

## Phase B: UI Localization & Polish

### Fix 5: Login/Register pages — Russian text

**Files:** `src/app/(auth)/login/page.tsx`, `src/app/(auth)/register/page.tsx`
**Changes:**
- "Sign in" → "Вход"
- "Enter your credentials..." → "Введите данные для входа"
- "Don't have an account?" → "Нет аккаунта?"
- "Create account" → "Создать аккаунт"
- "Sign in" button → "Войти"
- Register: "Create account" → "Регистрация", "Company name" → "Название компании"

### Fix 6: KeyMetrics — dynamic change values

**File:** `src/app/(dashboard)/_components/key-metrics.tsx`
**Problem:** Hardcoded "-3.2%", "+8.1%", etc.
**Fix:** Pass change values from dashboard query or remove changes for now (seed data doesn't have history)

### Fix 7: Dashboard — match original UI details

Compare our dashboard with original screenshots and fix:
- Воронка: у оригинала есть **зелёный прогресс-бар** под воронкой (общий)
- Успех/Провал: у оригинала иконки в кружках (✓ и ✕)
- Метрики: подписи под значениями ("с 26 коммуникациями" — из второй презентации)
- Поиск в хедере ("Поиск..." — из второй презентации)

**Commit**

---

## Phase C: Verify All Pages Work (browser testing on sa.qupai.ru)

### Fix 8: Менеджеры (список) → verify and fix

- Navigate to /managers
- Check: summary cards display correct counts
- Check: table renders all 4 managers with correct metrics
- Check: click on manager row → navigates to /managers/[id]
- Fix any broken pages

### Fix 9: Manager drill-down → verify and fix

- Navigate to /managers/[id] for each manager
- Check: header (avatar, name, status pill)
- Check: 5 stat cards with correct data
- Check: success/failure deal cards with AI analysis text
- Check: quotes display correctly (QuoteBlock)
- Check: patterns section shows linked patterns
- Check: deal links navigate to /deals/[id]
- Fix any issues

### Fix 10: Deal detail → verify and fix

- Navigate to /deals/[id]
- Check: 2-column layout renders
- Check: AI analysis block with text
- Check: 4 metric cards (talk ratio, response time, messages M:K, calls)
- Check: Stage tree with vertical timeline
- Check: Expanding stages shows messages
- Check: Sidebar stats
- Check: Quick navigation scrolls
- Fix any issues

### Fix 11: Контроль качества → verify and fix

- /quality — dashboard with call summary, manager table, recent calls
- /quality/manager/[id] — call list for specific manager
- /quality/calls/[id] — call detail with transcript, audio player, script checklist
- Fix any broken pages

### Fix 12: Settings → verify and fix

- /settings — CRM tab (Bitrix24 + amoCRM forms)
- /settings?tab=company — company info
- /settings?tab=plan — plan display
- /settings?tab=scripts — script editor CRUD
- /settings?tab=telegram — bot config
- Fix any broken pages

**Commit after each fix**

---

## Phase D: Real amoCRM Integration Test

### Fix 13: Connect real amoCRM and sync

Using the real amoCRM account:
- Subdomain: malakhoffkiri
- Token: (in .env on server)

Steps:
1. Go to /settings → CRM tab
2. Enter amoCRM credentials
3. Click "Подключить amoCRM"
4. Click "Синхронизировать"
5. Check: deals, managers, funnels appear in DB
6. Check: dashboard updates with real data
7. Fix any sync issues (field mapping, status detection)

### Fix 14: Test Whisper transcription on real call

If the amoCRM account has a call recording:
1. Sync the deal with call
2. Call POST /api/transcribe with the message ID
3. Check: transcript appears in deal detail
4. Fix any transcription issues

**Commit**

---

## Phase E: Test DeepSeek AI on Seed Data

### Fix 15: Test deal analysis prompt

1. Call POST /api/analyze/deal with a seed deal that has messages
2. Check: DealAnalysis record created with:
   - summary (1 paragraph, Russian)
   - successFactors / failureFactors
   - keyQuotes (array with actual quotes)
   - talkRatio, avgResponseTime
3. Check: dashboard updates with analysis
4. Iterate prompts if results are low quality

### Fix 16: Test pattern extraction

1. After several deals analyzed, call POST /api/analyze/patterns
2. Check: Pattern records created with meaningful:
   - title, description (Russian)
   - strength/impact/reliability/coverage metrics
   - deal/manager links
3. Check: Insights created
4. Check: Manager statuses updated
5. Check: pattern library page updates

### Fix 17: Test QC call scoring

1. Call POST /api/quality/score with a seed call record
2. Check: CallScore created with:
   - totalScore (reasonable %)
   - Each CallScoreItem has isDone + aiComment
3. Check: Telegram alert would fire for critical misses (if TG configured)
4. Iterate CALL_SCORING_PROMPT if needed

**Commit**

---

## Phase F: Missing Features from Original (from screenshots)

### Fix 18: Accordion full content — dashboard insights

**Current:** Accordions expand to show title only
**Original:** Expanded accordion shows:
1. Short description
2. "Подробное описание:" — full AI text
3. "Список сделок где встречается:" — clickable #chips
4. "Список менеджеров:" — name chips
5. "Список цитат:" — actual quotes

**Verify** this works with seed data. The Insight model has `detailedDescription`, `dealIds`, `managerIds`, `quotes` fields.

### Fix 19: Deal page — stage messages inside accordion

**Current:** Stage tree may not show messages inside expanded stages
**Original:** Each stage expands to show chronological messages with sender labels

**Verify** seed data has messages linked to stages via timestamps. Fix query if needed.

### Fix 20: QC realtime cabinet (from second presentation)

**What exists:** QC dashboard, call detail, script checklist
**What's missing from second presentation:**
- "Выполнение скрипта" — overall compliance % chart over time
- Tags/categories breakdown with bar chart
- KPI connection to script scores ("к этим баллам привязали KPI менеджеров")
- Telegram realtime alerts for missed critical items during call
- "Категории" tab in QC — breakdown by call types

**Add:** At minimum, the tags and categories views if data exists.

### Fix 21: Deploy script — auto-reconnect network

**Problem:** Every rebuild loses qup_qupnet connection
**Fix:** Add `docker network connect qup_qupnet smart-analyze-app` to deploy.sh

**Commit**

---

## Phase G: Final Deploy & Verify

### Fix 22: Final rebuild + deploy

1. Push all fixes
2. Run deploy.sh
3. Re-run seed (if schema changed)
4. Verify all pages on sa.qupai.ru
5. Test login, navigation, all 6+ screens

---

## Task Summary

| Phase | Fixes | What |
|-------|-------|------|
| A. Critical | 1-4 | Security, destructive delete, status calc, amoCRM test |
| B. Polish | 5-7 | Russian text, dynamic metrics, UI match |
| C. Verify | 8-12 | Test all pages, fix broken ones |
| D. Real CRM | 13-14 | amoCRM sync + Whisper test |
| E. AI Test | 15-17 | DeepSeek prompts on real data |
| F. Missing | 18-21 | Accordion content, stage messages, QC features, deploy fix |
| G. Final | 22 | Deploy and verify |

**Total: 22 fixes across 7 phases.**

**Execution order:** A→B→C (fix everything) → D (real CRM) → E (AI test) → F (missing features) → G (deploy)
