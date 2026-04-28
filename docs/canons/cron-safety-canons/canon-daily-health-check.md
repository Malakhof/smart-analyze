# 🏥 Daily Health Check — Canon (mandatory защитный layer)

**Зачем:** Cron-master-pipeline сам себя не проверяет. Если timeweb сервер ребутнулся → crontab не перезагрузился → cron не запускается → **никто не узнает 24+ часа**, пока РОП не заметит «новых звонков нет».

Daily health-check = независимый watcher который раз в день проверяет: **жив ли pipeline?** Если нет — алерт.

## Что проверяет

```typescript
// scripts/daily-health-check.ts
// Запускается отдельным cron 04:00 AM каждый день
// НЕЗАВИСИМО от cron-master-pipeline (если pipeline сломан, health-check всё равно работает)

interface HealthCheckResult {
  metric: string
  status: 'ok' | 'warning' | 'critical'
  value: any
  expected: string
}

const checks: HealthCheckResult[] = []

// 1. ✅ LastSync для каждого tenant обновлялся за последние 30 мин
const tenants = await db.tenant.findMany()
for (const t of tenants) {
  const last = await db.lastSync.findFirst({
    where: { tenantId: t.id },
    orderBy: { timestamp: 'desc' }
  })
  const ageMinutes = last ? (Date.now() - last.timestamp.getTime()) / 60000 : Infinity
  checks.push({
    metric: `${t.name}.lastSync.ageMin`,
    status: ageMinutes > 30 ? 'critical' : 'ok',
    value: ageMinutes.toFixed(1),
    expected: '< 30 (cron каждые 15 мин)'
  })
}

// 2. ✅ ReconciliationCheck без discrepancyPct > 0.10 за последние 24ч
const recent = await db.reconciliationCheck.findMany({
  where: { checkedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
})
const highDiscrep = recent.filter(r => r.discrepancyPct > 0.10)
checks.push({
  metric: 'reconciliation.high_discrep_24h',
  status: highDiscrep.length > 0 ? 'critical' : 'ok',
  value: highDiscrep.length,
  expected: '0 (тяжёлый discrepancy = silent rot)'
})

// 3. ✅ Disk free > 20% на /tmp
const tmpFree = await getDiskFreePct('/tmp')
checks.push({
  metric: 'disk.tmp.freePct',
  status: tmpFree < 0.20 ? 'critical' : tmpFree < 0.30 ? 'warning' : 'ok',
  value: (tmpFree * 100).toFixed(1) + '%',
  expected: '> 20%'
})

// 4. ✅ Postgres connection count < 50 (cron не утекает соединения)
const pgConns = await db.$queryRaw<{count: number}[]>`
  SELECT COUNT(*)::int as count FROM pg_stat_activity WHERE state != 'idle'
`
checks.push({
  metric: 'postgres.activeConnections',
  status: pgConns[0].count > 80 ? 'critical' : pgConns[0].count > 50 ? 'warning' : 'ok',
  value: pgConns[0].count,
  expected: '< 50'
})

// 5. ✅ GPU spend сегодня < cap для каждого tenant
for (const t of tenants) {
  const todaySpend = await checkAndChargeGpuSpend(t.id, { dryRun: true })
  const cap = t.dailyGpuCapUsd ?? 20
  checks.push({
    metric: `${t.name}.gpuSpend.today`,
    status: todaySpend > cap * 0.9 ? 'warning' : 'ok',
    value: '$' + todaySpend.toFixed(2),
    expected: '< $' + cap.toFixed(2)
  })
}

// 6. ✅ Cookie validity для всех GC tenants
const gcTenants = await db.crmConfig.findMany({ where: { provider: 'GETCOURSE' } })
for (const c of gcTenants) {
  const ageDays = c.gcCookieRefreshedAt
    ? (Date.now() - c.gcCookieRefreshedAt.getTime()) / (1000 * 60 * 60 * 24)
    : 999
  checks.push({
    metric: `${c.tenant.name}.gcCookie.ageDays`,
    status: ageDays > 14 ? 'critical' : ageDays > 7 ? 'warning' : 'ok',
    value: ageDays.toFixed(1),
    expected: '< 7 days (auto-refresh должен срабатывать)'
  })
}

// 7. ✅ Stuck in_flight calls старше 1 часа
const stuck = await db.callRecord.count({
  where: {
    transcriptionStatus: 'in_flight',
    updatedAt: { lt: new Date(Date.now() - 60 * 60 * 1000) }
  }
})
checks.push({
  metric: 'callRecord.stuckInFlight',
  status: stuck > 0 ? 'warning' : 'ok',
  value: stuck,
  expected: '0 (resume logic должен подхватывать через 30 мин)'
})

// 8. ✅ Failed permanently > 5 = что-то не так с pipeline
const failedPerm = await db.callRecord.count({
  where: {
    transcriptionStatus: 'failed_permanent',
    enrichmentStatus: { not: 'enriched' }  // ещё не разобрали
  }
})
checks.push({
  metric: 'callRecord.failedPermanent',
  status: failedPerm > 10 ? 'critical' : failedPerm > 5 ? 'warning' : 'ok',
  value: failedPerm,
  expected: '< 5 (выше — что-то системное сломано)'
})

// 9. ✅ /enrich-calls производительность — pending < 200 для самого активного tenant
for (const t of tenants) {
  const pending = await db.callRecord.count({
    where: {
      tenantId: t.id,
      transcript: { not: null },
      enrichmentStatus: { not: 'enriched' }
    }
  })
  checks.push({
    metric: `${t.name}.enrichBacklog`,
    status: pending > 500 ? 'warning' : 'ok',
    value: pending,
    expected: '< 200 (вечерний batch /enrich-calls должен подбирать)'
  })
}

// === REPORT ===
const critical = checks.filter(c => c.status === 'critical')
const warning = checks.filter(c => c.status === 'warning')

let report = `📊 Daily Health Check — ${new Date().toISOString()}\n\n`
report += `🔴 Critical: ${critical.length} | 🟡 Warning: ${warning.length} | ✅ OK: ${checks.length - critical.length - warning.length}\n\n`

if (critical.length > 0) {
  report += '🔴 CRITICAL:\n'
  for (const c of critical) {
    report += `  ${c.metric} = ${c.value} (expected: ${c.expected})\n`
  }
  report += '\n'
}

if (warning.length > 0) {
  report += '🟡 WARNING:\n'
  for (const c of warning) {
    report += `  ${c.metric} = ${c.value} (expected: ${c.expected})\n`
  }
}

console.log(report)

// Telegram только если есть critical/warning
if (critical.length > 0 || warning.length > 0) {
  await telegramAlert(report)
}

// Записать в БД для history (тренд anomalies)
await db.healthCheckRun.create({
  data: {
    runAt: new Date(),
    criticalCount: critical.length,
    warningCount: warning.length,
    okCount: checks.length - critical.length - warning.length,
    fullReport: checks  // jsonb
  }
})

process.exit(critical.length > 0 ? 1 : 0)  // exit 1 если критическое — для алертов оркестратора
```

## Crontab

```cron
# Daily health check 04:00 AM
0 4 * * * cd /root/smart-analyze && tsx scripts/daily-health-check.ts >> /var/log/smart-analyze/health-check.log 2>&1
```

## Schema

```prisma
model HealthCheckRun {
  id            String   @id @default(cuid())
  runAt         DateTime
  criticalCount Int
  warningCount  Int
  okCount       Int
  fullReport    Json
}
```

## Что delivered

- Через 24 часа после поломки cron — Telegram alert тебе с конкретной метрикой
- История health-checks → можно строить trend (метрики деградируют постепенно?)
- Не зависит от cron-master-pipeline — отдельный процесс

## Without this canon

Главный риск: **silent rot**. Cron работает, sync идёт, но cookie протухает медленно (3 → 5 → 7 → 14 дней) и в один прекрасный день всё падает. Без daily-health-check ты узнаешь когда РОП напишет «почему вчерашних звонков нет».

С canon — ты узнаешь утром о любых тенденциях деградации.
