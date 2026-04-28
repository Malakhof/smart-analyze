# Pipeline v2.13 — Roadmap (план дальнейших улучшений)

**Date:** 2026-04-28
**Status:** v2.13 в production, backfill 857 завершён. Roadmap для следующих фаз.

---

## ✅ Фаза 1: ВЫПОЛНЕНО

1. **v2.13 transcript** применён к 541/857 (BD синхронизирован)
2. **v2.13 transcriptRepaired** перезапущен через DeepSeek (synchronized)
3. **Phone resolve** через GC HTML scraping → `gcContactId` заполнен в 6112 CallRecord
4. **Deal.clientCrmId backfill** через per-deal page fetch (137K) → автоматически заполняется в новых syncах после fix `gc-sync-v2.ts:482`
5. **CallRecord.dealId** связан через JOIN `Deal.clientCrmId = CallRecord.gcContactId`
6. **Документация** в `docs/plans/2026-04-28-pipeline-v213-final-state.md`

Основные исправления v2.13:
- Split per-channel utterance на host-boundaries (паузы ≥1.0с / `.!?` + ≥0.05с)
- Strict t > guest.start для предотвращения "хвостов" после длинных МОП-блоков
- SIGNIFICANT_WORDS=2 / SIGNIFICANT_DUR=0.4 — короткие осмысленные ответы триггерят split
- BOUNDARY_SEARCH_WINDOW=30s — длинные монологи (МОП говорит 30+ секунд до первой паузы)

---

## 🔵 Фаза 2: Hotwords для имён (ближайшее, ~1-2 дня)

**Цель:** улучшить распознавание имён менеджеров и клиентов в момент транскрибации.

**Что делать:**
1. Изменить `scripts/intelion-transcribe-v2.py`:
   - Получать список менеджеров из БД для tenant (Manager.name)
   - Подавать `hotwords="Татьяна Наталья Ольга..."` в `model.transcribe(...)`
   - НЕ использовать `initial_prompt` (echo-bug)
2. Топ-100 русских имён клиентов как baseline hotwords для всех клиентов
3. Тест на 5 проблемных файлах (где имена потеряны)
4. Если ОК — применить ко всем НОВЫМ звонкам

**Применять к 857 backfilled?**
- Опционально — re-transcribe на RTX 3090 (~9ч + ₽430)
- Ожидание: +30-50% возврат имён, +30-50% возврат late-start
- **Решение пользователя:** делать или нет

**ROI:** Высокий для будущих звонков. Без потерь (hotwords только повышают вероятность, не режут).

---

## 🟡 Фаза 3: LLM cleanup гарбажа (после v2.13 в БД)

**Проблема:** Echo-leakage из противоположного канала (МОП-канал содержит искажённое эхо клиента — "шейфилизировал", "ледяная подворота", "пиджак в Нижнем Сантехнике").

**Решение:** одноканальный LLM cleanup.

**Промпт для DeepSeek:**
```
В реплике МОПа найди фразы, которые НЕ являются связной русской речью.
Верни массив [{start, end, reason}] где это бред.
НЕ удаляй разговорный мусор ('ну', 'вот', 'это самое').
Удаляй ТОЛЬКО синтаксически невозможное / нерусское.
```

**Стоимость:** ~$2 / 1000 звонков (DeepSeek), 30 мин на 562 файла.

**Применить:** к существующим 541 transcripts в БД (новая колонка `transcriptCleaned` или поверх `transcriptRepaired`).

**Риск:** низкий — узкий промпт ("только синтаксический гарбаж"), не трогает реальные слова.

---

## 🟠 Фаза 4: Двухканальный echo dedup (опционально)

**Проблема:** эхо в МОП-канале часто **связные русские фразы** клиента (LLM не определит как мусор по грамматике).

**Решение:** двухканальный промпт.
```
В моменте X у МОПа фраза Y. У КЛИЕНТА в моменте X-2..X+2 есть фраза Z.
Если Y семантически дублирует Z (>70% similarity) — это эхо, удалить из МОПа.
```

**Стоимость:** ~$5 / 1000 звонков, 1 час разработка.

**ROI:** Средний (+3-5% чистоты). Делаем только если после Фазы 3 эхо ещё критично.

---

## 🔴 Фаза 5: Yandex SpeechKit fallback (дорого, опционально)

**Проблема:** ~13% звонков с late-start (placeholder "Приветствие. ПД. ФИО"). Whisper baseline limit на 8kHz — даже hotwords не вытянут когда реально тишина/IVR.

**Решение:** Yandex SpeechKit `general:rc` (русская модель для телефонии) для первых 30 секунд звонков с placeholder.

**Стоимость:** ~₽4500 / 1000 звонков (только для problem files = ~13% от total). Реально ~₽585 / 1000 общего объёма.

**ROI:** Высокий (+50-70% возврат начала), но дорого. Делать когда клиенты потребуют compliance accuracy.

---

## Параметры — НЕ трогать (после калибровки 60 файлов)

| Параметр | Значение | Почему не трогать |
|---|---|---|
| `PROB_THRESHOLD` | 0.20 | Выше = теряем имена с PROB 0.2-0.3 |
| `ECHO_ENERGY_RATIO` | 2.5 | Выше = режем тихие реплики и имена |
| `GAP_THRESHOLD` | 3.0 | Per-channel склейка слов (баланс) |
| `MAX_WORD_SPAN_S` | 3.0 | Drop Whisper artefacts |
| `LATE_START_S` | 25.0 | Placeholder trigger |

---

## Готовые reference файлы

- `feedback-pipeline-v213-final-settings.md` — финальные параметры v2.13
- `feedback-pipeline-v210-final-settings.md` — устаревший (v2.10 baseline)
- `feedback-whisper-8khz-baseline-limit.md` — что НЕ лечится pipeline-ом
- `feedback-orphan-reactions-pattern.md` — v2.11 drop pattern (включён в v2.13)

---

## Текущее состояние (2026-04-28)

- BD: 857 CallRecord для diva, 541 с transcript v2.13, 541 с transcriptRepaired v2.13+glossary
- Phone matching: 0/857 gcContactId (тех. блок — GC не отдаёт исторические контакты)
- Manager linkage: 822/857 (4 МОПов нет в Manager table: ext 108, 113, 125, 126)
- Cron auto-sync: НЕ настроен
- Pipeline в production for new calls: v2.10 (intelion-transcribe-v2.py НЕ обновлён до v2.13 logic — re-merge применён только локально для 857 backfill)

**Action item:** интегрировать v2.13 split-on-host-boundary в `scripts/intelion-transcribe-v2.py` перед deploy на сервер.
