# 🔄 Whisper Resume After GPU Restart — Canon

**Зачем:** GPU pod может умереть на полпути:
1. Intelion silent stop через 60 мин (известный bug `feedback-intelion-auto-renewal-bug.md`)
2. Watchdog detect → restart pod
3. **Что с in-flight файлами?** — те 15 MP3 что Whisper уже начал обрабатывать когда pod упал

**Без resume logic:** in-flight файлы остаются в `/tmp/whisper-input/` на pod'е (который теперь killed), `transcript=null` в БД, в следующий cron-проход их **не подхватит** (они уже скачаны, идут в `skipExisting`), и навсегда останутся в lost-state.

## Обязательный pattern — markBatchAsResumeNeeded

```typescript
async function transcribeBatchWithResume(batch, podId) {
  // ✅ Записать что эти файлы УШЛИ на GPU (start of transcription)
  await db.callRecord.updateMany({
    where: { id: { in: batch.map(c => c.id) } },
    data: { transcriptionStatus: 'in_flight', podId }
  })

  try {
    const result = await transcribeOnGpu(batch, podId)

    // ✅ Успех — записать в БД transcript + clear in_flight
    for (const r of result) {
      await db.callRecord.update({
        where: { id: r.callId },
        data: {
          transcript: r.transcript,
          transcriptionStatus: 'done',
          podId: null
        }
      })
    }

    return result
  } catch (err) {
    // ✅ Failure — НЕ оставлять in_flight, иначе никогда не подхватится
    if (err.code === 'GPU_KILLED' || err.code === 'WATCHDOG_TIMEOUT') {
      console.warn(`[resume] GPU died, marking ${batch.length} files for retry`)
      await db.callRecord.updateMany({
        where: { id: { in: batch.map(c => c.id) } },
        data: {
          transcriptionStatus: 'pending',  // вернуть в очередь
          podId: null,
          retryCount: { increment: 1 }
        }
      })
      return null  // следующий cron-проход подхватит
    }
    throw err
  }
}
```

## Schema additions

```prisma
model CallRecord {
  // ... existing fields ...
  transcriptionStatus String?   @default("pending")  // pending | in_flight | done | failed
  podId               String?   // подразумевает что in_flight
  retryCount          Int       @default(0)
  lastTranscribeError String?
}
```

## Pickup logic в новом cron-проходе

```typescript
// В Stage 1 (sync новых) дополнительно подбирать застрявшие in_flight
async function fetchPendingCallsForTenant(tenant) {
  return await db.callRecord.findMany({
    where: {
      tenantId: tenant.id,
      OR: [
        // Новые звонки (transcript = null, без статуса)
        { transcript: null, transcriptionStatus: 'pending' },

        // ✅ Застрявшие in_flight старше 30 минут — pod точно мёртв
        {
          transcriptionStatus: 'in_flight',
          updatedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) }
        },

        // Failed но retryCount < 3 — попробовать ещё раз
        {
          transcriptionStatus: 'failed',
          retryCount: { lt: 3 }
        }
      ]
    },
    take: 40  // batch limit
  })
}
```

## Stale in_flight cleanup (отдельный safety layer)

В `daily-health-check.ts` (4:00 AM):

```typescript
async function cleanupStaleInFlight() {
  // Любые in_flight старше 1 часа — точно мёртвые
  const stuck = await db.callRecord.updateMany({
    where: {
      transcriptionStatus: 'in_flight',
      updatedAt: { lt: new Date(Date.now() - 60 * 60 * 1000) }
    },
    data: {
      transcriptionStatus: 'pending',
      podId: null,
      retryCount: { increment: 1 }
    }
  })

  if (stuck.count > 0) {
    await telegramAlert(`Daily cleanup: ${stuck.count} stuck in-flight calls reset to pending`)
  }
}
```

## Failure escalation

```typescript
// Если retryCount >= 3 — перестать retry'ить, alert РОПу для ручного разбора
const permanentFailed = await db.callRecord.findMany({
  where: { transcriptionStatus: 'pending', retryCount: { gte: 3 } }
})

if (permanentFailed.length > 0) {
  await telegramAlert(`🔴 ${permanentFailed.length} звонков не удалось расшифровать после 3 попыток. UUIDs: ${permanentFailed.map(c => c.pbxUuid).slice(0, 5).join(', ')}`)

  // Пометить как failed permanently — не блокировать batch
  await db.callRecord.updateMany({
    where: { id: { in: permanentFailed.map(c => c.id) } },
    data: { transcriptionStatus: 'failed_permanent' }
  })
}
```

## Test scenario

```bash
# Симулировать GPU kill в середине batch
# 1. Запустить cron, дождаться когда 5 файлов в transcriptionStatus='in_flight'
tsx scripts/cron-master-pipeline.ts diva-school &
sleep 60
psql -c "SELECT COUNT(*) FROM \"CallRecord\" WHERE transcriptionStatus='in_flight'"

# 2. Убить GPU вручную через Intelion API (симулируя silent stop)
curl -X POST "https://api.intelion.cloud/pods/$POD_ID/stop"

# 3. Дождаться окончания cron-проход
wait

# 4. Verify: файлы вернулись в pending, retryCount=1
psql -c "SELECT \"transcriptionStatus\", \"retryCount\", COUNT(*) FROM \"CallRecord\" GROUP BY 1, 2"
# Должно быть pending|1|5 (или failed|0|0 если успели завершиться)

# 5. Запустить cron снова — должно подхватить эти 5
tsx scripts/cron-master-pipeline.ts diva-school

# 6. Verify: transcriptionStatus='done' для всех 5
```

## Why retryCount cap = 3

- 3 попытки = вероятность транзиентной ошибки исчерпана
- Если 3 раза подряд один и тот же файл не транскрибируется — это **не GPU bug**, это **что-то с самим audio** (corrupted MP3, PBX вернул html вместо аудио, etc)
- Дальнейшие retry — пустая трата GPU времени
- Перевод в `failed_permanent` + alert РОПу даёт ручной flow расследования

## Без этого канона

В прошлых сессиях были случаи когда после Intelion silent stop **20+ звонков застревали** в полу-обработанном состоянии. Cron их не подхватывал (skipExisting), пользователь обнаруживал через 2-3 дня случайно. Это canon делает retry автоматическим.
