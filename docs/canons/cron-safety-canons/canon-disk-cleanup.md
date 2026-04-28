# 🧹 Disk Cleanup — Canon (mandatory для cron-скриптов с file I/O)

**Зачем:** cron каждые 15 мин скачивает MP3 в `/tmp/whisper-input/`. Без cleanup'а:
- 1 batch ≈ 40 файлов × ~5 MB = 200 MB
- 96 проходов/сутки × 200 MB = **19 GB/день**
- Через 5-7 дней — диск заполнен, весь сервер стопается (Postgres падает, Docker не стартует)

**Это происходило на production timeweb сервере раньше — известная грабля.**

## Обязательный pattern

В **каждом cron-скрипте** в начале работы (после lockfile, до основной логики):

```typescript
import { cleanupOldFiles } from './lib/disk-cleanup'

async function main() {
  const lock = await acquireLock(...)
  if (!lock) process.exit(0)

  try {
    // ✅ Cleanup ДО основной работы
    await cleanupOldFiles({
      paths: [
        '/tmp/whisper-input',
        '/tmp/whisper-output',
        '/tmp/cron-debug',
        '/var/log/smart-analyze',
      ],
      maxAgeMs: 24 * 60 * 60 * 1000,  // старше 24 часов — удалять
      preserveActiveLocks: true,  // не трогать .lock файлы активных процессов
    })

    // Disk space check после cleanup
    const free = await getDiskFreePct('/tmp')
    if (free < 0.10) {
      await telegramAlert(`/tmp заполнен ${(100-free*100).toFixed(0)}%, cron skip`)
      process.exit(0)
    }

    await runPipeline(...)
  } finally {
    await lock.release()
  }
}
```

## Реализация `lib/disk-cleanup.ts`

```typescript
import * as fs from 'fs/promises'
import * as path from 'path'
import { execSync } from 'child_process'

export async function cleanupOldFiles(opts: {
  paths: string[]
  maxAgeMs: number
  preserveActiveLocks?: boolean
}) {
  const now = Date.now()
  let cleaned = 0
  let skipped = 0

  for (const dir of opts.paths) {
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    } catch (err) {
      if (err.code === 'ENOENT') continue  // папки нет — ОК
      throw err
    }

    for (const name of entries) {
      const full = path.join(dir, name)
      const stat = await fs.stat(full).catch(() => null)
      if (!stat) continue

      // Не трогать активные lock-файлы (только что созданные)
      if (opts.preserveActiveLocks && name.endsWith('.lock') && now - stat.mtimeMs < 30 * 60 * 1000) {
        skipped++
        continue
      }

      if (now - stat.mtimeMs > opts.maxAgeMs) {
        if (stat.isDirectory()) {
          await fs.rm(full, { recursive: true, force: true })
        } else {
          await fs.unlink(full)
        }
        cleaned++
      }
    }
  }

  console.log(`[cleanup] removed=${cleaned}, kept=${skipped}`)
  return { cleaned, skipped }
}

export async function getDiskFreePct(path: string): Promise<number> {
  // df -P для portable output
  const out = execSync(`df -P ${path} | tail -1`).toString()
  // Filesystem 1024-blocks Used Available Capacity Mounted
  const parts = out.trim().split(/\s+/)
  const totalKb = parseInt(parts[1])
  const availKb = parseInt(parts[3])
  return availKb / totalKb
}
```

## Что cleanup'ить

| Путь | maxAge | Почему |
|---|---|---|
| `/tmp/whisper-input/` | 24ч | MP3 после Whisper уже не нужны |
| `/tmp/whisper-output/` | 24ч | Транскрипты записаны в БД |
| `/tmp/cron-debug/` | 7 дней | Debug-логи на случай разбора |
| `/var/log/smart-analyze/cron.log.*` | 7 дней (logrotate) | Старые ротированные логи |
| `/tmp/*.lock` | 30 мин (если orphaned) | Stale locks от мёртвых процессов |
| `/tmp/batch-*.tgz` | 6 часов | Tar archives для GPU transfer |

## logrotate конфиг

`/etc/logrotate.d/smart-analyze`:
```
/var/log/smart-analyze/cron.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
```

## Daily cleanup cron (защитный layer)

Дополнительно к per-script cleanup — отдельный cron 03:00 AM:

```
0 3 * * * cd /root/smart-analyze && tsx scripts/daily-disk-cleanup.ts >> /var/log/smart-analyze/cleanup.log 2>&1
```

Этот скрипт чистит более агрессивно (всё старше 7 дней), независимо от того что pipeline jobs делают per-run.

## Test scenario

```bash
# Заполнить /tmp/whisper-input fake MP3-файлами на 1 GB (старше 24ч)
mkdir -p /tmp/whisper-input
for i in {1..200}; do
  dd if=/dev/zero of=/tmp/whisper-input/test-$i.mp3 bs=5M count=1
  touch -t 202604200000 /tmp/whisper-input/test-$i.mp3  # 9 дней назад
done

df -h /tmp  # перед cleanup

tsx scripts/cron-master-pipeline.ts diva-school

df -h /tmp  # после — должно быть значительно больше free space
```
