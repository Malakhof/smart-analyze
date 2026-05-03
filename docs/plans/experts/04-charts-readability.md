# Q4: Charts Readability Redesign (Tufte)

**Date:** 2026-05-03
**Expert:** Edward Tufte (data visualization)
**Project:** SalesGuru sales call analytics — premiere 4.05
**Scope:** 4 pages (Главная / Паттерны / Менеджеры / Контроль качества)

---

## Project Context

**Stack constraints (from `docs/canons/ui-inventory-2026-05-03.md`):**
- Recharts 3.8 + Tremor 3.18 (only Tremor used in `/quality` legacy)
- Tailwind v4 with custom CSS vars: `status-green/amber/red`, `ai-1/2/3` gradient (#7C6AEF → #5B8DEF → #4ECDC4), `surface-0..4`, `text-primary..muted`, radius 14px
- shadcn 4.2 (17 primitives — `Card`, `Table`, `Badge`, `Tooltip`, etc.)
- next-themes light/dark — colour palette must work in both modes
- Anti-pattern (canon): "❌ Менять цветовую палитру / шрифты / sidebar layout" — stay within existing CSS vars

**Current chart inventory (what's actually rendered):**

| # | Page | Block | File | Implementation |
|---|---|---|---|---|
| 1 | Главная | Block 1 daily activity | `dashboard-rop.tsx:142-225` | shadcn `Table` (7 columns, no chart) |
| 2 | Главная | Block 2 script score per МОП | `dashboard-rop.tsx:229-292` | Hand-rolled horizontal bars (`<div>` width %) — green/amber/red threshold |
| 3 | Главная | Block 4 missing phrases | `dashboard-rop.tsx:389-431` | Text list with red % |
| 4 | Главная | Block 4b weakSpot + critical errors | `dashboard-rop.tsx:435-500` | Two `<ol>` lists |
| 5 | Главная | Block 6 heatmap 7×24 | `dashboard-rop.tsx:567-640` | Hand-rolled `<table>` of 16×16px cells, alpha = success rate |
| 6 | Главная | Block 7 funnel stages | `dashboard-rop.tsx:644-707` | Hand-rolled bars with `linear-gradient(135deg, ai-1, ai-2)` (decorative) |
| 7 | Менеджеры/[id] | callType / managerStyle distribution | `manager-detail.tsx:164-217` | Hand-rolled bars, ai-1→ai-2 gradient (decorative) |
| 8 | Менеджеры/[id] | mini-heatmap 7×24 | `manager-detail.tsx:319-411` | Same heatmap as Block 6 + best/worst sentence |
| 9 | Контроль качества | QcDonut categoryBreakdown / tagBreakdown | `qc-donut-charts.tsx` | Recharts `PieChart` (donut) + manual legend |
| 10 | Контроль качества | QcCompliance | `qc-compliance-chart.tsx` | Tremor `AreaChart` (violet/fuchsia gradient) |
| 11 | Контроль качества | QcScoreDistribution | `qc-score-distribution.tsx` | Tremor `BarChart` (violet/fuchsia) |
| 12 | Контроль качества | QcSummary | `qc-summary.tsx` | 4 stat cards |
| 13 | Контроль качества | QcManagerTable | `qc-manager-table.tsx` | Table + inline mini-bar |

**User-stated grievance:** Block 7 (funnel stages) — "ненаглядно".

---

## Expert Analysis

> "Analyzing as **Edward Tufte** because every chart in this product describes the same evaluative dimension — managers ranked, techniques missed, hours hot/cold — which begs for ranked bars over circles, sequential single-hue intensity, and inline annotation rather than separate legends. The product is dense numerical reality (12 techniques, 7×24=168 cells, 5-7 managers, 5+ funnel stages); decorative gradients and donut charts cost ink without buying meaning."
>
> **Principles from 3 experts:**
> 1. **Edward Tufte:** "Above all else, show the data. Maximise the data-ink ratio. Erase non-data-ink. Erase redundant data-ink." A 135° gradient on a horizontal bar is decorative ink — it encodes nothing. The same gradient on every bar prevents reading the bar as a category.
> 2. **Stephen Few (dashboard design, BI):** "Bullet graphs replace dial gauges; sparklines replace trend mini-charts; heatmaps require a single sequential hue, not a rainbow." Donut charts force comparison-by-area, which the eye cannot do — a sorted bar chart is strictly better.
> 3. **William S. Cleveland (graphical perception):** Position along a common axis > length > angle > area > colour. Therefore: ranked horizontal dotplots/bars > donuts > pies > 3D anything. Categorical comparisons should always preserve sort order; alphabetical sorting destroys the signal.

---

## Per-chart audit table

| # | Chart | Current type | Data-ink | Tufte critique | Proposed | One-line rationale |
|---|---|---|---|---|---|---|
| 1 | Daily activity (Block 1) | shadcn Table 7 cols | High | OK structure, but no visual scan: eye reads digit-by-digit; pipelineGap red flag is buried | Table + inline sparkbar in "Дозвоны" column (`dialed/real` ratio) + tabular-nums + sticky МОП column on mobile | Tables are fine — Tufte loves tables for ≤20 rows. Add micro-bar for pickup ratio so РОП scans visually. |
| 2 | Script score per МОП (Block 2) | Hand-rolled horiz bars | Medium | Bar widths use `pct/max`, not absolute 0-100 — distorts comparison ("Vasya 65% looks 90% wide because top is 70%"); also no median/dept reference line | Horizontal **dotplot** with axis 0-100, median tick, threshold guides at 50 / 70 (red→amber→green band background) | Dotplot uses position-on-axis (Cleveland #1). Reference lines turn relative ranking into actionable threshold. |
| 3 | Missing phrases (Block 4) | Text list, 3 items | High | Already minimal. Hint-text wraps and shifts eye away from %. Sort is by missing-pct desc — good. | Keep list. Add tiny **inline horizontal bar** behind the % (max=100) so 70% vs 95% reads at a glance. | Inline inline-bar adds <2 ink/data and gives a comparative scan without a separate chart. |
| 4 | weakSpot / critical errors (Block 4b) | Two `<ol>` lists | High | Two separate cards make the eye saccade; no visual weight on top item. | Single 2-column card with **shared title row "Системные паттерны отдела"**, leftcol weakSpot (5 lines) rightcol criticalError (5 lines), each with right-aligned sparkline ratio | Reduces card fragmentation. Same numbers, less chrome. |
| 5 | Heatmap 7×24 (Block 6) | `<table>` 16×16 cells | Medium | (a) green-only single hue is fine — keep; (b) cells with `total=0` blend into bg, ambiguous "no calls" vs "low success"; (c) no axis annotation for "open phones" hours; (d) no marginal totals; (e) `border: 1px solid surface-1` adds chartjunk lines on every cell | Same heatmap, but: (a) draw 9-21 hours band as subtle background to mark "working hours", (b) replace per-cell border with 1px gap (negative space), (c) add **right-side row totals** + **bottom column totals** (Tufte small-multiple marginals), (d) striped diagonal pattern for `total=0` cells (semantically distinct from "low success"), (e) drop the "h % 3 === 0" labels — show every hour as 1-digit at 0/6/12/18 only | Heatmap is the single best Tufte-shape on the dashboard. Just clean the chartjunk and add marginals. |
| 6 | Funnel stages (Block 7) — **user said "ненаглядно"** | Hand-rolled bars with 135° ai-1→ai-2 gradient | LOW | Decorative gradient on every bar = same colour for every category → cannot encode anything. Title says "куда движутся клиенты" but bars are sorted by count desc, not by funnel order — destroys the funnel mental model. Bullet beside name is `1.5×1.5` — pure ornament. | **Stage-ordered horizontal bar** (not sorted by count!), leftcol stage name, midcol bar with single solid `surface-3` fill, rightcol `count (pct%)` aligned right. Add subtle "stage-in-pipeline" prefix `1. Новый → 2. Качественный → ...`. Use `status-green` ONLY for closed-won stage, `status-red` ONLY for closed-lost; rest neutral. | Funnel needs **funnel order** (semantic), not Pareto order. Single-hue bars + semantic colour for terminal stages = readable in 1 second. |
| 7 | callType / managerStyle distribution (Manager card) | Hand-rolled bars + ai gradient | Low | Same issue as #6: every bar same gradient, sorted by count desc. callType/style is categorical-nominal — gradient implies ordering that doesn't exist. | Sorted horizontal bars, single `surface-3` fill, `text-secondary` count, `text-tertiary` pct. No gradient. Compact 6-row max, "ещё N…" footer if more. | Categorical nominal data needs neutral fill. Pareto sort is fine (this isn't a funnel). |
| 8 | Mini-heatmap (Manager card) | Same as #5 | Medium | Same issues + the best/worst annotation below is text-only and disconnected from the cells | Same redesign as #5, plus **arrow callout from best cell** (highlight border `2px status-green`) and worst cell (`2px status-red`), inline text overlay "Лучшее окно: Чт 11:00 (62%)" anchored to the row | Tufte: "annotation belongs near the data point, not in a footnote". |
| 9a | QcDonut (Категории) | Recharts donut + manual legend | LOW | (a) Donut requires reading angles (Cleveland: worst encoding); (b) 5-colour categorical palette (`#3b82f6, #f59e0b, #10b981, #8b5cf6, #06b6d4`) — random hues, no semantic meaning; (c) total in centre is duplicated with sum of legend values; (d) legend is a small-font dot+name+value table — already a better chart than the donut! | **Drop donut. Show only the legend table.** Sort desc, add an inline bar fill behind the count (max=total). Single-hue (`surface-3` neutral fill is enough) since categories are nominal. | The "legend" already encodes everything; the donut adds zero info while costing 160px of vertical space and 5 random colours. |
| 9b | QcDonut (Теги) | Recharts donut + manual legend | LOW | Same + tag colours are all reds/pinks (`#ef4444, #f97316, #dc2626, #ec4899, #d946ef`) which over-emphasises severity for nominal categories | **Same swap as 9a.** Use a single neutral fill; if tags are critical errors, keep `status-red-dim` so they read as warnings, but don't multi-hue them. | Decorative red palette ≠ severity encoding. |
| 10 | QcCompliance (AreaChart) | Tremor `AreaChart`, violet+fuchsia, 280px | Medium | (a) Two filled areas overlap and obscure each other; (b) fuchsia (previous) is visually heavier than violet (current) — wrong hierarchy; (c) gridlines + animation + gradient + legend = chartjunk; (d) X-axis labels truncated to 12 chars + ellipsis | Tremor `LineChart` (not Area), violet for "Текущий" (solid 2px), `text-muted` ghost line for "Предыдущий" (1px dashed), no fill, `showGradient={false}`, `showAnimation={false}`, `showGridLines={false}`, axis label "Этапы скрипта" rendered horizontally — break long names with `<br/>` rather than truncating | Less ink; comparative reads as "current solid vs ghost prior" which is the canonical Tufte time-pair pattern. |
| 11 | QcScoreDistribution (BarChart) | Tremor BarChart violet+fuchsia, 280px | Medium | Two-colour grouped bars compress reading; user must compare A-vs-B in each bucket, then bucket-vs-bucket. With only ~4-6 buckets, it's still busy. | **Small multiples.** Two thin BarCharts side-by-side: "Текущий период" (left, violet) + "Предыдущий период" (right, `text-muted`), shared Y-axis, 140px tall each. Or single BarChart with **delta arrows** (+5, –3) on top of each bar. | Tufte: "Small multiples > one giant chart with multiple series". |
| 12 | QcSummary (4 stat cards) | OK | High | Already clean. Minor: change-indicator `+` and `-` numbers don't have a baseline — show `(was 78)` on hover or as muted suffix | Add `(было 78)` muted suffix to make change interpretable | Numerical context is data-ink, not chartjunk. |
| 13 | QcManagerTable | OK | High | Already excellent. Avatar gradients per index are decorative and rotate randomly with sort — drop or use single `surface-3` initials chip | Replace `AVATAR_CLASSES` with single muted chip (one initial + `surface-3` bg) | Avatars carry no information; they're Tufte-class chartjunk. |

---

## Wireframes — top 5 redesigns (frontend-implementable)

### W1 — Block 7 Funnel Stages (highest user complaint)

**Current** (`dashboard-rop.tsx:644-707`):
```
● Новый клиент             47   18%
[████████████████████]   ← purple→teal gradient, sorted by count desc
● Квалификация             39   15%
[████████████████]
...
```

**Proposed:**
```
┌─────────────────────────────────────────────────────────────────────┐
│ Куда движутся клиенты после наших звонков                          │
│ Сделки в порядке стадии воронки. % = от всех затронутых сделок.    │
├─────────────────────────────────────────────────────────────────────┤
│ 1. Новый                ▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆      47   18%        │
│ 2. Качественный         ▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆         39   15%        │
│ 3. Презентация          ▆▆▆▆▆▆▆▆▆▆▆▆▆▆            32   12%        │
│ 4. Оплата ожидается     ▆▆▆▆▆▆▆▆▆▆▆▆               28   11%        │
│ 5. Закрыта (выиграна)   ▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆   54   21%   ●green│
│ 6. Закрыта (проиграна)  ▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆   62   23%   ●red  │
└─────────────────────────────────────────────────────────────────────┘
```

**Implementation notes:**
- Sort by `stageOrder` (CRM pipeline order), NOT `count` desc
- Bar fill: `bg-surface-3` (neutral) for all non-terminal stages
- Terminal stages: `bg-status-green/20` for won, `bg-status-red/20` for lost
- Drop the `linear-gradient(135deg, ai-1, ai-2)` on bars
- Keep ai-gradient ONLY for the small leading bullet `●` if needed for design coherence (and only on terminal won stage)
- Number prefix `1.`, `2.` clarifies funnel order at a glance
- Width formula stays `count / max * 100%`

**Data-ink delta:** −1 gradient layer per bar × 6 bars = −6 decorative paints; +1 semantic colour cue (won/lost only) = +2 useful colour signals.

---

### W2 — QcDonut (Категории + Теги) → ranked-bar legend

**Current:** Donut (160px tall) + 5-colour palette + legend table below.

**Proposed (per card):**
```
┌──────────────────────────────────────────┐
│ Категории                Всего: 247      │
├──────────────────────────────────────────┤
│ Возражение по цене  ▆▆▆▆▆▆▆▆▆▆▆▆▆   89   │
│ Не дозвонились      ▆▆▆▆▆▆▆▆▆▆▆▆     78   │
│ Заинтересован       ▆▆▆▆▆▆▆▆▆       52   │
│ Назначена встреча   ▆▆▆▆▆           19   │
│ Другое              ▆▆               9   │
└──────────────────────────────────────────┘
```

**Implementation notes:**
- Remove `<ResponsiveContainer><PieChart>...</PieChart></ResponsiveContainer>` block entirely
- Existing legend (lines 78-99 in `qc-donut-charts.tsx`) becomes the chart
- Add horizontal bar fill behind each row: `width: ${item.value/total*100}%`, `bg-surface-3`
- Drop `CATEGORY_COLORS` and `TAG_COLORS` arrays — single neutral fill (`bg-surface-3`)
- Header shows total count `Всего: 247` (keeps the "centre label" data without the donut shell)
- For tag card: use `bg-status-red-dim` fill if all tags are critical errors

**Data-ink delta:** −160px wasted height per card × 2 cards = −320px; −10 random colours; gain: ranked comparison via shared baseline (Cleveland #1).

---

### W3 — Block 6 Heatmap with Marginals + Working-Hours Band

**Current** (`dashboard-rop.tsx:567-640`): 7 rows × 24 cols, `rgba(52,211,153, 0.1+intensity*0.7)`, cell border, h%3 labels, no marginals.

**Proposed:**
```
┌──────────────────────────────────────────────────────────────────┐
│ Когда лучше звонить                                              │
│ 7×24 МСК, цвет = % дозвонов за 30 дней. Полоса 9-21 = раб. часы. │
├──────────────────────────────────────────────────────────────────┤
│        0     6     12    18    23   ║ Σ звонков                  │
│ Пн   ░░░░░ ▒▒░██  ████  ███▒  ░░░░  ║   142                       │
│ Вт   ░░░░░ ▒▒░██  ████  ███▓  ░░░░  ║   156                       │
│ Ср   ░░░░░ ▒▒░██  ████  ████  ░░░░  ║   163                       │
│ Чт   ░░░░░ ▒▒░██  █▓▓█  ███▒  ░░░░  ║   149                       │
│ Пт   ░░░░░ ▒░░██  ████  ████  ░░░░  ║   158                       │
│ Сб   ╳╳╳╳╳ ╳╳╳╳   ╳╳╳╳   ╳╳╳╳   ╳╳╳╳ ║     0  (выходной)          │
│ Вс   ░░░░░ ╳╳░▒   ▒▒▒░   ░░░░   ╳╳╳╳ ║    23                       │
│ ─────────────────────────────────────                            │
│ Σ%   2%  ↑ 38%   54%   41%   3%                                  │
│              ╰─ working hours band ─╯                            │
│                                                                  │
│ Лучшее окно: Чт 11:00 (62%, n=18). Худшее: Пн 18:00 (12%, n=14). │
└──────────────────────────────────────────────────────────────────┘
```

**Implementation notes:**
- Working-hours band: render an absolutely-positioned `<div>` behind cells from col 9 to col 21, `bg-surface-2/30` (subtle); achievable with a wrapping `<div className="relative">` + `<div className="absolute inset-y-0 left-[37.5%] right-[12.5%] bg-surface-2/30 -z-10">`
- Drop per-cell `border border-surface-1` — replace with `padding-cell-spacing` via `border-collapse: separate; border-spacing: 1px` on the table
- Cells with `total=0`: replace solid bg with diagonal stripe pattern: `background: repeating-linear-gradient(45deg, var(--surface-1), var(--surface-1) 2px, transparent 2px, transparent 4px)` — semantically "no data" ≠ "low data"
- Marginal totals: append `<td>Σ</td>` to header + footer; row totals on the right show `total` count; column footer shows successRate %. These are pure additions, no existing cell layout changes.
- Hour axis: replace `h % 3 === 0 ? h : ""` with show only `0, 6, 12, 18, 23` — 5 labels instead of 8
- Best/worst annotation: keep existing text under the heatmap (already in `manager-detail.tsx:401-407`); add same to Block 6 main page (currently missing)

**Data-ink delta:** −168 cell borders, +14 marginal labels (= 7 row totals + 7 col totals), +1 working-hours band shape. Net: less ink, more meaning.

---

### W4 — Block 2 Script Score Dotplot with Threshold Bands

**Current** (`dashboard-rop.tsx:229-292`): Hand-rolled bars, width = `pct/max*100`, threshold colour green/amber/red.

**Proposed:**
```
┌─────────────────────────────────────────────────────────────────┐
│ Оценка скрипта                                                  │
│ AVG scriptScorePct среди real_conversation ≥ 60s.              │
│ Зелёная зона ≥70%, красная ≤50%.                                │
├─────────────────────────────────────────────────────────────────┤
│  0%      25%   |  50%       70%   |  100%                       │
│  ─red─────────●─amber────●●──green────────                      │
│                                                                  │
│  Эльнура         ─────────────────●        82%   ↑ 4            │
│  Светлана        ──────────────●           74%                  │
│  Мария           ────────────●             68%                  │
│  ── median ──────────────●─── (66%)        ◀ dept median        │
│  Анна            ──────────●               62%                  │
│  Ольга           ─────●                    47%   ↓ 8            │
│  Татьяна         ───●                      38%                  │
└─────────────────────────────────────────────────────────────────┘
```

**Implementation notes:**
- Container: `relative` `<div>` with absolute-positioned threshold bands (`left: 0; width: 50%; bg-status-red/8`), (`left: 50%; width: 20%; bg-status-amber/8`), (`left: 70%; width: 30%; bg-status-green/8`)
- Each row: name (col-span-3) + dotplot row (col-span-9 of relative axis 0-100%) + score number (right-aligned) + delta vs prev period if available
- Replace bar `<div>` with single small `●` 8×8px dot at `left: ${pct*100}%`
- Add **median tick** as a vertical dashed line at the dept median X position, full height of the chart
- Threshold band colour: use existing `status-green`, `status-amber`, `status-red` at 8% opacity for background bands
- Sorted by score desc (current sort preserved)
- Width fix: bar/dot now uses **absolute 0-100%**, not relative-to-max — matches what the % number says

**Data-ink delta:** Bars (3px tall × N rows × pct width) replaced by single 8px dots = ~70% less fill ink. Threshold bands and median line are pure information gain.

---

### W5 — QcCompliance Line + Ghost (replaces violet/fuchsia AreaChart)

**Current** (`qc-compliance-chart.tsx`): Tremor `AreaChart`, two filled areas (violet + fuchsia), 280px tall, gradient + animation + gridlines.

**Proposed:**
```
┌─────────────────────────────────────────────────────────────────┐
│ Выполнение скрипта                                              │
│ % звонков, где этап скрипта присутствует. Серый = прошлый период│
├─────────────────────────────────────────────────────────────────┤
│ 100% ─                                                          │
│      │  ╭──╮     ╭───────────╮                                  │
│  75% ─  │  ╰─────╯           ╰─╮                                │
│      │  │    ········.···        ╰─╮                            │
│  50% ─ ·······         ·····.        ╰──╮                       │
│      │                       ······       ╰─                    │
│  25% ─                                                          │
│      │                                                          │
│   0% ─┴────┬────┬────┬────┬────┬────┬────┬────                  │
│      Привет Прич Выявл Презент Возр Сделка След.шаг             │
│                                                                  │
│  Текущий ───  Прошлый период ··· (–8% от приветствия)            │
└─────────────────────────────────────────────────────────────────┘
```

**Implementation notes:**
- Switch from Tremor `<AreaChart>` to `<LineChart>` (still Tremor)
- Props change:
  - `colors={["violet", "gray"]}` (drop fuchsia)
  - `showGradient={false}`
  - `showAnimation={false}`
  - `showGridLines={false}` (keep just Y-axis ticks 0/25/50/75/100)
  - Strokes: current = solid 2px, previous = dashed 1px (Tremor LineChart accepts `connectNulls` and `customTooltip`; for dashed line use `customTooltip` or wrap in Recharts directly with `strokeDasharray="3 3"`)
- Stop truncating step names to 12 chars — break at underscore: `выявление\nпотребностей`
- Inline annotation: replace separate legend with a single line of muted text below: `Текущий — solid; Прошлый — dashed (–8% от приветствия)`
- Height 240px (was 280px)

**Data-ink delta:** −2 fill areas (gradient + opacity), −animation, −gridlines, −fuchsia decorative hue. Net: 60% less non-data-ink.

---

## Colour palette recommendation (no new colours)

Per existing CSS vars in `globals.css`:

| Use case | Variable | Where |
|---|---|---|
| **Threshold quality** (≥70 / 50-70 / <50) | `status-green` / `status-amber` / `status-red` | Block 2, Block 4, QcManagerTable, score buckets |
| **Threshold quality bands (background)** | `status-{x}/8` (8% opacity) | W4 dotplot bands |
| **Categorical-nominal fill** (callType, managerStyle, categories, tags) | `surface-3` (single neutral) | W2 QcDonut → ranked-bar, manager #7 |
| **Funnel terminal stages** | `status-green/20` (won), `status-red/20` (lost) | W1 funnel; everything else `surface-3` |
| **Heatmap intensity (single sequential hue)** | Keep `rgba(52,211,153, 0.1+intensity*0.7)` (status-green channel); replace 0-data cells with diagonal stripe pattern using `surface-1` | W3 heatmap |
| **Brand accents (decorative ONLY where the design demands)** | `ai-1/ai-2/ai-3` gradient | Limit to logo, header, chips for "AI generated" badge — NOT inside chart bars |
| **Time-pair comparison (current vs previous)** | Current = `text-primary`/violet; Previous = `text-muted` (dashed/ghost) | W5 line chart, QcScoreDistribution small multiples |

**Anti-rules:**
- No `linear-gradient(135deg, var(--ai-1), var(--ai-2))` inside data marks (bars, dots, cells) — it's decorative ink and prevents categorical encoding
- No multi-hue categorical palettes (the `#3b82f6/#f59e0b/#10b981/...` array in `qc-donut-charts.tsx`) — categorical-nominal data needs neutral fill + position
- No fuchsia anywhere except brand accents

---

## 24h scope flag (P1 vs P2)

**P1 — small textual config edits, ship by 4.05 premiere:**

| # | Change | File | Estimated minutes |
|---|---|---|---|
| 1 | Block 7 funnel: drop gradient, sort by stageOrder, add green/red on terminals | `dashboard-rop.tsx:644-707` | 25 |
| 2 | Manager card distributions: drop gradient, single `surface-3` fill | `manager-detail.tsx:164-217` | 10 |
| 3 | Block 2 width formula: `(pct/max)*100` → `pct*100` (so 70% looks 70% wide) | `dashboard-rop.tsx:259` | 5 |
| 4 | Heatmap: remove per-cell border, change axis labels to 5 ticks, add 0-data diagonal stripe | `dashboard-rop.tsx:567-640` + `manager-detail.tsx:319-411` | 35 |
| 5 | QcDonut: comment out `<PieChart>` block, expand legend to ranked bars, drop `CATEGORY_COLORS/TAG_COLORS` | `qc-donut-charts.tsx` | 30 |
| 6 | QcCompliance: `AreaChart` → `LineChart`, drop fuchsia/gradient/animation | `qc-compliance-chart.tsx` | 15 |
| 7 | QcManagerTable: drop avatar gradient rotation, single neutral chip | `qc-manager-table.tsx:17-22` | 5 |

**Total P1: ~2 hours.** All edits are config/JSX-level, no new query, no new dependency.

**P2 — full chart-type swaps, post-premiere:**

| # | Change | Effort |
|---|---|---|
| A | Block 2 → real dotplot with threshold bands + median tick (W4) | 2h |
| B | Heatmap marginal totals + working-hours band overlay (W3 full) | 2h |
| C | QcScoreDistribution → small multiples (two thin BarCharts) | 1h |
| D | Block 1 daily activity: inline sparkbar in "Дозвоны" column | 1.5h |
| E | Block 4b → single 2-col card with sparkline ratios | 1h |

**Total P2: ~7.5 hours.**

---

## Risks

1. **Heatmap marginal totals query change** — current `HeatmapCell` shape is `{dow,hour,total,successRate}`. Marginals require `Σ total per row` and `Σ successRate per col` aggregations. Cheap to compute client-side from existing cells (no new SQL), but ensure the `0-data` row case is handled (Сб = 0 in example).
2. **Threshold band absolute positioning (W4)** — needs `relative` parent with fixed width per row; if dashboard layout changes (e.g. switching to mobile column stack), `left: 50%` breaks. Recommend wrapping in a fixed-width container `max-w-[480px]` for the dotplot block.
3. **W5 dashed line via Tremor** — Tremor `LineChart` does NOT expose `strokeDasharray` per series. Two options: (a) drop to raw Recharts `<LineChart><Line strokeDasharray="3 3"/>` (~30 min refactor), or (b) compromise: previous-period line in `text-muted` solid 1px instead of dashed. Pick (b) for P1, (a) for P2.
4. **Recharts 3.8 + React 19.2 compatibility** — already in project, no risk.
5. **Dark/light mode** — all proposed colours use CSS vars that already work in both modes (verified by checking `globals.css` references). Heatmap intensity using fixed `rgba(52,211,153, ...)` already works fine in both modes per current production.
6. **User said "ненаглядно" specifically about funnel (Block 7)** — W1 directly addresses this. Ship W1 + W2 + W7 (avatar drop) as the minimum P1 set if time-constrained.

---

## Decision from Edward Tufte

**Choice:** Execute P1 in full (≈2h), defer P2 to post-premiere.

**Reasoning:**
1. Premiere is in 24h. Every P1 edit either **removes ink** (drop gradients, drop multi-colour palettes, drop avatar rotation) or **adds 1 semantic colour to terminal funnel stages**. None requires new data, new query, new component, or new library. The risk profile is "edit JSX literals, ship".
2. The single highest-impact fix is **W1 funnel reorder + drop gradient** because the user explicitly called Block 7 "ненаглядно" — fixing it both addresses a complaint and removes the most chartjunk per character of code.
3. The second highest is **W2 donut → ranked bars** because donut→bar is the canonical Tufte upgrade and the current donut wastes ~320px of vertical real estate across two cards on the QC page.
4. The third is **W3 heatmap cleanup** — even without marginals (P2), removing per-cell borders and axis-label clutter recovers significant data-ink for a chart РОП will look at every Monday morning.
5. P2 changes (dotplot with threshold bands, small multiples, sparkbars in tables) are higher-craft but require more layout testing and have higher chance of regressing on mobile or in dark mode under deadline.

**Above all else, show the data.** P1 ships exactly that.
