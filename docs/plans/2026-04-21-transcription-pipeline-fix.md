# Transcription Pipeline — Fix Plan (v2)

**Дата:** 2026-04-21
**Статус:** must-do перед включением cron auto-sync
**Trigger:** Инцидент drift — расшифровки сливаются в 29 переходов ролей на 15-минутном звонке вместо ~200.

---

## Что сломано

Файл: `scripts/runpod-transcribe-batch.py`

**Проблема 1 — длинные сегменты Whisper.** `vad_filter=True` с дефолтным порогом 0.5 склеивает речь между короткими паузами в один сегмент. На 15-минутном звонке выходит 3–5 сегментов на канал вместо 50–100.

**Проблема 2 — merge по start.** `merge_by_timestamp` сортирует сегменты по `segment.start`. Когда длинный сегмент A (10–60s) перекрывается с коротким B (15–17s), A целиком падает первым, B после. В аудио было наоборот: A прерван посередине, B сказал "ага", A продолжил.

**Результат в БД:** текст полный, роли правильные, но порядок реплик сломан. Читать невозможно. DeepSeek compliance/objections-handling падает до 50%.

---

## Что чинить (code changes)

### 1. `scripts/runpod-transcribe-batch.py`

```python
def transcribe_one(model, fp):
    segments, info = model.transcribe(
        str(fp),
        language=LANGUAGE,
        vad_filter=False,                      # ← БЫЛО True, режет тихую речь
        beam_size=5,
        word_timestamps=True,                  # ← ДОБАВИТЬ, критично для merge
        condition_on_previous_text=False,      # ← ДОБАВИТЬ, избегаем галлюцинаций
    )
    return list(segments), info.duration, info.language, info.language_probability


def merge_by_timestamp(left_segs, right_segs, label_left, label_right):
    # Собрать слова из обоих каналов, не сегменты
    words = []
    for s in left_segs:
        for w in (s.words or []):
            words.append((w.start, label_left, w.word))
    for s in right_segs:
        for w in (s.words or []):
            words.append((w.start, label_right, w.word))
    words.sort(key=lambda x: x[0])

    # Группировать подряд идущие слова одного канала в реплику
    # новая реплика когда: смена канала ИЛИ gap > 0.6s
    GAP_THRESHOLD = 0.6
    utterances = []  # [(start, label, text)]
    for start, label, word in words:
        if utterances and utterances[-1][1] == label:
            last_start, _, last_text = utterances[-1]
            last_word_end = last_start + 0.3  # rough, use w.end if available
            if start - last_word_end <= GAP_THRESHOLD:
                utterances[-1] = (last_start, label, last_text + word)
                continue
        utterances.append((start, label, word))

    # Форматируем
    lines = []
    for start, label, text in utterances:
        mm, ss = int(start // 60), int(start % 60)
        lines.append(f"[{label} {mm:02d}:{ss:02d}] {text.strip()}")
    return "\n".join(lines).strip()
```

### 2. Сохранять сырые сегменты (страховка на будущее)

- Добавить поле `CallRecord.transcriptRaw` (Jsonb nullable) в Prisma schema.
- `apply-transcripts.ts`: при наличии `raw_segments` в JSONL писать в `transcriptRaw`.
- `runpod-transcribe-batch.py`: сериализовать `[{start, end, channel, text, words}]` и включать в output row.

Тогда изменение формата представления в будущем НЕ требует перетранскрибации.

---

## План перетранскрибации

### Шаг 0 — dry-run (5 звонков, 15 минут)

```bash
# выбрать 5 звонков разной длины
docker exec smart-analyze-db psql -U smartanalyze -d smartanalyze -c "
  SELECT id, \"audioUrl\", duration
  FROM \"CallRecord\"
  WHERE transcript IS NOT NULL AND duration BETWEEN 180 AND 1200
  ORDER BY RANDOM() LIMIT 5;
"

# передать на RunPod, прогнать новым скриптом, сравнить с аудио вручную
```

Критерии приёмки:
- Переходы ролей: >=10 на минуту активного диалога
- Никаких блоков текста >30 секунд без смены роли (для живого диалога)
- Порядок реплик совпадает с аудио на первых 2 минутах

### Шаг 1 — массовая перетранскрибация

```bash
# Извлечь список всех call_id с transcript IS NOT NULL
# Обычно ~1000 звонков: diva 445 + reklama ~150 + vastu ~400
# RTX 3090: ~20x speedup, 15-минутный звонок = 45 секунд
# Итого: ~12 часов GPU или 2–3 часа параллельно на 4 подах
```

RunPod запуск — см. `memory/runpod-api-access.md` (api key спросить у user).

### Шаг 2 — пересчёт CallScore

```bash
# НЕ запускать пока перетранскрибация не дошла до конца
ssh -i ~/.ssh/timeweb root@80.76.60.130
cd /root/smart-analyze
docker exec smart-analyze-db psql -U smartanalyze -d smartanalyze -c "
  DELETE FROM \"CallScoreItem\";
  DELETE FROM \"CallTag\";
  DELETE FROM \"CallScore\";
"
docker exec smart-analyze-app npx tsx scripts/score-parallel.ts --concurrency 8
```

~$2–3 DeepSeek, 20–30 минут.

### Шаг 3 — пересчёт Insights + Patterns

```bash
# Retro-инсайты (per-section + master verdict + sales phrases)
docker exec smart-analyze-app npx tsx scripts/diva-retro-deep.ts       # для diva
docker exec smart-analyze-app npx tsx scripts/analyze-managers-diva.ts # для diva

# Для reklama/vastu — аналогичные скрипты (по аналогии, адаптировать под tenant)
```

**ВАЖНО:** `run-deepseek-pipeline.ts` содержит `Insight.deleteMany()` перед вставкой — он УДАЛИТ ретро-инсайты. Запускать только для generic patterns, не для retro.

### Шаг 4 — валидация

- Открыть 5 случайных звонков в UI, сверить с аудио
- Проверить что /quality compliance-chart показывает более равномерный разброс (а не всё на крайних значениях)
- Проверить /retro insights на связность

---

## После фикса: включение cron auto-sync

Только когда шаги 1–4 прошли на всех 3 клиентах, можно включать:

- CRM sync (amoCRM + GC) — каждые 2 часа
- audio extract — после sync
- transcribe — каждые 6 часов
- score-parallel — после transcribe
- insights refresh — раз в сутки

**Не раньше.** Иначе cron будет день за днём копить повреждённые транскрипты на новых звонках.

---

## Стоимость (одноразовый цикл)

| Шаг | Время | Деньги |
|-----|-------|--------|
| Dry-run 5 звонков | 15 мин | $0.10 |
| Перетранскрибация ~1000 звонков (4 поды параллельно) | 2–3 ч | $5–8 |
| Удалить CallScore | 1 мин | — |
| score-parallel 8 workers | 20–30 мин | $2–3 |
| Retro insights refresh | 5 мин | $0.50 |
| **Итого** | **~3 часа** | **~$10** |

---

## Lessons learned (для будущих инцидентов)

1. **Не доверять дефолтам.** `vad_filter=True` звучит безопасно, но ломает тихие звонки. Всегда проверять на реальных данных (не на тестовых файлах).

2. **Segment-level merge — ловушка.** На stereo-split с пересекающейся речью нужен word-level, segment-level выдаёт drift. Это не про ошибку транскрибации, а про склейку 2 каналов.

3. **Raw всегда сохранять.** Если бы у нас было `transcriptRaw`, мы бы пересобрали формат без перетранскрибации. Теперь платим GPU-часами.

4. **Sanity-check на плотность переходов.** После любой перетранскрибации прогонять SQL: для stereo-звонков >5 мин ожидаем >=10 переходов/мин. Меньше — красный флаг.

5. **Перед cron auto-sync — финальный pipeline.** Любые изменения в transcribe/score после включения cron требуют новой перетранскрибации уже накопленных данных. Зафиксировать pipeline до cron, потом не трогать.
