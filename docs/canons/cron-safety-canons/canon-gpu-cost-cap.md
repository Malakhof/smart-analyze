# 💰 GPU Cost Cap — Canon (mandatory защита от runaway billing)

**Зачем:** Intelion GPU pod стоит ~$0.50-1.50/час (RTX 3090). Если watchdog зациклится / pod не остановится после Whisper / silent stop триггерит постоянные restart'ы — за ночь можно потратить **$50-100 на ровном месте**.

**Известные failure modes:**
1. Watchdog detect silent stop → restart pod → pod снова silent stop → restart → бесконечный цикл
2. Whisper не завершился → `keepaliveWatchdog: true` → pod живёт 24/7
3. Cron-master падает между Stage 5 (transcribe) и Stage 6 (auto-stop) → pod забыт
4. Concurrent runs (lockfile не работает) → 2 pods параллельно × 4 tenant'a = 8 pods × $1/час = $192/сутки

## Обязательный pattern

```typescript
import { checkAndChargeGpuSpend, killGpuIfCapHit } from './lib/gpu-cost-tracker'

async function startGpuPodWithCap(tenant) {
  // ✅ Pre-check: уже потратили лимит сегодня?
  const todaySpent = await checkAndChargeGpuSpend(tenant.id, { dryRun: true })

  const DAILY_CAP_USD = 20.00  // настраиваемо per-tenant в БД
  if (todaySpent >= DAILY_CAP_USD) {
    await telegramAlert(`${tenant.name}: 💰 GPU cap $${DAILY_CAP_USD} hit ($${todaySpent.toFixed(2)} today). Skip.`)
    return null
  }

  // ✅ Запустить pod
  const podId = await intelionApi.startPod()

  // ✅ Записать start event для billing tracking
  await db.gpuRun.create({
    data: {
      tenantId: tenant.id,
      podId,
      startedAt: new Date(),
      ratePerHour: 1.0,  // $1/hr для RTX 3090
    }
  })

  // ✅ Background: каждые 5 мин проверять накопленный spend
  const watchdogTimer = setInterval(async () => {
    const currentSpend = await checkAndChargeGpuSpend(tenant.id)
    if (currentSpend >= DAILY_CAP_USD) {
      console.error(`[gpu-cap] HIT ${currentSpend} >= ${DAILY_CAP_USD}, killing pod ${podId}`)
      await killGpuIfCapHit(podId, tenant)
      clearInterval(watchdogTimer)
    }
  }, 5 * 60 * 1000)

  return { podId, watchdogTimer }
}

async function stopGpuPodAndRecordSpend(podId, tenantId) {
  await intelionApi.stopPod(podId)
  await db.gpuRun.update({
    where: { podId },
    data: { stoppedAt: new Date() }
  })
}
```

## Реализация `lib/gpu-cost-tracker.ts`

```typescript
import { db } from './db'

export async function checkAndChargeGpuSpend(tenantId: string, opts?: { dryRun: boolean }) {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  // Все pod runs за сегодня (running и завершённые)
  const runs = await db.gpuRun.findMany({
    where: {
      tenantId,
      startedAt: { gte: startOfToday }
    }
  })

  let totalSpend = 0
  for (const run of runs) {
    const start = run.startedAt
    const end = run.stoppedAt ?? new Date()  // running pod — считаем до now
    const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60)
    totalSpend += hours * run.ratePerHour
  }

  return totalSpend
}

export async function killGpuIfCapHit(podId: string, tenant: { id: string, name: string }) {
  await intelionApi.killPod(podId)
  await db.gpuRun.update({
    where: { podId },
    data: { stoppedAt: new Date(), killedReason: 'cost_cap' }
  })
  await telegramAlert(`${tenant.name}: 🚨 GPU pod killed (cost cap hit). Pipeline на паузе до завтра.`)
}
```

## Schema migration

```prisma
model GpuRun {
  id            String    @id @default(cuid())
  tenantId      String
  podId         String    @unique
  startedAt     DateTime
  stoppedAt     DateTime?
  ratePerHour   Float     @default(1.0)
  killedReason  String?   // null | 'cost_cap' | 'silent_stop' | 'normal'

  @@index([tenantId, startedAt])
}
```

## Per-tenant конфигурация cap

Добавить в `Tenant` table (или config):
```prisma
model Tenant {
  // ...
  dailyGpuCapUsd    Float     @default(20.00)
}
```

Default $20/сутки/tenant — это ~20 часов GPU на RTX 3090. Хватит на все звонки за день в 99% случаев. Если pipeline здоровый — обычно тратит $5-10/сутки.

Если cap пробивается — это signal что что-то идёт не так (watchdog зациклился, или объёмы выросли в 2x).

## Алерт-strategy

| Spend | Действие |
|---|---|
| 50% от cap ($10/$20) | Info log, никаких alert |
| 80% от cap ($16/$20) | 🟡 Telegram warning «cost approaching» |
| 100% cap ($20+) | 🔴 Telegram alert + kill pod + skip cron до 00:00 следующего дня |
| 200% от cap ($40+) | 🚨 PagerDuty / SMS — что-то совсем не так |

## Test scenario

```bash
# Симулировать runaway: вручную создать 25 GpuRun за сегодня по 1 часу каждый
psql -c "INSERT INTO \"GpuRun\" (\"id\", \"tenantId\", \"podId\", \"startedAt\", \"stoppedAt\", \"ratePerHour\")
  SELECT gen_random_uuid(), 'cmo4qkb1000000jo432rh0l3u', 'fake-pod-' || i, NOW() - INTERVAL '25 hours' + (i * INTERVAL '1 hour'), NOW() - INTERVAL '24 hours' + (i * INTERVAL '1 hour'), 1.0
  FROM generate_series(1, 25) i"

# Запустить cron — должно отказаться стартовать pod
tsx scripts/cron-master-pipeline.ts diva-school

# Verify: лог содержит "GPU cap $20.00 hit" + Telegram alert пришёл
```

## Critical: НЕ снимать cap в production

Если хочется временно повысить cap — изменить `Tenant.dailyGpuCapUsd` в БД. **НЕ хардкодить в скрипте.** Cap — это safety net, его легко обойти случайно.
