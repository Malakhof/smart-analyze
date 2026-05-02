# Canon — CallRecord.transcriptionStatus state machine

**Date:** 2026-05-02
**Memory ref:** `feedback-call-record-states.md`

## Rule

`CallRecord.transcriptionStatus` — единственная истина о том, на каком этапе
конвейера находится запись. Все cron-stages и worker-cycles переключают
этот статус строго по разрешённым переходам.

## State machine

```
NULL                         (legacy: до canon-#8 фильтра)
  │
  ↓  Stage 1.5 canon-#8 filter (orchestrator)
  │
  ├─→ no_speech              (terminal — НДЗ / voicemail / curator / talk<30s)
  │   • НЕ берётся worker'ом, НЕ enriched
  │   • Считается в дашборд РОПа в счётчик "наборы / НДЗ / АО"
  │
  └─→ pending
      │
      ↓  worker.claimWhisperBatch (FOR UPDATE SKIP LOCKED)
      │
      └─→ in_flight
          │
          ├─→ ВРЕМЕННЫЙ — > 30 мин → recoverStaleInFlight снова pending
          │
          ↓  worker.runWhisperOnBatch (ok)
          │
          ├─→ pipeline_gap   (terminal — Whisper сказал skipped/empty)
          │   • Канон G тип
          │   • НЕ retry, НЕ enriched
          │
          ├─→ failed         (retryable — Whisper crashed mid-batch)
          │   • Worker.recoverStaleInFlight подберёт через стандартный TTL
          │
          └─→ transcribed
              │
              ↓  worker.runPersist (apply + repair + detect + score)
              │
              └─→ processed
                  │
                  ↓  user.runMasterEnrich (`/loop /enrich-calls`, manual)
                  │
                  └─→ enriched      (terminal happy path)
                      │
                      ↓  при изменении skill → optional
                      │
                      └─→ needs_rerun_v9   (помечается опционально)
```

## Allowed transitions (только эти, остальное — ошибка)

| From            | To              | Caller                                     |
|-----------------|-----------------|--------------------------------------------|
| NULL            | pending         | Stage 1.5 canon-#8 filter                  |
| NULL            | no_speech       | Stage 1.5 canon-#8 filter                  |
| pending         | in_flight       | worker claim (FOR UPDATE SKIP LOCKED)      |
| in_flight       | pending         | worker recoverStaleInFlight (>30m)         |
| in_flight       | transcribed     | worker after Whisper ok + ≥1 transcript     |
| in_flight       | pipeline_gap    | worker after Whisper skipped/empty         |
| in_flight       | failed          | worker after Whisper crash                  |
| transcribed     | processed       | worker after persist (repair+detect+score) |
| processed       | enriched        | user `/loop /enrich-calls` (Master Enrich) |
| enriched        | needs_rerun_v9  | manual / skill upgrade                      |
| needs_rerun_v9  | enriched        | re-running enrich                           |

## What each consumer reads

- **UI dashboard counters (Канон #37)** — все статусы (для метрик НДЗ/АО/реальные).
- **UI «полная карточка»** — `enriched`.
- **UI «базовое»** — `processed` (transcript + scriptScore + callType, без psychology).
- **`/loop /enrich-calls`** — берёт `processed` (готовы к Master Enrich).
- **Worker** — берёт `pending` (ничего не зависит от других статусов).
- **persist scripts (repair/detect/score)** — принимают `--uuids` от worker'а.
  Никогда не делают самостоятельный SELECT по `WHERE scriptScore IS NULL`.

## NEVER

- ❌ persist-script сам выбирает что обрабатывать через `WHERE x IS NULL` —
  гарантированно попадёт на чужие rows.
- ❌ Worker меняет `transcribed → processed` ДО успеха всех 3 persist'ов
  (если хоть один fail → следующий cycle подберёт `transcribed`).
- ❌ enriched → processed (Master Enrich это терминал).
- ❌ no_speech → pending (это терминал; если оказался ошибкой — manual).

## Связь с другими канонами

- **canon #8** (PBX metadata) — Stage 1 заполняет данные при insert
- **canon #37** (дашборд РОПа) — потребляет агрегаты по статусам
- **canon-master-enrich-card** — описывает что Master Enrich делает с `processed`
- **feedback-cron-pipeline-shellout-contract** — orchestrator → shell pipeline
