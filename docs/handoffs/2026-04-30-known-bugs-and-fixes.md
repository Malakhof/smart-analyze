# 🐛 Known Bugs & Fixes (фиксация по состоянию 30.04.2026 вечер)

Сборная памятка после длинного дня. Каждый баг с корнем + решением + где лечится.

---

## #1 — v9.3 over-compressed cleanedTranscript (143 шт)

**Симптом:** UI badge «Whisper не нашёл речи» на звонках где transcript >100 chars и `callOutcome=real_conversation`. Пример: звонок Светланы `e74a878f` (transcript 771 chars → cleanedTranscript 43 chars = 5.6%).

**Корень:** Skill v9.3 (29.04 вечер) переписал секцию «Cleanup transcript» — Opus интерпретировал «жёсткий cleanup» как «суммаризируй». Текстовый assert `compression >= 0.85` Opus игнорирует.

**Масштаб:** 143 v9.3 ниже канона + 55 v9.5 + 34 v9.5 на 28.04 = **~232 кривых в БД сейчас**.

**Лечится:**
- v9.6 опция **B** (`scripts/validate-enrich-sql.ts`) — runtime-блок: regex проверяет `compression >= 0.85` ДО `psql -f`. Если меньше — карточка возвращается в pool.
- После apply v9.6 → SQL UPDATE на расширенный `needs_rerun_v9` (включая v9.3 + v9.5 ниже канона).
- /loop /enrich-calls --limit=5 в одном свежем окне.

---

## #2 — UI keyClientPhrases рендерится как JSON-строка

**Симптом:** В карточке `41cb1f52` (Анастасия) блок «Ключевые цитаты клиента»:
```
«{"note":"buying signal","time":"00:30","quote":"Да, так вы..."}»
```

Должно быть (parsing item):
> 💬 **00:30** «Да, так вы [пришлёте мне] ссылочку на оплату на почту?»
> _buying signal — спрашивает про ссылку первая_

**Корень:** UI-компонент делает `{JSON.stringify(item)}` или `{item}` вместо `{item.quote}` + `{item.time}` + `{item.note}`. Чисто frontend.

**Лечится:** UI-сессия. 5 строк в компоненте `KeyPhrasesBlock` или подобном:
```tsx
{phrases.map(p => (
  <div>
    <span>{p.time}</span>
    «{p.quote}»
    {p.note && <em>{p.note}</em>}
  </div>
))}
```

**Важно:** Этот баг НЕ зависит от версии skill — будет виден на ВСЕХ карточках где `keyClientPhrases` jsonb (включая v9 «эталоны» типа 0e3bd264).

---

## #3 — psychTriggers.missed без quote_client / should_have_said

**Симптом:** В карточке `41cb1f52` блок «Упущенные триггеры»:
```
00:44  —  —
00:55  —  —
00:32  —  —
00:47  —  —
```
Только timecode, без цитаты клиента и без рекомендации «что должна была сказать».

**Корень:** Skill v9.5 не даёт runtime-assert на shape `psychTriggers.missed[*]`. Opus экономит на полях когда устаёт в batch'е.

**Эталон (sample-4 Эльнура):**
```yaml
missed:
  - time: "04:29"
    quote_client: "Послезавтра 36 лет"
    should_have_said: "Эльнура, послезавтра ваш день! Зафиксирую ДР-скидку..."
```

**Масштаб:** 89 v9.5 карточек 28.04 (все sегодняшние) — у длинных звонков `missed_shape = partial`.

**Лечится:** v9.6 опция **A** (self-review в промпте) + опция **B** (validator проверяет `quote_client && should_have_said`).

---

## #4 — phraseCompliance «missed —» без evidence

**Симптом:** В карточке `41cb1f52`:
```
эмоциональный подхват  missed  —
юмор забота            missed  —
```
Половина 12 техник — пустые dash. Эталон требует поле `note` или `missed`-объяснение «почему не применил».

**Корень:** Тот же что #3 — Opus экономит на полях.

**Лечится:** v9.6 опция **A** (skill требует evidence/missed для каждой из 12).

---

## #5 — DeepSeek scriptScore дублирует Opus scriptDetails (архитектурный)

**Pipeline сейчас:**
```
Whisper → DeepSeek apply → repair → detect-callType → score-diva (scriptScore 0-22)
                                                      ↓
                                                    Opus Master Enrich
                                                      → scriptDetails (per-stage с комментариями)
                                                      → cleanedTranscript, psychTriggers, ropInsight, ...
```

**Проблема:** `scriptScore` от DeepSeek и `scriptDetails` от Opus покрывают одно и то же (11 этапов diva). Opus всё равно генерирует scriptDetails с собственной оценкой → DeepSeek scriptScore становится неактуальным до момента Master Enrich.

**Что РЕАЛЬНО полезно от DeepSeek:**
1. ✅ **repair-transcripts** — replace по glossary/hotwords (Whisper не знает «Дива», «гипотиреоз», «Ирина Довгалева»). Без DeepSeek Opus читает сырой Whisper с галлюцинациями.
2. ✅ **detect-call-type** — фильтр для Master Enrich: `callOutcome=voicemail/no_speech` → Opus не запускается → экономия лимитов.

**Что избыточно:**
- ❌ scriptScore (полностью покрывается Opus scriptDetails)
- ❌ callType detail (Opus делает то же)

**Решение (опционально, после демо):**
- Оставить DeepSeek **только для repair + filter** (2 stages, быстро/дёшево)
- Убрать score-diva-script-compliance из pipeline → -20 минут на cycle, exit-code конфликт уходит
- Opus в Master Enrich сам считает scriptScore + scriptDetails

**Причина не делать сейчас:** UI уже завязан на `scriptScore` поле в БД для звонков где Opus enrich ещё не было. Удалить шаг — поломать промежуточное отображение «Script score: 22%» которое РОП видит до Master Enrich.

**Альтернатива:** оставить DeepSeek scriptScore как **fallback-значение** до прихода Opus. Когда Opus enrich приходит — `scriptScore` перезаписывается из `scriptDetails`. Это уже работает. Не трогаем.

---

## #6 — exit-code конфликт persist-pipeline-results

**Симптом:** Сегодняшний E2E test на 30.04 показал `repair=exit2`, `score=exit1`, но 49/49 carteчек реально записались в БД.

**Корень:** 3-часовой timeout в persist-pipeline-results срабатывает мягко — записи коммитятся, но wrapper exit ≠ 0.

**Влияние:** orchestrator считает stage failed → может re-trigger в следующем cron cycle → дублирование работы.

**Лечится:** В `scripts/persist-pipeline-results.ts` сделать exit code = 0 если written_count == expected_count, даже если timeout. Backlog после crontab install.

---

## Hierarchy of fixes (порядок применения)

```
1. v9.6 handoff (E+D+A+B) применить           50 мин   → закрывает #1, #3, #4
2. SQL UPDATE расширенный needs_rerun_v9      5 сек    → ставит ~335 в очередь
3. /loop --limit=5 в одном окне (после reset) часы     → 95% эталон с первой попытки
4. UI fix #2 (keyClientPhrases parsing)       5 мин    → косметика, отдельный коммит UI-сессии
5. DeepSeek scriptScore decision              после демо → не блокер
6. exit-code fix persist-pipeline             после crontab install → не блокер
```

---

## Что считать «эталоном» в БД сейчас (до v9.6 рескора)

**Лучшие кандидаты (v9, 24-27.04):**
- `0e3bd264-bc5d-4de0-b9ff-4bc71851f7aa` — Лариса 30 мин, 27.04
- `6167b969-9f09-4ef8-a658-496bc819ccd3` — 32 мин, 24.04
- `9be414e2-57e6-4bbb-949c-6879e067f9a7` — 29 мин, 27.04

**Все имеют (по SQL-метрикам):**
- compression >= 85% ✅
- psychTriggers.missed full shape (quote_client + should_have_said) ✅
- 12 техник phraseCompliance ✅
- extractedCommitments ✅

**НО все они страдают от UI-бага #2** (keyClientPhrases как JSON) — это видно одинаково на всех карточках, не зависит от skill версии.

**Истинный эталон существует только в markdown:** `docs/canons/master-enrich-samples/sample-3-proper-cleanup-lara.md` и `sample-4-strong-closer-tech-block.md` — это reference, на которые равняемся.

---

**TL;DR для будущей сессии:**
1. Применить v9.6 handoff (`docs/handoffs/2026-04-30-skill-v96-quality-uplift-combo.md`)
2. UPDATE расширенный → 335 в needs_rerun_v9
3. Один /loop в одном окне после reset
4. UI-сессия в отдельной ветке: fix #2 keyClientPhrases parsing
5. DeepSeek + exit-code — после крон install и демо
