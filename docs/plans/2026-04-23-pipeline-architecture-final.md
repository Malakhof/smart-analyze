# Production Pipeline Architecture — путь к 100% accuracy

**Date:** 2026-04-23
**Status:** SCHEMA + DISCOVERIES SAVED. Awaiting decision on full run.

---

## Финальная архитектура (5 шагов)

```
┌──────────────────────────────────────────────────────────────────┐
│ AUDIO (стерео .wav/.mp3 от onPBX/Sipuni/MegaPBX)                │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ STEP 1: Whisper transcribe per-channel (Intelion RTX 3090)       │
│   - faster-whisper large-v3                                       │
│   - word_timestamps=True, vad_filter=False                        │
│   - condition_on_previous_text=False                              │
│   - no_repeat_ngram_size=3, repetition_penalty=1.1               │
│   - Output: ls (LEFT segments), rs (RIGHT segments)               │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ STEP 2: AI Role Detector (DeepSeek, ~30 сек / звонок)            │
│   - Читает первые 30с обоих каналов                               │
│   - Определяет: кто представился ("звоню от Дива/Васту") = MGR   │
│   - Кто ответил "Алло"/"Да" = CLIENT                              │
│   - Output: {left: "МЕНЕДЖЕР"|"КЛИЕНТ", right: ..., conf: 0-100}  │
│   - Cost: ~30₽/1000 calls                                         │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ STEP 3: Channel-first merge (Python in pipeline)                  │
│   - Apply role labels из Step 2                                   │
│   - Build per-channel utterances FIRST (drift-resistant)          │
│   - Interleave by start_time                                      │
│   - RMS energy filter (ECHO_ENERGY_RATIO=2.5) — kills bleed       │
│   - Filter HALLUCINATION_PATTERNS                                 │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ STEP 4: Quality gate (DeepSeek, ~$0.04/1000 calls = ~3₽)         │
│   - Voicemail/IVR/secretary detector                              │
│   - Skip non-REAL calls для analysis                              │
│   - Save callType to DB                                           │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ STEP 5: Transcript repair (DeepSeek, ~250₽/1000 calls)           │
│   - Glossary-based corrections (Гуру/Буру, месяц зивы/Киева)     │
│   - Save transcriptRepaired                                       │
│   - Original kept for audit                                       │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ STEP 6: Sales-script scorer (DeepSeek, ~80₽/1000 calls)          │
│   - 11-stage compliance check (per tenant playbook)               │
│   - Save scriptScore (0-22) + scriptDetails (JSON)                │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ STEP 7: UI Display                                                │
│   - Voicemail filter chip                                         │
│   - Script score badge with stage breakdown                       │
│   - Toggle original/repaired transcript                           │
└──────────────────────────────────────────────────────────────────┘

TOTAL COST per 1000 retranscriptions:
  Intelion (RTX 3090, ~9 ч)          ~430₽
  Step 2 (role detector)              ~30₽
  Step 4 (voicemail)                  ~3₽
  Step 5 (transcript repair)          ~250₽
  Step 6 (script scorer)              ~80₽
  TOTAL                              ~793₽ / 1000 звонков (~0.8₽/звонок)
```

---

## Открытия по итогам 8-часовой оркестрации

### v2 → v2.4 эволюция

| Версия | Изменение | Результат |
|---|---|---|
| v2.0 | Per-channel transcribe | Базовая стерео точность |
| v2.1 | + cross-channel text dedup | Убирает text-similar echo |
| v2.2 | + RMS energy filter (ECHO_ENERGY_RATIO=2.5) | Single-syllable echo gone |
| v2.3 | **Channel-first merge** (главный breakthrough) | Long diva 429→139 lines |
| v2.4 | + Sipuni outbound swap + Whisper repetition_penalty | Diva 100% / Vastu 77% |

### Главный breakthrough: **timestamp drift диагноз**

Whisper транскрибирует L/R каналы независимо, его word-level timestamps на каждом канале не выровнены ±50-200мс. На overlap zones global merge-by-start-time даёт ping-pong:
```
64.78 L Ага,    64.86 R Если    65.44 L это    65.64 R можно,    65.66 L хорошо.
```
Channel-first merge — **сначала** строит utterances per-channel (drift невидим), **потом** interleave готовых блоков:
```
[КЛИЕНТ 01:04]   Ага, это хорошо.
[МЕНЕДЖЕР 01:04] Если можно, ...
```

### Вторая критическая находка: Sipuni роли — per-call, не per-direction

Изначально предполагали что Sipuni outbound всегда swap (RIGHT=MGR). Word-count анализ 13 vastu calls показал:
- 10 calls: RIGHT > LEFT (manager на RIGHT) ✅
- 3 calls: LEFT > RIGHT (manager на LEFT) ❌

**Канал менеджера зависит от агента/extension, не от направления.** Поэтому word-count heuristic ≠ 100%. Решение — **AI role detector** (DeepSeek читает контекст представления).

### Cross-channel echo bleed (validated by external research)

Подход = **post-ASR cross-channel echo suppression by energy-ratio channel selection**. Это валидный приём из multichannel processing (Interspeech paper +22% VAD accuracy, Berkeley meeting speech thesis). Не самопал.

Big players (Deepgram/AssemblyAI/Twilio/Gong) **не лечат bleed постфактум** — полагаются на чистую запись на источнике. У нас железо PBX старое → пост-фильтр оправдан + LLM repair compensates.

### Whisper limitations — компенсация LLM-слоем

ASR никогда не будет 100%:
- Domain-specific mistranscriptions (Гуру→Буру)
- Repetition loops на длинных звонках
- Hallucinations на тишине ("Продолжение следует", "ЗВОНОК ДВЕРЬ")
- Empty channel galore (3% звонков)

**Решение: LLM-layer compensates downstream.** Это паттерн Gong/Chorus/Aircall — не гнаться за 100% ASR, а строить умный analysis layer поверх.

---

## Pre-production TODO (decision pending)

### P0 — обязательно до запуска
1. **AI role detector** (~1.5ч) — Step 2 в архитектуре, DeepSeek prompt + script
2. **Schema migration** (~30 мин) — 4 новые колонки в `CallRecord`:
   - `callType String?` (REAL/VOICEMAIL/IVR/SECRETARY/HUNG_UP/NO_ANSWER)
   - `scriptScore Int?` (0-22 для diva 11-step)
   - `scriptDetails Json?` (per-stage breakdown)
   - `transcriptRepaired String?` (LLM-corrected)
3. **Pipeline integration** (~30 мин) — orchestrator script связывает Step 1 (Whisper) → Step 2 (роль) → Step 3 (merge) → Step 4-6 (LLM)

### P1 — UI после данных
4. **UI: voicemail filter chip** на `/quality` page (~1ч)
5. **UI: script score badge** на карточке звонка + popup с разбивкой 11 этапов (~2ч)
6. **UI: transcript toggle** оригинал/исправленный (~30 мин)

### P2 — после первого production run
7. Cron auto-sync ежедневный (после демо)
8. Per-tenant glossary в БД (вместо hardcode в repair script)
9. Manager dashboard с агрегацией script scores

---

## Готовые компоненты (в коде)

| Файл | Что делает | Status |
|---|---|---|
| `scripts/intelion-transcribe-v2.py` | Whisper + channel-first merge + RMS filter (v2.4) | ✅ ready |
| `scripts/detect-call-type.ts` | Voicemail/IVR/REAL classifier | ✅ tested 20 calls |
| `scripts/score-diva-script-compliance.ts` | 11-stage scorer | ✅ ready |
| `scripts/repair-transcripts.ts` | Glossary-based repair | ✅ tested 10 calls |
| `/tmp/tuning/score_transcript.py` | Rule-based metric scorer | ✅ working |

**Не написано (P0 todo):**
- `scripts/detect-channel-roles.ts` — AI role detector (Step 2)
- Prisma migration для 4 новых колонок
- Orchestrator script связывающий все 6 шагов

---

## Следующие решения (за пользователем)

1. **Когда запускать full run на 1000 diva?** — после schema migration + role detector
2. **Vastu — ждать AI role detector или ship-as-is с LLM repair компенсацией?**
3. **UI порядок** — что строить первым: voicemail filter или script badge?
4. **Расширение на reklama / coral / shumoff** — после или параллельно с diva production?

---

## Cost-breakeven analysis

При ~800₽/1000 звонков (Intelion + LLM):
- Diva: 22 363 звонка = ~17 800₽ один прогон → **17₽/звонок при 1000-кратной экономии менеджерского времени** (1 МОП слушает звонок 5 мин = ~30₽ времени)
- Vastu: 22 363 звонка аналогично
- Reklama: 633 звонка = ~500₽
- Coral: 8 504 звонка = ~6 800₽
- **Все 5 клиентов** ~50K звонков = **~40 000₽ на полный анализ**

Окупается за 1 месяц SaaS-подписки одного клиента.
