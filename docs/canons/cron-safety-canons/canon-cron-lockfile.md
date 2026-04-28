# 🔒 Cron Lockfile — Canon (mandatory для всех cron-скриптов)

**Зачем:** cron каждые 15 мин запускает скрипт. Если предыдущий проход ещё не закончился (медленный Whisper batch / GC scraping) — cron-2 запустит **второй экземпляр параллельно** → race condition: двойной download MP3, дублирование UPSERT, двойной GPU pod start, разрыв БД connection pool.

**Симптомы без lockfile:**
- В БД появляются дубли CallRecord (один UUID — две записи с разным enrichmentStatus)
- GPU billing удваивается (два pod'а параллельно)
- Postgres connection limit (50) пробивается → новые запросы fail
- LastSync.timestamp скачет назад (race на UPDATE)

## Обязательный pattern для каждого cron-скрипта

```typescript
import { acquireLock } from './lib/cron-lock'

async function main() {
  const lock = await acquireLock(`/tmp/cron-pipeline-${tenantName}.lock`, {
    timeoutMs: 5000,        // если за 5 сек не получили — другой ещё работает
    staleMs: 30 * 60 * 1000  // считать lock stale если файл старше 30 мин (оставлен мёртвым процессом)
  })

  if (!lock) {
    console.log(`[${new Date().toISOString()}] Another instance running for ${tenantName}, skip`)
    process.exit(0)  // нормальный exit, не error
  }

  try {
    await runPipeline(tenantName)
  } finally {
    await lock.release()  // ОБЯЗАТЕЛЬНО finally — иначе stale lock на reboot
  }
}
```

## Реализация `lib/cron-lock.ts`

```typescript
import * as fs from 'fs/promises'
import { constants } from 'fs'

export async function acquireLock(path: string, opts: { timeoutMs: number, staleMs: number }) {
  const start = Date.now()
  while (Date.now() - start < opts.timeoutMs) {
    try {
      // O_EXCL — атомарный fail если файл существует
      const fd = await fs.open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY)
      await fd.write(`${process.pid}\n${new Date().toISOString()}\n`)
      await fd.close()
      return {
        release: async () => { await fs.unlink(path).catch(() => {}) }
      }
    } catch (err) {
      if (err.code === 'EEXIST') {
        // Проверить не stale ли lock
        const stat = await fs.stat(path).catch(() => null)
        if (stat && Date.now() - stat.mtimeMs > opts.staleMs) {
          console.warn(`Stale lock detected (${path}), removing`)
          await fs.unlink(path).catch(() => {})
          continue
        }
        await new Promise(r => setTimeout(r, 500))
        continue
      }
      throw err
    }
  }
  return null  // timeout
}
```

## Правила применения

1. **Lock ДО любого SQL/PBX API call** — иначе race на UPSERT
2. **Lock per-tenant** — `/tmp/cron-pipeline-diva.lock`, `/tmp/cron-pipeline-vastu.lock` (разные tenant'ы могут идти параллельно)
3. **Stale timeout 30 мин** — если процесс крашнулся без cleanup, через 30 мин следующий проход возьмёт lock
4. **Exit 0 при skip** — НЕ exit 1 (cron не должен думать что был fail)
5. **Logging** — обязательно "skip due to lock" в `/var/log/smart-analyze/cron.log` для аудита

## Test scenario (для verify)

```bash
# Запустить cron-master-pipeline.ts вручную (фоном)
tsx scripts/cron-master-pipeline.ts diva-school &
PID1=$!

# Через 5 сек запустить второй экземпляр
sleep 5
tsx scripts/cron-master-pipeline.ts diva-school &
PID2=$!

# Ожидаемый результат: PID2 exit 0 + log "Another instance running"
wait $PID1 $PID2

# Verify в БД: нет дублирующихся CallRecord за этот период
psql -c "SELECT pbxUuid, COUNT(*) FROM CallRecord WHERE startStamp > NOW() - INTERVAL '10 min' GROUP BY pbxUuid HAVING COUNT(*) > 1"
# Должно вернуть 0 строк
```

## Why this matters

Без lockfile cron в production **гарантированно** даст race condition в первую неделю. Это не «возможно сломается» — это «обязательно сломается» (закон больших чисел: 96 запусков/сутки × 4 tenant = 384 шанса в день).
