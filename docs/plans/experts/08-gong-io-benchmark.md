# Q8: Gong.io Presentation Benchmark — Adopt vs Reject

> **Lead expert:** Nir Eyal (Hooked) — потому что вопрос не «какие фичи у Gong», а «**какие presentation patterns** превращают сырые данные в habit loop менеджера». Партнёры: Edward Tufte (data-ink), Steve Krug (don't make me think), Dan Abramov (colocation/single responsibility).
>
> **Constraints:** narrow edu vertical (diva-school), канон #37 = 5 болей + 4 PBX + 3 UX (НЕ 14 widgets), «алёрты не нужны», 24h до премьеры, у нас нет видео-записей, нет CRM-форекаста, нет ARR/денег.

---

## Project Context (что прочитано)

- `docs/plans/experts/05-main-page-reorganize.md` — главная уже спроектирована как «3 секции: Сегодня / Качество / Тренды», 9 блоков на одной странице, без табов.
- `docs/plans/experts/06-deal-card-calls-by-stage.md` — карточка сделки = stages с прикреплёнными звонками.
- `docs/plans/experts/04-charts-readability.md` — у нас Recharts 3.8 + Tremor 3.18, max-width 1120px, sidebar отсутствует.
- `docs/plans/experts/03-anketa-diva-compliance.md` — ROП = action user, собственник = read user. **Алертов как modal/red banner нет, амбер-цвет внутри ячейки = можно.**
- Канон #37 — никаких revenue charts, никакой general-purpose «topics detection» (вместо этого — анкета-категории diva).

---

## Что делает Gong (research summary)

### A. Per-call card layout

Gong call page (research из `help.gong.io`, oliv.ai, tldv.io):

```
┌─ Call Spotlight (left, AI brief) ─────┬─ Video player (right) ───┐
│  Brief (1 paragraph recap)            │  [video / audio]         │
│  Key points (bullets)                 │  Speaker tracks          │
│  Next steps (bullets)                 │  Pointer at current sec  │
│  Outline tabs ────────────────────    │                          │
│   • Introduction (1 min)              │                          │
│   • Current process (3 min)           │                          │
│   • Pricing (5 min)                   │                          │
│  Ask Anything (free-text Q&A)         │                          │
├───────────────────────────────────────┴──────────────────────────┤
│ Timeline (full width): speaker bars + topic outline overlay      │
│ Speaker A ████░░██░░░░░░░░░░ 57%                                 │
│ Speaker B ░░░░██░░██████████ 43%                                 │
├──────────────────────────────────────────────────────────────────┤
│ Tabs: Transcript │ Points of Interest │ Stats │ Comments │ ...   │
│  • Transcript: scrollable, search, jump-to-moment                │
│  • Points of Interest: tracker mentions, questions, filler words │
│  • Stats: talk ratio, longest monologue, interactivity, patience │
└──────────────────────────────────────────────────────────────────┘
```

Ключевые цифры в Stats:
- **Talk ratio** — 43% prospect / 57% rep recommended
- **Longest monologue** — recommended ≤ 2:30
- **Interactivity** — recommended ≥ 5 switches
- **Patience** — 0.6–1.0 sec golden pause

### B. Dashboard widgets

- **Deal Dashboard** — central hub с health score, last interaction, stakeholder coverage.
- **Performance widget** — toggle team/individual, color ranges (green/amber/red).
- **KPI widget** — single number против target.
- **Leaderboard** — auto-generated по activity и pipeline metrics.
- **Activity timeline (3 weeks)** — purple = your activity, red = prospect, grey = other.
- **Funnel widget** — deals total / count / stage conversion / avg time to convert.

### C. Funnel / stage visualization

- Deal board kanban-style: колонки = stages, карточки = deals.
- На каждой карточке: deal value, expected close, **warning column** (no activity / red flag email / no senior contact).
- **Likelihood score** — percentile rank (80 = better than 80% of pipeline).
- Funnel report: stage value, count, conversion %, time to convert.

### D. Quality control charts

- Talk ratio bar (rep vs prospect) per call.
- Longest monologue — single number с recommended threshold.
- Interactivity score — counter switches.
- Trackers panel — список объекций/тем с count.
- Сводно по rep — Performance widget с цветовыми диапазонами.

### Главный pain point Gong (из 600+ G2 review):

> "too complicated, not intuitive at all... had to click through ten screens just to find something useful"
> "scattered across multiple interface sections"
> "filtering or finding specific calls sometimes unintuitive"
> "lack of proactive risk visualization (alerts require manual deal board inspection)"

**Это прямо подтверждает наш канон #37 (3 секции, 1 страница) и «алёрты не нужны».** Gong сам страдает от того, что мы избегаем.

---

## Adopt list (presentation patterns to borrow)

| # | Pattern | Откуда у Gong | Куда у нас | Зачем |
|---|---------|---------------|------------|-------|
| 1 | **Speaker timeline bar** (горизонтальные полосы по говорящему, % справа) | Call page top | Карточка звонка (existing call detail) | Визуальное «кто говорит когда» без листания транскрипта. У нас уже есть speaker-segments в data — это вопрос рендера. |
| 2 | **Outline-as-anchor** (раздел → клик → прыжок в транскрипт с длительностью каждой секции) | Call Spotlight Outline tab | Карточка звонка | Сокращает время «найти момент» с 30 сек до 3 сек. У нас есть `phase` segmentation от анкеты — это natural outline. |
| 3 | **Stats panel компакт справа** (talk ratio, longest monologue, interactivity) | Call page right rail | Карточка звонка sidebar | 3-4 чисел без графиков, single source of truth. У нас УЖЕ это считается, но разбросано. |
| 4 | **Color ranges на metrics** (green/amber/red на target attainment) | Performance widget | dashboard-rop Block 2 (quality score) | Soft anomaly без модалок (соответствует «алёрты не нужны»). У нас уже есть `status-green|amber|red` в design tokens. |
| 5 | **Activity timeline 3 weeks** (purple/red/grey) на deal card | Deal board | Карточка сделки (existing) | Визуально «кто молчит» без отдельного widget «no activity X days». diva-кейс: контакт-разрыв = главный сигнал НДЗ. |
| 6 | **Warning column как badge на deal card** | Deal board | Карточка сделки header | Один знак вместо отдельного блока «риски». diva-перевод: «не дозвонился 5 раз», «нет звонка > N дней», «обещал перезвон — не сделал». |
| 7 | **Briefs format**: 1 параграф recap + bullet «next steps» | Call Spotlight Brief tab | Карточка звонка top | У нас уже DeepSeek summary — переформатировать в 1 параграф + 3 буллета next steps. Это presentation, не новая фича. |
| 8 | **Funnel widget metrics**: count, conversion %, avg time per stage | Funnel report | dashboard-rop Block 7 (если успеваем) ИЛИ post-premiere | Сейчас у нас «где они сейчас сидят» — не funnel. **Adopt только conversion%**, БЕЗ deal-amount (канон #37 = no money). |

---

## Reject list (patterns NOT to copy)

| # | Pattern | Почему reject |
|---|---------|---------------|
| 1 | **Deal Predictor likelihood score (percentile 0-100)** | Black-box ML на pipeline ≤ 200 deals = шум. У diva-школ короткий цикл сделки и понятные phases — percentile «лучше 80% других» ничего не говорит. Юкаи Чоу: black-hat motivation (страх) без actionable trigger. |
| 2 | **Topics detection / Smart Trackers** (auto-detect concepts) | У нас НЕ general-purpose: у нас **анкета diva = жёсткий каталог 5 болей**. Smart trackers = решение для горизонтального tool. Edward Tufte: «не показывайте то, что не нужно для решения». |
| 3 | **Ask Anything (free-text Q&A на звонок)** | Token-cost burn (~$0.01-0.05 per question), РОП такое спрашивать не будет (он смотрит quality score, а не chat). Раймонд Хеттингер: EAFP только для готовых паттернов, не для AI-чата. Post-premiere возможно. |
| 4 | **14+ dashboard widgets, customizable** | Прямо нарушает канон #37 (5+4+3). G2 review единогласно: «too many data points». Steve Krug: don't make me think. |
| 5 | **Leaderboard auto-generated по pipeline metrics** | Для diva РОПов это «кто ловит больше горячих» — black-hat motivation, демотивирует МОПов в неуравновешенных портфелях. Yu-kai Chou: scarcity без mastery = anxiety. |
| 6 | **Forecasting widget (revenue prediction)** | Канон #37 явно: **денег нет**. Собственник diva-школы видит revenue в getcourse, мы анализируем качество. |
| 7 | **Risk-based modal alerts / red banners** | Прямо запрещено canon: «АЛЕРТЫ НЕ НУЖНЫ». Только soft amber внутри ячейки. |
| 8 | **Coaching scorecards с manager-rated rubric** | У нас уже есть anketa-derived score. Двойной слой = confusion. Дёрнем post-premiere если РОПы попросят. |
| 9 | **Video player** | У нас аудио + транскрипт. Не пытаться встраивать video player с заглушкой — выглядит как «pretend Gong». |
| 10 | **Pipeline kanban с warning column на deal board** (как сетка) | У нас сделок мало per РОП (≤30), kanban-доска = лишний UI. Нашему scale хватает табличного вида со status-цветом. |

---

## Top-3 patterns for 24h application (quick wins)

### 1. Stats panel компакт на карточке звонка (3-4 числа справа)

**Откуда:** Gong call page right rail (Stats: talk ratio, longest monologue, interactivity, patience).

**Куда:** уже существующая call-detail page → правая колонка sidebar (или верхний row из 4 KPI).

**Почему 24h:**
- Числа уже считаются в pipeline (`talk_ratio`, `longest_monologue` есть в whisper-worker output).
- Нужен только presentation: 4 числа + recommended threshold + цвет (green/amber/red).
- Без новых API, без новых SQL — переразложить existing data.

**Конкретно:**
```
┌──── Stats ────┐
│ Talk Ratio    │
│ 62% / 38%     │ amber (>57% = monologue risk)
│               │
│ Longest mono  │
│ 4:12          │ red (>2:30)
│               │
│ Interactivity │
│ 8 switches    │ green (≥5)
│               │
│ Phase coverage│
│ 4/7 ✓         │ amber (анкета diva)
└───────────────┘
```

**Эффект:** РОП за 2 секунды видит проблему звонка БЕЗ открытия транскрипта.

### 2. Speaker timeline bar над транскриптом

**Откуда:** Gong horizontal speaker bars (`Speaker A ███░░██░░ 57%`).

**Куда:** карточка звонка над транскриптом, full-width 1 строка высотой ~32px.

**Почему 24h:**
- У нас есть speaker-segments per timestamp в выходе whisper.
- Recharts/Tremor обоих умеют horizontal stacked bar.
- 1 component, ~80 строк, без backend изменений.

**Конкретно:**
- Полоса 100% width = длительность звонка.
- Цветные сегменты по spreadinfo `rep|client`.
- На hover — timestamp + speaker name.
- Клик → jump в транскрипт на этот момент.

**Эффект:** «где монолог МОПа», «где клиент молчал 5 минут» видно глазом без счётчиков.

### 3. Color ranges на quality score (Block 2 dashboard-rop)

**Откуда:** Gong Performance widget с green/amber/red value ranges.

**Куда:** dashboard-rop Block 2 (Quality bar) — уже есть, но нужно добавить ranges.

**Почему 24h:**
- В design tokens уже есть `status-green|amber|red`.
- Нужно только: задать пороги (например <60 red, 60-79 amber, ≥80 green) и применить.
- Это soft anomaly, не модальный алёрт — соответствует канону.

**Эффект:** Nir Eyal trigger — РОП утром глазом видит «3 МОПа в амбере» → клик → drill-down. Hook loop за 5 секунд.

---

## Top-3 patterns for post-premiere backlog

### 1. Outline-as-anchor (фазы анкеты как clickable jump-points)

- На карточке звонка слева — список фаз анкеты с длительностью (`Установка контакта 1:20`, `Выявление потребности 4:30`, ...).
- Клик → jump в транскрипт.
- **Не 24h:** требует UI-component + mapping phase→timestamp range, ~1-2 дня.
- **Зачем post-premiere:** quality-of-life для РОПа, кратно ускоряет review, но не блокирует премьеру.

### 2. Activity timeline 3-weeks на карточке сделки

- Горизонтальная полоса с цветными точками (purple = звонок МОПа, red = звонок клиента, grey = прочее).
- На hover — детали активности.
- **Не 24h:** требует aggregation по deal_id × дата × тип события, plus новый component.
- **Зачем post-premiere:** «кто молчит / кто стучится» для НДЗ-анализа = killer feature для diva-школ. Но карточка сделки уже работает без этого.

### 3. AI Brief format (1-paragraph recap + 3 bullet next steps)

- Reformat existing DeepSeek summary в строгий контракт: 1 параграф (≤80 слов) + Next steps (3 буллета максимум).
- На карточке звонка — самый верхний блок.
- **Не 24h:** требует prompt engineering + еval на 50+ звонках чтобы гарантировать формат.
- **Зачем post-premiere:** уменьшает «time to first insight» с 30 сек до 5 сек, но требует тщательной работы с DeepSeek prompt — не делать наспех.

---

## Comparison table: Gong widget X vs наш widget X

| # | Что | Gong | SalesGuru (current) | Что у нас лучше | Что у Gong лучше | Action |
|---|-----|------|---------------------|-----------------|------------------|--------|
| 1 | **Главный экран** | 14+ widgets, customizable, leaderboard, forecast | 5 болей + 4 PBX + 3 UX (канон #37), 3 секции | Меньше шума, narrow vertical, цельный mental model для diva-РОПа | Customization (но это и проблема — overload) | Держим канон, не трогаем |
| 2 | **Карточка звонка** | Brief + Outline + Stats + Transcript + Trackers + Comments + Scorecards | Транскрипт + summary + базовые stats | Анкета-матрица фаз (5 болей diva) — точнее general topics | Speaker timeline, color-coded talk ratio, side-by-side video | Adopt #1, #2, #3 (Stats panel + speaker bar + color ranges) |
| 3 | **Карточка сделки** | Kanban deal board, warning column, activity timeline 3w, likelihood score | Stages + calls по stage (Q6) | Привязка звонков к stage = natural для diva-цикла | Activity timeline + warning badges | Backlog: activity timeline, warning badges (НЕ kanban) |
| 4 | **Funnel/stages** | Funnel widget: count, value, conversion %, avg time | Block 7 = «где они сейчас сидят», без conversion % | Не показываем выручку (канон #37) | Conversion % between stages | Adopt только conversion %, money — reject |
| 5 | **Quality control (per rep)** | Performance widget: toggle team/individual, color ranges, multiple metrics | Block 2 (quality bar) + Block 4 (missing phrases) — flat | Анкета-derived metrics точнее generic talk-ratio | Color ranges на target attainment | Adopt #3 (color ranges) |
| 6 | **Talk-ratio per call** | Bar 43%/57% prospect/rep + recommended threshold | Не визуализируется отдельно (есть в данных) | — (у нас отсутствует) | Visual immediate diagnosis | Adopt #1 (Stats panel) и #2 (speaker bar) |
| 7 | **Risks / alerts** | AI Deal Monitor warnings, badges | Нет (канон: «алёрты не нужны») | Меньше шума, без alert fatigue | Proactive surfacing | Reject (канон) |
| 8 | **AI summary per call** | Call Spotlight: Brief + Outline + Ask Anything | DeepSeek summary (free-form) | Уже работает | Структурированный формат (1 par + bullets) | Backlog: format brief |

---

## Decision from Nir Eyal

**Ключевой вывод:** Gong — горизонтальный тул для general B2B, мы — narrow edu vertical. **Большинство Gong-фич мы НЕ должны копировать**, потому что они решают проблему «scale across industries» — у нас её нет, у нас одна анкета diva.

**Но** Gong сильнее нас в **call-level presentation** (timeline, stats panel, color ranges). Это presentation patterns, не feature copies — их можно adopt без нарушения канона #37.

**Главный риск:** соблазн «ну сделаем ещё 5 widget'ов как у Gong». Это путь к G2-pain «too overwhelming». Канон #37 — наша защита, держимся за него.

**24h plan (priority order):**
1. **Color ranges на Block 2** (Performance widget pattern) — 1 час, soft anomaly без алёрта.
2. **Stats panel на карточке звонка** (4 числа справа) — 3-4 часа, новая мини-секция.
3. **Speaker timeline bar над транскриптом** — 4-6 часов, новый component.

**Что НЕ делаем за 24h:** Activity timeline на сделке, AI Brief format, Outline-as-anchor — всё в backlog.

**Risks при имплементации:**
- Speaker bar требует чёткого mapping speaker label (диаризация Whisper не всегда даёт стабильный `Speaker_0|1` — нужна уверенная атрибуция rep vs client). Если не стабильно — выкатываем без этого пункта.
- Color ranges на quality score: пороги нужно валидировать на real data (нельзя ставить «<60 = red» если у нас все 50-70). Pre-check на 200+ звонков diva до выкатки.
- Stats panel: не дублировать данные из других мест на карточке (single source of truth).

---

## Sources

- [Gong — Sales Analytics Software](https://www.gong.io/sales-analytics-software)
- [Oliv — Gong Analytics Features 2025](https://www.oliv.ai/blog/gong-analytics)
- [Oliv — 600+ Gong Reviews analysis](https://www.oliv.ai/blog/gong-reviews)
- [Gong Help — Intro to the call page](https://help.gong.io/docs/intro-to-the-call-page)
- [Gong Help — Review what happened in a call](https://help.gong.io/docs/review-what-happened-in-a-call)
- [Gong Help — Save time with Call Spotlight](https://help.gong.io/docs/save-time-with-call-spotlight)
- [Gong Help — Understanding deal boards](https://help.gong.io/docs/understanding-deal-boards)
- [Gong Help — Deal warnings](https://help.gong.io/docs/customize-your-deal-warning-settings)
- [Gong Help — AI Deal Predictor likelihood](https://help.gong.io/docs/explainer-about-deal-likelihood-scores)
- [Gong Help — Funnel widget](https://help.gong.io/docs/viewing-the-funnel-widget)
- [Gong Help — Performance widget](https://help.gong.io/docs/performance-widget)
- [Gong Help — Smart trackers (pre-trained)](https://help.gong.io/docs/by-gong-pre-trained-smart-trackers)
- [Atrium — Gong Longest Monologue metric](https://support.atriumhq.com/hc/en-us/articles/4403301211277-Gong-Longest-Monologue)
- [Atrium — Gong Patience metric](https://support.atriumhq.com/hc/en-us/articles/4404977523341-Gong-Patience)
- [Gong Blog — Talk-to-listen ratio 2025](https://www.gong.io/resources/labs/talk-to-listen-conversion-ratio/)
- [Gong — Call Spotlight product page](https://www.gong.io/call-spotlight)
- [G2 — Gong reviews 4.7 stars](https://www.g2.com/products/gong/reviews)
- [tldv.io — How Gong works in practice 2026](https://tldv.io/blog/how-does-gong-work/)
