# Visual Bugfixes — from user screenshots

> **For Claude:** Fix these in order, deploy, verify.

## Bug 1: Conversion chart Y-axis "00%"
**File:** `src/app/(dashboard)/_components/conversion-chart.tsx`
**Fix:** The Tremor AreaChart `valueFormatter` probably uses template literal with backtick issue. Change to: `valueFormatter={(v: number) => v + "%"}`

## Bug 2: QC donut charts — black ring in light mode
**File:** `src/app/(dashboard)/quality/_components/qc-donut-charts.tsx`
**Fix:** Tremor DonutChart uses dark colors by default. Add explicit `colors` prop with visible colors: `["blue", "amber", "emerald"]` for categories, `["rose", "orange", "red", "pink", "fuchsia"]` for tags.

## Bug 3: QC compliance chart — Y-axis labels cut off ("10%", "75%")
**File:** `src/app/(dashboard)/quality/_components/qc-compliance-chart.tsx`
**Fix:** Add left margin to chart container or use `className="pl-4"`. Also fix Y-axis formatter same as Bug 1.

## Bug 4: Audio not playing — internal URL
**Problem:** audioUrl is `http://80.76.60.130:8089/recordings/...` — port 8089 not exposed externally.
**Fix options:**
a) Expose port 8089 in firewall
b) Add Caddy reverse proxy: `recordings.qupai.ru → localhost:8089`
c) Proxy through our app: `/api/audio/[filename]` → fetch from internal URL
**Best:** Option c — create API route that proxies audio.

## Bug 5: Kirill not in QC — CallRecord without score
**Problem:** CallRecord exists but has no CallScore → QC queries filter by scored calls
**Fix:** QC page should show ALL call records, not just scored ones. Or: auto-score on sync.

## Bug 6: Transcript as single block — needs speaker separation
**File:** `src/app/(dashboard)/deals/[id]/_components/deal-audio.tsx`
**Fix:** Parse transcript by sentence patterns. Use heuristics: even sentences = operator, odd = client. Or use DeepSeek to re-format with speaker labels.

## Bug 7: Duplicate call recordings on deal page
**Problem:** 2 "Запись звонка" blocks — one from manual insert, one from auto-sync
**Fix:** Delete manual duplicate from DB. Add dedup in query by audioUrl.

## Execution order: 4 → 1 → 2 → 3 → 7 → 5 → 6
