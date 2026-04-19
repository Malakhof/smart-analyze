# План к клиентскому демо (20.04.2026)

> Зафиксирован: 2026-04-19 21:30
> Цель: к утру 20.04 на проде https://sa.qupai.ru работают 3 клиента с полной аналитикой

---

## ЦЕЛЕВЫЕ ОБЪЁМЫ ОБРАБОТКИ (что планируем покрыть)

### Reklama (683 deals total / 297 за 90 дней)
- **Звонки**: ВСЕ 86 за 90 дней с фильтром 3-20 мин
- **Транскрипты**: 74/86 уже в БД (87% покрытие)
- **AI-анализы**: ВСЕ 66 content-rich сделок (с реальной перепиской ИЛИ транскриптами)
- **Текущий статус**: 55/66 проанализировано → доберём до 66

### Vastu (15,584 deals total / 10,985 за 90 дней)
- **Звонки**: ВСЕ 710 за 90 дней с фильтром 3-20 мин
- **Транскрипты**: 44 в БД сейчас → ожидаем 200-400 к утру (Whisper grinds vastu_extra 1000 calls)
- **AI-анализы**: ВСЕ 110+ content-rich сделок (растёт по мере транскрипции)
- **Текущий статус**: 50/110 → доберём; ещё +100-200 после новых транскриптов

### Diva (65,092 deals total)
- **Звонки**: после ffprobe filter ожидаем 500-1000 содержательных
- **Транскрипты**: 8 за 90 дней сейчас (sync на DEALS step)
- **AI-анализы**: 0 → запустим после RESPONSES (сегодня 22-23:00)
- **Целевой объём**: 100-300 проанализированных сделок (после messages подтянутся)

**ИТОГО к утру:** ~300-500 проанализированных сделок, ~700-1000 транскриптов, ~25-30 паттернов.

**Бюджет:** $5-7 GPU + $2-4 DeepSeek = **$7-11**.

---

## ПРОЦЕССЫ В РАБОТЕ (запущены, идут сами)

| # | Процесс | Где | Статус |
|---|---|---|---|
| 1 | Whisper 1st GPU | RunPod 216.249.100.66 | 522/3475, ETA ~14h, $3 |
| 2 | Whisper 2nd GPU (vastu_extra) | RunPod 194.26.196.156 | 99/1000, ETA ~3h, $0.7 |
| 3 | GC sync diva (DEALS+CONTACTS+RESPONSES+BOT) | gc-sync-diva-2 container | DEALS step ~70%, ETA RESPONSES ~22-23:00 |
| 4 | DeepSeek pipeline ALL (limit=999) | deepseek-all container, PID 790571 | Started ~21:30, ETA ~30 мин |
| 5 | auto-apply transcripts | Timeweb cron-like | каждые 5 мин подтягивает |

---

## ЧЕКЛИСТ К ДЕМО (что должно работать в браузере)

### Главная страница (/)
- [x] KeyMetrics (4 плитки)
- [x] DealStatSnapshot widget (только diva, 277.7M₽)
- [x] FunnelChart с прогрессивной конверсией + селектор
- [x] ConversionChart (динамика по дням)
- [x] ManagerRatingTable (с цветовыми статусами)
- [x] AiInsights (паттерны кликабельные)
- [x] DuplicateBadge (бэйдж дублей)
- [x] PeriodFilter (рабочий, не косметический)
- [x] Footer "Аналитика с 01.01.2025"

### Карточка сделки (/deals/[id])
- [x] DealHeader chip-strip (manager, дата, длительность, этапы, сообщения, сумма)
- [x] DealAiAnalysis (AI summary)
- [x] DealMetrics (Talk Ratio, время ответа, breakdown)
- [x] DealAudioList — 5 свежих + кнопка "показать ещё"
- [x] DealAudio с правильным parseTranscript ([МЕНЕДЖЕР]/[КЛИЕНТ])
- [x] FunnelTimeline — все стадии воронки + аккордеоны + per-stage messages
- [x] Stage synthesis когда нет реальной истории
- [x] DealStatsSidebar

### Контроль качества (/quality)
- [x] Empty state корректный
- [x] AudioPlayer (sidebar) с правильным parseTranscript
- [ ] CallScore widgets (нет — pending #35)

### Менеджеры (/managers)
- [x] Cards с метриками + статусами
- [x] Drill-down работает

### Паттерны (/patterns)
- [x] Renders insights/patterns
- [ ] Diva insights появятся после DeepSeek diva (#36)

---

## ИЗВЕСТНЫЕ ОГРАНИЧЕНИЯ (открыто говорим клиенту)

1. **Sipuni reklama "User is not licensed"** — все ≥3 мес записи expired. Нужен upgrade тарифа Sipuni Базовый → Расширенный для retention 1 год.
2. **amoCRM stage history** — events API не возвращает lead_status_changed для старых сделок. Webhook нужен для новых (запланировано #33).
3. **GC duration NULL** — длительность звонков не парсится из GC. Фильтруем inline на RunPod.
4. **GC createdAt** = время нашего sync. Нужен fix #34.

---

## ОЧЕРЕДЬ ПОСЛЕ ДЕМО

| # | Задача | Эффорт |
|---|---|---|
| #33 | amoCRM webhook live stage history | 2ч |
| #34 | Fix GC sync createdAt | 30 мин |
| #35 | Quality module CallScore | 2-3ч |
| #36 | DeepSeek diva запуск | 15 мин (сегодня) |
| #37 | Cron daily auto-sync | 2ч |
| #38 | Playwright GC cookie refresh | 3-4ч |

---

## КОМАНДЫ ДЛЯ ОЧИСТКИ ПОСЛЕ

```bash
# Stop оба RunPod (когда готово):
# Через UI dashboard.runpod.io → Stop кнопка
# ИЛИ через runpodctl с API key:
runpodctl config --apiKey <KEY>
runpodctl stop pod nxb3im34as2o8k
runpodctl stop pod pks0w5zvgdpsbd

# Если диск опять забьётся:
docker builder prune -af
docker image prune -af
```

---

## КРИТИЧНО НЕ ТРОГАТЬ

- `qup-bot-1`, `qup-router-1`, `qup-postgres`, `qup-caddy-1`
- `investment-bot-*`
- `soldout_postgres` (БД)
- Только `smart-analyze-*` и `gc-sync-*` контейнеры — наш scope
