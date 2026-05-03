# Q3 — Anketa Diva ↔ UI Compliance Checklist

**Date:** 2026-05-03
**Source of truth:** `docs/demo/2026-04-22-diva-anketa-answers.md`
**UI baseline:** `ui-inventory-2026-05-03.md` + `dashboard-rop.tsx` + `manager-detail.tsx` + `call-card.tsx` + `client-card.tsx` + `dashboard-gc.ts` + `managers-gc.ts`
**Premiere:** 4.05.2026 (T-1 day)

> Analyzing as **AJTBD + Sales Operations Product Analyst**, with cross-checks
> from Sam Newman (bounded context), Theo Browne (type-safe contracts) и
> Yu-kai Chou (motivation hierarchy).
>
> Constraint stated by user: «Лишнего НЕТ». I check both directions —
> что отсутствует и что лишнее.

---

## Sections 1 (Телефония) и 7 (CRM-поля) — skipped

Эти секции технические и закрыты внутренней работой команды (anketa explicit:
п.7 — «Пункт 7 закрыт силами команды — клиенту не писать»; п.1 — заблокирован
ожиданием API-доступа от Тани, не имеет UI-составляющей в SalesGuru, только
в pipeline).

---

## Section 2 — Менеджеры (МОПы / Первая линия / Кураторы)

| Anketa item | What diva asked | What UI shows | Gap | Priority |
|---|---|---|---|---|
| 2.1 МОПы — основной отдел | Контролировать всех МОПов, агрегаты по отделу | Block 1 «Активность за период» (Daily activity per МОП) исключает кураторов; Block 4b «Системные паттерны отдела» (top weakSpot/criticalErrors) | match | OK |
| 2.2 Первая линия (Жихарев + Чернышова) — ОТДЕЛЬНЫЙ отдел, ДРУГОЙ скрипт | Должна быть отдельная вкладка/секция «Первая линия» с другим скриптом | `isFirstLine` в БД и в `CategoryBlock` карточки звонка (KvRow), но **на главной и в /managers нет split «МОПы / Первая линия»**. Канон #37 explicit требует это для diva. | **MISSING (P1)** | P1 |
| 2.3 Кураторы — НЕ контролировать (8 фамилий) | Excluded from metrics + lists | `getCuratorManagerIds()` исключает по `isCurator=true` ИЛИ по 8 фамилиям из `CURATOR_LASTNAMES`. Используется в `dashboard-gc.ts:107` и `managers-gc.ts:69`. ✅ | match | OK |
| 2.4 Полный список МОПов по ФИО | Не прислан клиентом | UI не может валидировать; в `/managers` показываются все non-curator из таблицы `Manager` | partial (внешний blocker) | OK |

**Section 2 score:** 3 / 4 = **75%**

**One-liner:** Anketa says split «МОПы / Первая линия» с разными скриптами →
UI shows только flag в карточке звонка, без отдельной вкладки на главной → **mismatch
(P1)**.

> ⚠ Нюанс: `CURATOR_LASTNAMES` содержит **«Чернышева»** (с «е»). Анкета
> предупреждает: «Чернышова» — МОП первой линии, «Чернышева» — куратор.
> Substring match `contains: "Чернышева"` не должен задеть Чернышову, но
> для уверенности нужен whole-word check на demo.

---

## Section 3 — Воронки продаж

| Anketa item | What diva asked | What UI shows | Gap | Priority |
|---|---|---|---|---|
| 3.1 Главной воронки нет → слушать все звонки кроме кураторов | Filter by manager(не-куратор), не по mainFunnelId | Все агрегаты в `dashboard-gc.ts` фильтруют по `tenantId` + curator-exclusion, **без mainFunnelId filter**. ✅ | match | OK |
| 3.2 Прогревочные не выделены | Не нужно отдельно | UI ничего не выделяет | match | OK |
| 3.3 Нет отдельной воронки upsell/win-back | Не нужно | UI не делит — `callType` через AI-теги | match | OK |
| 3.4 Исключить дубли и тесты | `possibleDuplicate` рендерится в карточке звонка (KvRow). **«Тесты» — признак не уточнён, exclusion в queries отсутствует** | partial — дубли видны, тесты не исключены | **MISSING (P2)** ждём от клиента | P2 |
| 3.5 Контролировать все стадии | Block 7 «Куда движутся клиенты» — все этапы воронки агрегатно | match | OK | OK |

**Section 3 score:** 4 / 5 = **80%** (один пункт ждёт уточнения от клиента,
не наша зона)

**One-liner:** Anketa says «слушать всё кроме кураторов» → UI honors через
`getCuratorManagerIds`, mainFunnelId не используется → **match**.

---

## Section 4 — Продукты и цены / «что считать продажей»

| Anketa item | What diva asked | What UI shows | Gap | Priority |
|---|---|---|---|---|
| 4.1-4.3 Флагманские/трипваеры/бесплатные | Не указано клиентом | UI не может показать без данных | partial (внешний blocker) | wait |
| 4.4 «Продажа» = `Deal.amount > 0 AND status='WON'` | Где-то на UI должно быть видно: счётчик WON-сделок? success rate? | На главной этого нет вообще. В Block 7 показано распределение этапов («Куда движутся клиенты»), но **без явного маркирования "won"-этапов и без `amount > 0` фильтра**. Канон #37 explicit запрещает выручку/AOV/комиссию — это правильно, но «сколько закрытых продаж за период» (count, не money) **должно быть**, как метрика результата работы отдела. | **MISSING (P1)** | P1 |
| Outcome `closed_won` | На уровне звонка | В `CategoryBlock` карточки звонка: `KvRow` с `outcome` (closed_won / closed_lost / scheduled_callback / objection_unresolved / no_offer_made). ✅ | match (per-call) | OK |

**Section 4 score:** 1.5 / 2 (релевантные пункты 4.4 + outcome) = **75%**

**One-liner:** Anketa says «продажа = Deal.amount>0 AND WON» → UI shows outcome
per call, но НЕ показывает count won-сделок за период на главной → **mismatch
(P1, easy fix через filter в Block 7 или добавить отдельную row)**.

---

## Section 5 — Категории звонков (7 типов)

Anketa enums:
1. Продажи (закрытие)
2. Квалификация лида
3. Поддержка ученика
4. Технические вопросы
5. Обратная связь / NPS
6. Допродажи (upsell)
7. ± Возврат ушедших

Master Enrich `callType` enum в каноне Master Enrich card:
`квалификация_лида | продажи_новый | поддержка_ученика | техвопрос | NPS | upsell | win_back | курьер | прочее`

| Anketa | Master Enrich callType | UI rendering | Gap |
|---|---|---|---|
| Продажи (закрытие) | `продажи_новый` | call-card MetaRow `callType` + Manager detail Distribution + Block 3 worstCall badge | match |
| Квалификация лида | `квалификация_лида` | match | match |
| Поддержка ученика | `поддержка_ученика` | match | match |
| Технические вопросы | `техвопрос` | match | match |
| NPS | `NPS` | match | match |
| Upsell | `upsell` | match | match |
| Win-back | `win_back` | match | match |
| (extra) `курьер`, `прочее` | extra | shows | acceptable extras |

**Section 5 score:** 7 / 7 = **100%** ✅. Дополнительно показано 2 extra
enum'а (курьер/прочее) — это OK (real-world fallback).

**One-liner:** Anketa lists 7 categories → UI shows all 7 + 2 fallback
(курьер/прочее) → **match**.

> Where it shows on UI:
> - Карточка звонка: MetaRow `🎯 callType` + KvRow `callType` в `CategoryBlock`
> - Карточка МОПа: «Распределение по callType» (DistributionBlock)
> - Главная Block 3: badge на `worstCall.callType`

---

## Section 6 — Скрипт + 6 критических ошибок

Anketa enum (6 errors):
1. Перебивать клиента — `interrupted_client`
2. Отсутствие выявления потребностей — `no_needs_discovery`
3. Отсутствие отработки возражений — `no_objection_handling`
4. Отсутствие попытки сделки — `no_close_attempt`
5. Не назначен следующий шаг — `no_next_step`
6. Монологная презентация не под боль — `monolog_not_pain_tied`

| # | Anketa error | Enum | UI rendering | Gap |
|---|---|---|---|---|
| 1 | Перебивание | `interrupted_client` | call-card `CRITICAL_ERROR_LABELS` + main `Block 4b` agg + `Manager detail` topCriticalErrors | match |
| 2 | Нет потребностей | `no_needs_discovery` (+ alias `no_pain_discovery`) | match | match |
| 3 | Нет возражений | `no_objection_handling` | match | match |
| 4 | Нет попытки сделки | `no_close_attempt` | match | match |
| 5 | Нет след. шага | `no_next_step` | match | match |
| 6 | Монолог не под боль | `monolog_not_pain_tied` | match | match |
| (extra) | `no_compliments` | enabled in labels | partial extra (не в анкете, но согласован со скриптом) | acceptable |

**Section 6 score:** 6 / 6 = **100%** ✅

**Where shown:**
- **Per call (`call-card.tsx`):** `CriticalErrorsBlock` — каждая ошибка с `{error, evidence, severity}` в красной карточке. `ScriptBlock` — 11 этапов скрипта c `score 0/0.5/1`, `phraseCompliance` 12 техник.
- **Per manager (`manager-detail.tsx`):** «Топ-3 critical errors» в `PatternsBlock`.
- **Department (`dashboard-rop.tsx`):** `Block 4b` «Системные паттерны отдела — Топ-5 ошибок» (агрегат + %).

**One-liner:** Anketa lists 6 errors → UI shows all 6 with evidence on 3 levels (call/manager/dept) → **match**, лучшее покрытие из всех секций.

---

## Section 8 — Дубли и чистота

| Anketa item | What diva asked | What UI shows | Gap | Priority |
|---|---|---|---|---|
| 8.1 Дубли = разные email/phone у одного клиента | Признак | `possibleDuplicate` boolean per call | partial (per-call, не cross-call) | OK |
| 8.2 Истинная сделка = клиент × продукт | Уникальность | UI агрегирует по `gcContactId` (уникальный клиент в карточке клиента / список клиентов МОПа); product dimension отсутствует — нет product-таблицы | partial | P3 |
| 8.3 Процесс дедупликации | Не уточнено клиентом | n/a | wait | wait |
| 8.4 Авто-детект ON, авто-merge OFF, ручной approve | Раздел «Кандидаты на слияние» — anketa explicit ACTION | **НЕТ раздела «Кандидаты на слияние»** в UI. Есть `possibleDuplicate` flag в карточке звонка (read-only KvRow) и legacy `DuplicateBadge` для amoCRM, но **dedicated GC-page для approve workflow отсутствует**. | **MISSING (P2)** | P2 |

**Section 8 score:** 1 / 3 (релевантные пункты 8.1, 8.2, 8.4) = **33%**

**One-liner:** Anketa says «включить раздел Кандидаты на слияние с ручным approve» → UI shows только passive flag `possibleDuplicate` в карточке звонка, нет approve workflow → **mismatch (P2)**. Может быть отложено за премьеру если client × product не критичен в день #1.

---

## Section 9 — Боли и ожидания РОПа

Anketa explicit requirements:

| # | Боль | What UI shows | Gap |
|---|---|---|---|
| 9.1 | Сколько **наборов** per МОП | Block 1 column «Наборы» (`r.dialed`) + Manager detail Counter «Наборы» | match |
| 9.2 | Сколько **НДЗ** | Block 1 column «НДЗ» (`callOutcome IN no_answer/hung_up`) + Manager detail Counter «НДЗ» с % | match |
| 9.3 | Сколько **автоответчиков** | Block 1 column «АО» (`callOutcome IN voicemail/ivr`) + Manager detail Counter «Автоответчики» с % | match |
| 9.4 | Сколько **реально состоявшихся разговоров** | Block 1 column «Дозвоны» (`callOutcome=real_conversation`) + Manager detail Counter «Дозвоны» с % | match |
| 9.5 | **Оценка МОП** индивидуально | Block 2 «Оценка скрипта» с цветовой индикацией top/bottom 30% + Manager detail `scriptScorePctAvg` + phraseCompliance 12 техник | match |
| 9.6 | **Оценка отдела** суммарно | Block 4b «Системные паттерны отдела» (top weakSpots + top criticalErrors). **Один gap — нет общего AVG dept score (median scriptScore по отделу), как требует канон #37 Block 5 «Оценка отдела»**. Есть `deptAvg` для phraseCompliance в Manager detail, но **на главной нет single-number summary** «средний score отдела за период» | partial (P2) |
| 9.7 | Разбивки по менеджерам | Block 1 — все МОПы построчно с drill-down по клику; Block 2 — bar-list ranking; Block 3 — worst calls per manager | match |

**Алерты НЕ нужны** — verification:
- ❌ Никаких bell-icons / alert-spam на главной странице или в карточках
- ✅ В UI используются ⚠️ и 🚨 emoji **только** для:
  - тех. сбой (`TECHNICAL_ISSUE` callType — это callOutcome диагностический, не alert)
  - pipeline gap «проверить тех. отдел» (`pipelineGap.pct > 0.1`) — health-сигнал, не business-alert
  - severity badges на critical errors — context, не push-нотификация
- ✅ Нет toast-нотификаций, нет «нажми чтобы решить», нет inbox-style alert ленты

**Юзеры РОП + собственник, не МОПы** — visible:
- UI не имеет МОПовского self-view (нет `/my-stats` для самого МОПа)
- Все агрегаты построены под РОПа: cross-manager сравнения, drill-down, агрегаты отдела

**Section 9 score:** 6.5 / 7 = **93%** ✅

**One-liner:** Anketa lists 7 пэйнов РОПа + «no alerts» → UI shows 6.5 из 7 (отдельный AVG dept score отсутствует) и не имеет alert-spam → **match с минорным gap**.

---

## Compliance Summary

| Section | Coverage | Status |
|---|---|---|
| 1. Телефония | n/a | skip (technical) |
| 2. Менеджеры | 75% | gap: первая линия split |
| 3. Воронки | 80% | wait: «тесты» признак |
| 4. Продукты + что считать продажей | 75% | gap: count won-сделок на главной |
| 5. Категории звонков | **100%** | full match ✅ |
| 6. Критические ошибки | **100%** | full match ✅ (best section) |
| 7. CRM-поля | n/a | skip (closed by team) |
| 8. Дубли | 33% | gap: «Кандидаты на слияние» page |
| 9. Боли РОПа | 93% | minor: dept AVG score |

**Overall compliance (только релевантные секции 2,3,4,5,6,8,9):**
(0.75 + 0.80 + 0.75 + 1.0 + 1.0 + 0.33 + 0.93) / 7 = **79.4%**

Без секции 8 (за-премьерная): **86.7%**.

---

## Top-5 Missing Items P1 (must-add before premiere)

1. **Split «МОПы / Первая линия» на /managers и/или главной** (Section 2) —
   anketa explicit: разные скрипты, разные люди (Жихарев + Чернышова).
   Сейчас флаг `isFirstLine` хранится в БД и виден только в карточке звонка.
   Фикс: добавить tab или filter chip на `/managers` или 2-вкладочное представление
   на главной (`canon-37` line 93: «Diva → Две вкладки: МОПы + Первая линия»).
   _Effort: 2-4 hours._

2. **Count won-сделок за период на главной** (Section 4) — anketa: «продажа =
   Deal.amount>0 AND status=WON». Сейчас на главной видно «куда движутся клиенты»
   распределённо по этапам (Block 7), но нет single counter «закрыто X сделок за
   период». Не выручка, **count!** — это разрешено каноном.
   Фикс: одна row под Block 1 «За период: дозвонов N → офферов M → закрыто K» (=
   conversion дозвон→won, без денег).
   _Effort: 1-2 hours._

3. **Уточнить «Чернышова» (МОП) vs «Чернышева» (куратор)** (Section 2 ⚠ висит)
   — substring `contains: "Чернышева"` в `CURATOR_LASTNAMES` теоретически может
   matchнуть и «Чернышову» если manager.name содержит обе. Нужен whole-word match
   или прямая проверка на demo с тестовым звонком обоих.
   _Effort: 30 min проверки + 30 min фикс если нужен._

4. **AVG script score отдела на главной** (Section 9.6) — single number
   «средний скрипт-скор отдела N% за период» под Block 1. Сейчас есть
   per-manager bars (Block 2), но нет department roll-up.
   _Effort: 30 min._

5. **Phrase «Без аудио» — переименовать column** (uxhint) — column в Block 1
   назван «Без аудио», но это не отсутствие аудио а pipeline gap. Если у клиента
   значимый процент `pipelineGap`, РОП может ошибочно считать что МОП не записывает.
   Назвать «Не дотянулось» или «pipeline gap» с tooltip. (Минорный, но visible на
   премьере если % > 0.)
   _Effort: 5 min._

---

## Extra Items (НЕ из анкеты — verify «лишнего нет»)

User claim: «лишнего НЕТ». Проверка:

### Отсутствует — money/BI (правильно по канону #37)

✅ Нет revenue / AOV / выручка / комиссия / ROI / LTV — verified grep,
только legacy `RevenuePotential` import в `page.tsx` для amoCRM веткы (не
рендерится в GcDashboardPage). Diva-route чистый.

### Что есть сверх явных пунктов анкеты, но обосновано каноном #37

| Item | Anketa? | Justified by? | Decision |
|---|---|---|---|
| Block 4 «Упущенные техники» (12 phrase techniques) | Не явно в анкете | Канон Master Enrich + diva script (11 этапов из `2026-04-22-diva-sales-script.md`) | KEEP — operationalizes п.6 (script eval) |
| Block 4b «Системные паттерны отдела» (weakSpot agg) | Не явно в анкете | п.9.6 «оценка отдела» агрегатно | KEEP — implements 9.6 |
| Block 5 «Обещания requiring follow-up» (extractedCommitments) | Не явно в анкете | Master Enrich Блок 7 — наша killer feature, не из анкеты | KEEP с предупреждением — это differentiator vs Roistat, не диваспецифично. Если клиент скажет «лишнее» — скрыть в advanced tab. |
| Block 6 «Когда лучше звонить» heatmap 7×24 | Не явно в анкете | Канон #37 advanced tab | **REVIEW** — канон предписывает спрятать в advanced. Сейчас на главной. Может быть скрыто за «Показать advanced» toggle. |
| Block 7 «Куда движутся клиенты» (deal stages) | Не явно в анкете, но п.3.5 «контролировать все стадии» | OK | KEEP |
| Карточка клиента: stageJourney visual | Не явно в анкете | Полезно для drill-down | KEEP — UX nicety, не BI |
| `psychTriggers`, `clientReaction`, `managerStyle`, `clientEmotionPeaks`, `keyClientPhrases` (PsychBlock в карточке звонка) | Не в анкете | Master Enrich Блок 4 — наш differentiator | KEEP — это «душа» SalesGuru |
| `purchaseProbability` % | Не в анкете | Master Enrich | KEEP — predictive value |

### Реальные «лишние» (требуют решения)

1. **Block 6 «Когда лучше звонить» heatmap на главной** — канон #37 explicit:
   advanced tab. Можно ли убрать с главной до премьеры? Решение: оставить (это
   полезный insight 8:00/21:00 = 33% pickup), но **переместить в advanced tab
   после премьеры**. На день премьеры — KEEP (не сильно перегружает).

2. **Карточка звонка `TagsBlock`** — если `enrichedTags` array пуст, блок не
   рендерится; если не пуст — это badges без явной анкета-обоснованной структуры.
   **Verify:** на эталонных звонках Эльнура/Светлана пустой ли он? Если непустой —
   имеет ли смысл? Вопрос на проверку.

3. **Карточка звонка `purchaseProbability` MetaRow** — анкета не просила. Канон
   Master Enrich определяет. Решение: KEEP с tooltip (объяснение
   «вероятность на основе AI-анализа разговора, не commitment от клиента»).

---

## Verdict

**Score: 79.4% overall (86.7% без неблокирующего раздела 8).**

Сильнейшие секции — 5 (категории, 100%), 6 (критические ошибки, 100%), 9
(боли РОПа, 93%). Слабейшая — 8 (дубли, 33%) — но это допремьерно
acceptable, у клиента нет explicit «срочно».

**P1-блокеры премьеры (~5 часов):**
1. First Line vs МОПы split (Section 2)
2. Count won-сделок на главной (Section 4)
3. Verify «Чернышова» vs «Чернышева» curator filter
4. AVG dept script score (Section 9.6)
5. Rename «Без аудио» → «Не дотянулось» с tooltip

**Расхождений «лишнего»** — нет фактических BI-страниц / выручки / AOV. Heatmap
Block 6 формально «advanced» по канону #37, но не блокирует премьеру.

**Risks при имплементации P1:**
- First Line split: убедиться что `isCurator` AND `isFirstLine` не пересекаются
  (Чернышева куратор, Чернышова первая линия — разные люди в системе?)
- Count won-сделок: source = `Deal.status` field. Verify что diva-tenant
  заполняет это поле (через GC HTML parser?). Если нет — fallback на `outcome=closed_won`.
- Rename column: проверить переводы во всех связанных tooltip / документах.
