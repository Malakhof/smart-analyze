# 🔄 CRON RESUME (29.04 вечер) — addendum к v3 handoff'у

**Контекст:** 28 апреля написан большой handoff `2026-04-28-cron-realtime-pipeline-handoff.md` (786 строк, 11 stages, 5 safety canons). 29 апреля разобрался с PBX↔GC связкой → миграция применена, парсер написан, backfill проведён. Этот документ **дополняет** v3 handoff свежими данными.

**Если ты — новая сессия cron-pipeline**, читай в порядке:
1. Этот файл (резюме что изменилось 29.04)
2. v3 handoff (полная спецификация 11 stages)
3. Sample-3 / sample-4 эталоны (для понимания что Master Enrich делает)

---

## ✅ Что доделано 29.04 (уже в проде)

### 1. Migration `manual-gc-call-link.sql` — применена

Файл: `prisma/migrations/manual-gc-call-link.sql`

Добавлены колонки в БД:

| Где | Колонка | Тип | Назначение |
|---|---|---|---|
| `CallRecord` | `gcCallId` | TEXT | ID карточки звонка в GC (например `208612058`) |
| `CallRecord` | `talkDuration` | INTEGER | Секунды РАЗГОВОРА (≠ duration который запись) |
| `CallRecord` | `gcOutcomeLabel` | TEXT | «Состоялся» / «Не состоялся» / «Аудиофайл не содержащий разговора» |
| `CallRecord` | `gcEndCause` | TEXT | «Нормальное завершение» / «Вызов отменён» / etc. |
| `Manager` | `gcUserId` | TEXT | GC user_id менеджера для cross-check атрибуции |

Индексы созданы на `gcCallId` и `talkDuration`.

`schema.prisma` обновлён + `prisma generate` сделан. Prisma Client знает новые поля.

**НЕ повторять migration** — `IF NOT EXISTS` стоит, но лишний run не нужен.

### 2. Парсер `src/lib/crm/getcourse/parsers/call-detail.ts` — написан и протестирован

Извлекает из HTML `/user/control/contact/update/id/{gcCallId}`:
- `pbxUuid` — match key с PBX
- `audioUrl` — для плеера
- `recordDuration`, `talkDuration`
- `endCause`
- `managerGcUserId` + `managerName`

Проверено на реальном HTML user'а — работает.

### 3. Скрипт `scripts/sync-gc-call-details.ts` — написан и отработал

Backfill 857 PBX-карточек → 807 сматчены (99.4%):
- gcCallId заполнен
- audioUrl заполнен (плеер готов)
- talkDuration заполнен
- gcCallCardUrl построен правильно (`/user/control/contact/update/id/{gcCallId}`)

5 PBX-строк не сматчены — у них в GC нет парной карточки (видимо аудио удалено).

**В cron-pipeline этот скрипт превратить в Stage 3.5b** (после Stage 3.5 phone resolve, до upsert). Новый звонок 1 раз вызывает GC API → получает gcCallId/audioUrl/talkDuration. Cron делает это **не на 857 строк, а на N свежих** (типично 5-20 за 15-минутное окно).

### 4. SKILL.md v9.3 + sample-3, sample-4 эталоны

Skill v9.3 знает что URL строится из `gcCallId` (читается из БД). Эталоны обновлены с правильным путём `/user/control/contact/update/id/{gcCallId}`.

### 5. PBX↔GC связка через `pbxUuid` подтверждена доказательно

Пример (доказан user'ом 29.04):

```
наш CallRecord:                      GC карточка 208612058:
  pbxUuid = 99846715-a581-4d85-...   "Уникальный идентификатор звонка:
                                       99846715-a581-4d85-..."
                  ✅ MATCH
```

**Это единственный надёжный ключ** — phone+date неоднозначны (5+ звонков на клиента в день), durations различаются 2x (PBX = вся запись, GC talkDuration = только разговор).

---

## 🔴 Что НЕ доделано (критично для cron'а)

### A. Stage 3.5b в master-pipeline orchestrator

Сейчас `sync-gc-call-details.ts` — **batch backfill скрипт**, не интегрирован в cron flow.

Нужно:
1. Превратить в функцию `linkSinglePbxCallToGc(pbxRow): Promise<{gcCallId, audioUrl, talkDuration, ...}>`
2. Вызвать из cron-master-pipeline сразу после Stage 3.5 (phone resolve)
3. Если match не найден — **не блокировать**, пометить `enrichedTags += ["pending_gc_link"]`, повторная попытка через 1 час
4. Skill v9.3 уже корректно обрабатывает случай `gcCallId IS NULL` — не падает, ставит URL=NULL

### B. Sync-pipeline atomicity (всплыло в session vечером)

При сегодняшнем rescore 380 v1→v9.3 обнаружилось: **180 v9.3 карточек написались БЕЗ cleanedTranscript** (но с psychTriggers/scriptDetails/ropInsight/phraseCompliance — всё остальное на месте).

Причина: skill UPDATE неатомарный — записывает поля по одному, если в середине что-то фейлится, частичные записи остаются. Релиз lock'а в `enrichmentStatus=NULL` оставляет частично-обогащённую карточку как «недорезанную».

Нужно в skill v9.4:
1. **Один UPDATE с ВСЕМИ полями в одной транзакции** (вместо последовательных UPDATE)
2. **Assert на cleanedTranscript** для NORMAL real_conversation ≥ 60s ДО UPDATE
3. Если assert упал — НЕ писать ничего, оставить `enrichmentStatus='in_progress'` чтобы next session подхватила

Сейчас в БД:
- 588 real_conversation enriched
- 407 полностью эталонные (69%)
- 181 без `cleanedTranscript` (могут быть rescore'нуты после фикса skill)
- 74 без `phraseCompliance` (старые v9.0/9.1/9.2 которые user не хочет ещё раз rescore'ить из-за лимитов)

### C. Daily Master Enrich автозапуск

В v3 handoff'е написано: «вечерний batch обогащения через `/loop /enrich-calls`». Сейчас это **ручной запуск** (user открывает 5 окон Claude Code).

Решение архитектурно (после cron-pipeline стартует):
- **Вариант А (cheap)**: cron-job который каждый день в 23:00 берёт все за день необогащённые → пометит `needs_rerun_v9` → ждёт 5 окон утром
- **Вариант B (production)**: переключить enrich на Claude API (~$0.05/звонок × 100/день/tenant = $5/день/tenant). Skill адаптируется, cron оркестрирует
- **Вариант C (гибрид)**: edge-case через Sonnet API ($0.01/карточка), real_conversation через подписку

User склоняется к B или C — финал решит после стабилизации cron.

### D. 45 pipeline_gap — новая категория

Сегодня обнаружено: **45 звонков 24-27 апреля имеют `transcript=NULL` AND `audioUrl=NULL`**. Звонок состоялся (есть duration), но pipeline не подсосал аудио из onPBX → Whisper не запустился → транскрипта нет.

В cron'е должна быть отдельная stage:
- Если PBX даёт UUID но audio нет 24h → пометить `enrichmentStatus='pipeline_gap'` + добавить в дашборд РОПа отдельным счётчиком «N% без аудио — проверить тех. отдел»
- Это **индикатор инфраструктуры** (SIP/гарнитура/onPBX sync), не качества МОПа
- В UI карточке МОП — отдельная метрика рядом с «наборы / НДЗ / автоответчики»

---

## 🆕 Тип звонка G — PIPELINE_GAP (добавить к типам A-F из v3 handoff'а)

В v3 handoff'е описаны типы A-F (NO_SPEECH, VOICEMAIL, HUNG_UP, TECHNICAL, SHORT_RESCHEDULE, NORMAL). Добавляется **седьмой**:

| Тип | Признак | hadRealConversation | callOutcome | UI |
|---|---|---|---|---|
| **G PIPELINE_GAP** | `transcript IS NULL` AND `audioUrl IS NULL` | NULL | NULL | НЕ AI-карточка — счётчик в карточке МОПа |

В cron orchestrator: если N часов после звонка audioUrl всё ещё NULL → пометить `enrichmentStatus='pipeline_gap'` + retry audio sync в отдельной cron-задаче (пытаемся раз в 6 часов в течение 24 часов).

---

## 📊 Состояние БД на 29.04 вечер (после backfill + rescore)

### Diva (cmo4qkb1000000jo432rh0l3u) 24-27 апреля

```
857 total
├── 812 enriched
│   ├── 224 edge_case (voicemail/hung_up/no_speech/etc) — null-поля это НОРМА
│   ├── 380 v9.3 real_conversation — свежие, правильные URL (но 180 без cleanedTranscript)
│   ├── 218 v9 (старые) real_conversation — у 74 без phraseCompliance
│   ├── 7 v9-loop real_conversation — мои edge-case в этой сессии
│   └── 12 v9-loop edge_case
└── 45 NULL pipeline_gap (transcript=NULL+audioUrl=NULL)
```

```
Field completeness среди 588 real_conversation:
├── gcCallId: 584/588 (99%)  ✅ от backfill
├── audioUrl:  584/588 (99%)  ✅ от backfill  
├── talkDuration: 584/588 (99%) ✅ от backfill
├── gcCallCardUrl правильный: 584/588 (99%) ✅
├── cleanedTranscript: 407/588 (69%) ⚠️ skill v9.3 partial-write bug
├── phraseCompliance: 514/588 (87%) ⚠️ старые v9 не получили
└── psychTriggers + scriptDetails + ropInsight + commitments: 100% ✅
```

### Пользовательский ввод про лимиты подписки (29.04)

User не хочет третий rescore round чтобы не жечь лимиты x5 параллельных Claude Pro сессий. Решено: оставить как есть, UI рендерит без двух секций для тех 181+74. После фикса skill v9.4 atomicity — один rescore round добьёт остатки.

---

## 🔧 Артефакты этой сессии

| Файл | Состояние |
|---|---|
| `prisma/migrations/manual-gc-call-link.sql` | ✅ применён в БД |
| `prisma/schema.prisma` | ✅ обновлён + Prisma Client сгенерирован |
| `src/lib/crm/getcourse/parsers/call-detail.ts` | ✅ написан, протестирован |
| `scripts/sync-gc-call-details.ts` | ✅ написан, отработал backfill |
| `~/.claude/skills/enrich-calls/SKILL.md` | ✅ v9.3 (правильный URL builder) |
| `docs/canons/master-enrich-samples/sample-3-proper-cleanup-lara.md` | ✅ обновлён URL |
| `docs/canons/master-enrich-samples/sample-4-strong-closer-tech-block.md` | ✅ обновлён URL + примечание про gcCallId vs gcContactId |

---

## 📋 Что cron-сессии делать

**Шаг 0:** прочитай **этот документ** (резюме изменений 29.04) **+ v3 handoff** (полная спецификация cron flow). Этот документ — **delta**, v3 — **base**.

**Шаг 1:** проверь миграцию в БД (должна быть применена):
```bash
ssh -i ~/.ssh/timeweb root@80.76.60.130 \
  "docker exec smart-analyze-db psql -U smartanalyze -d smartanalyze -c \
   \"\\\\d \\\"CallRecord\\\"\"" | grep -E "gcCallId|talkDuration|gcOutcomeLabel|gcEndCause"
```

Должно выдать 4 строки. Если нет — применить `manual-gc-call-link.sql` через docker cp + psql -f.

**Шаг 2:** изучи существующие артефакты — НЕ переписывать, использовать:
- `scripts/sync-gc-call-details.ts` (как-есть для backfill, в cron'е — превратить в функцию)
- `src/lib/crm/getcourse/parsers/call-detail.ts` (готовый парсер)
- `scripts/cron-master-pipeline.skeleton.ts` (skeleton от 28.04, можно расширять)
- `scripts/cron-stage35-link-fresh-calls.ts` (Stage 3.5 phone resolve)

**Шаг 3:** реализуй 11 stages из v3 handoff'а **+** добавь **Stage 3.5b** (PBX↔GC linking) сразу после Stage 3.5 (phone resolve).

**Шаг 4:** Stage 8 (upsert) использует gcCallId если есть, иначе помечает `pending_gc_link` тег. URL строится:
```typescript
gcCallCardUrl = gcCallId
  ? `https://${subdomain}/user/control/contact/update/id/${gcCallId}`
  : null
gcDeepLinkType = gcCallId ? 'call_card' : null
```

**Шаг 5:** добавить retry-stage для PIPELINE_GAP (тип G) — раз в 6 часов попытка получить audio из onPBX для UUID без audioUrl. После 24 часов если всё ещё NULL → пометить `enrichmentStatus='pipeline_gap'`.

**Шаг 6:** **НЕ ТРОГАТЬ** существующее обогащение. Cron только sync + raw transcript + scripted blocks (DeepSeek). Master Enrich (Opus) запускается отдельно — либо `/loop /enrich-calls` ручной (текущая модель), либо через API (после стабилизации, отдельная задача).

---

## 🔗 Связь с UI handoff'ом

После того как cron заработал — UI готовится **на этих же материалах**. У нас есть:
1. **Этот документ** (что enrichment даёт на выходе + 7 типов звонков)
2. **`docs/handoff/2026-04-29-enrich-data-layer-for-ui-prompt.md`** (190 строк — schema, типы, открытые вопросы под UI)
3. **v3 cron handoff** (cross-cut «откуда данные приходят в UI»)
4. **`2026-04-28-ui-rebuild-handoff.md`** (544 строки — план переделки UI)

UI-сессия использует **те же эталоны (sample-3, sample-4)** + **тот же набор типов звонков** + добавляет дизайн-перспективу. Большая часть работы по знаниям уже сделана — **UI handoff = композиция этих 4 документов плюс компонентная архитектура**.

User'у не придётся переписывать «что такое enrichment» в UI промпте — только сослаться на уже готовые источники.
