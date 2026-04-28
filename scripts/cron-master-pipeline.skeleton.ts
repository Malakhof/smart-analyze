/**
 * SKELETON — cron-master-pipeline.ts
 *
 * Это НЕ финальный код. Это — каркас который новая сессия должна
 * заполнить, ОБЯЗАТЕЛЬНО соблюдая compliance checks помеченные ✅.
 *
 * Каждый ✅ — отсылка на канон. НЕ удалять и НЕ упрощать.
 * Если хоть один ✅ check пропущен — pipeline упадёт за неделю.
 *
 * Запуск:
 *   tsx scripts/cron-master-pipeline.ts <tenantName>
 *
 * Crontab:
 *   *\/15 * * * * tsx scripts/cron-master-pipeline.ts diva-school
 *
 * Каноны:
 *   docs/canons/cron-safety-canons/canon-cron-lockfile.md
 *   docs/canons/cron-safety-canons/canon-disk-cleanup.md
 *   docs/canons/cron-safety-canons/canon-gpu-cost-cap.md
 *   docs/canons/cron-safety-canons/canon-whisper-resume.md
 *   docs/canons/cron-safety-canons/canon-gc-cookie-auto-refresh.md
 *   docs/canons/cron-safety-canons/canon-daily-health-check.md
 *   memory: feedback-intelion-auto-renewal-bug.md
 *   memory: feedback-ssh-intelion-quirks.md
 *   memory: feedback-orchestrate-tar-mp3-suffix-bug.md
 *   memory: feedback-pipeline-v213-final-settings.md
 *   memory: feedback-upsert-call-canon8-mandatory.md
 */

import { acquireLock } from './lib/cron-lock'                    // canon-cron-lockfile
import { cleanupOldFiles, getDiskFreePct } from './lib/disk-cleanup'  // canon-disk-cleanup
import { checkAndChargeGpuSpend, killGpuIfCapHit } from './lib/gpu-cost-tracker'  // canon-gpu-cost-cap
import { telegramAlert } from './lib/telegram'
import { checkCookieAlive, refreshCookieViaPlaywright } from './cron-gc-cookie-check'  // canon-gc-cookie

// === STAGE 0: PREFLIGHT (compliance gates) ===

async function preflight(tenantName: string) {
  // ✅ Compliance: kill switch (canon-daily-health-check)
  if (await fileExists('/tmp/disable-cron-pipeline')) {
    console.log('Kill switch active, exit')
    process.exit(0)
  }

  const tenant = await loadTenant(tenantName)

  // ✅ Compliance: lockfile (canon-cron-lockfile)
  const lock = await acquireLock(`/tmp/cron-pipeline-${tenantName}.lock`, {
    timeoutMs: 5000,
    staleMs: 30 * 60 * 1000
  })
  if (!lock) {
    console.log(`Another instance running for ${tenantName}, skip`)
    process.exit(0)
  }

  // ✅ Compliance: disk cleanup (canon-disk-cleanup)
  await cleanupOldFiles({
    paths: ['/tmp/whisper-input', '/tmp/whisper-output', '/tmp/cron-debug'],
    maxAgeMs: 24 * 60 * 60 * 1000,
    preserveActiveLocks: true
  })
  const freePct = await getDiskFreePct('/tmp')
  if (freePct < 0.10) {
    await telegramAlert(`${tenantName}: /tmp заполнен ${(100 * (1 - freePct)).toFixed(0)}%, skip`)
    await lock.release()
    process.exit(0)
  }

  // ✅ Compliance: GC cookie auto-refresh (canon-gc-cookie-auto-refresh)
  const crmConfig = await loadCrmConfig(tenant)
  if (crmConfig.provider === 'GETCOURSE') {
    if (!await checkCookieAlive(tenant)) {
      console.log('GC cookie expired, refreshing via Playwright...')
      await refreshCookieViaPlaywright(tenant)
    }
  }

  return { tenant, lock }
}

// === STAGE 1-11: MASTER PIPELINE ===

async function runPipeline(tenant: Tenant, lock: Lock) {
  const lastSync = await getLastSync(tenant)
  const now = new Date()

  try {
    // STAGE 1: PBX delta (memory: feedback-pbx-call-metadata-required)
    const newCalls = await pbxAdapter.fetchHistorySince(lastSync.timestamp, {
      // ✅ Compliance: SSH ConnectTimeout (memory feedback-ssh-intelion-quirks)
      sshOpts: '-o ConnectTimeout=20'
    })

    if (newCalls.length === 0) {
      // Всё равно reconcile — может быть что мы что-то пропустили
      await runReconcileOnly(tenant)
      await updateLastSync(tenant, now)
      return
    }

    // STAGE 2: Smart-download (canon-pipeline-canon-with-opus-enrich)
    const downloaded = await smartDownload(newCalls, {
      rateLimit: 3000,           // 1 IP, sleep 3s
      maxRetries: 5,
      backoff: 'exponential',
      skipExisting: true,
      // ✅ Compliance: stuck in_flight pickup (canon-whisper-resume)
      includeStuckInFlight: true
    })

    // STAGE 3: Bin-packing FFD (handoff v3 формула)
    const batches = greedyBinPackFFD(downloaded, { maxBinMinutes: 30 })

    let podId: string | null = null
    let watchdogTimer: NodeJS.Timer | null = null

    if (downloaded.length >= 10) {  // экономим — pod только если набралось
      // STAGE 4: GPU start with multi-layer compliance
      const startResult = await startGpuPodWithCompliance(tenant)
      // ✅ Compliance: cost cap (canon-gpu-cost-cap)
      // ✅ Compliance: watchdog (memory feedback-intelion-auto-renewal-bug)
      // ✅ Compliance: max-runtime safety (canon-gpu-cost-cap)
      if (!startResult) return  // cost cap hit или другая ошибка
      podId = startResult.podId
      watchdogTimer = startResult.watchdogTimer
    }

    // STAGE 5: Whisper transcribe with resume
    if (podId) {
      for (const batch of batches) {
        // ✅ Compliance: mark in_flight (canon-whisper-resume)
        await markBatchInFlight(batch, podId)

        // ✅ Compliance: .mp3 суффикс (memory feedback-orchestrate-tar-mp3-suffix-bug)
        const filesList = batch.map(c => `${c.uuid}.mp3`).join('\n')
        assertHasMp3Suffix(filesList)

        // ✅ Compliance: Whisper v2.13 params (memory feedback-pipeline-v213-final-settings)
        const transcribed = await transcribeBatch(batch, {
          podId,
          pipeline: 'v2.13',  // PROB=0.20, GAP=3.0, HOST_PAUSE_MIN=1.0, VAD=off
          hotwords: await buildHotwords(tenant),
          // ✅ Compliance: timeout safety (handoff v3)
          timeoutMs: 90 * 60 * 1000,
          // ✅ Compliance: nohup setsid (memory feedback-ssh-intelion-quirks)
          sshDetachment: 'nohup_setsid'
        })

        if (transcribed === null) {
          // GPU killed → resume logic (canon-whisper-resume)
          await markBatchAsResumeNeeded(batch)
          break  // не продолжать остальные batch'и пока pod не восстановится
        } else {
          await markBatchTranscribed(batch, transcribed)
        }
      }
    }

    // STAGE 6: GPU auto-stop
    if (podId) {
      // ✅ Compliance: stop через 10 мин idle (canon-gpu-cost-cap)
      await intelionApi.stopPodIfIdle(podId, { idleMinutes: 5 })
      if (watchdogTimer) clearInterval(watchdogTimer)
    }

    // STAGE 7: DeepSeek downstream (concurrency 15)
    await runDownstream(downloaded, {
      steps: ['detect-call-type', 'repair', 'script-score', 'insights'],
      concurrency: 15,
      // ✅ Compliance: failure isolation per step (handoff v3 DoD)
      isolateFailures: true,
      // ✅ Compliance: Whisper "хвост творцов" cleanup в repair step
      stripWhisperTail: true
    })

    // STAGE 7.5: Phone resolve + Deal link (только GC tenants)
    if (crmConfig.provider === 'GETCOURSE') {
      // ✅ Compliance: data-user-id парсинг (commit 2731932, не data-key)
      // ✅ Compliance: phone normalize last 10 digits (Канон #8)
      // ✅ Compliance: rate limit 1 req/sec (canon-pipeline)
      await runStage35(tenant)
    }

    // STAGE 8: Upsert (Канон #8)
    // ✅ Compliance: все поля в одном UPSERT (memory feedback-upsert-call-canon8-mandatory)
    // ✅ Compliance: audioUrl = onPBX URL (handoff v3)
    // ✅ Compliance: phone resolve ДО upsert
    await upsertCallRecords(downloaded, tenant, {
      fields: [
        'pbxUuid', 'managerId', 'dealId', 'gcContactId', 'clientPhone',
        'transcript', 'transcriptRepaired', 'callType', 'scriptScore',
        'scriptDetails', 'callSummary', 'sentiment', 'objections', 'hotLead',
        'audioUrl',  // ← onPBX URL!
        'pbxMeta', 'gateway', 'hangupCause', 'userTalkTime',
        'startStamp', 'duration', 'direction'
      ]
    })

    // STAGE 9: Reconciliation 3-way (Канон #38)
    const reconciliation = await reconcile({
      pbxAdapter,
      crmAdapter,
      db,
      tenant,
      window: { from: lastSync.timestamp, to: now }
    })
    await db.reconciliationCheck.create({ data: reconciliation })

    // STAGE 10: Telegram alert (формула: discrepancy = |PBX-DB|/PBX > 0.05)
    if (reconciliation.discrepancyPct > 0.05) {
      await sendReconciliationAlert(tenant, reconciliation)
    }

    // STAGE 11: UPDATE LastSync (только если 9-10 успешны)
    await updateLastSync(tenant, now)

  } catch (err) {
    await telegramAlert(`${tenant.name}: cron-pipeline FAILED at ${err.message}`)
    throw err
  } finally {
    await lock.release()  // ОБЯЗАТЕЛЬНО finally
  }
}

// === ENTRYPOINT ===

async function main() {
  const tenantName = process.argv[2]
  if (!tenantName) {
    console.error('Usage: tsx cron-master-pipeline.ts <tenantName>')
    process.exit(1)
  }

  const { tenant, lock } = await preflight(tenantName)
  await runPipeline(tenant, lock)
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})

// === STUB IMPLEMENTATIONS ===
// Новая сессия должна заменить эти stubs реальным кодом, СОБЛЮДАЯ canons.
// Каждая ✅ comment строка — это compliance gate для review.

async function startGpuPodWithCompliance(tenant: Tenant) {
  // См. canon-gpu-cost-cap.md полный пример
  const todaySpend = await checkAndChargeGpuSpend(tenant.id, { dryRun: true })
  const cap = tenant.dailyGpuCapUsd ?? 20.00
  if (todaySpend >= cap) {
    await telegramAlert(`${tenant.name}: 💰 GPU cap $${cap} hit, skip`)
    return null
  }

  const podId = await intelionApi.startPod({ sshOpts: '-o ConnectTimeout=20' })
  await db.gpuRun.create({ data: { tenantId: tenant.id, podId, startedAt: new Date(), ratePerHour: 1.0 } })

  // Watchdog
  const watchdogTimer = setInterval(async () => {
    const current = await checkAndChargeGpuSpend(tenant.id)
    if (current >= cap) {
      await killGpuIfCapHit(podId, tenant)
      clearInterval(watchdogTimer)
    }
    // Также detect silent stop
    const status = await intelionApi.getPodStatus(podId)
    if (status === 'stopped') {
      await telegramAlert(`${tenant.name}: silent stop detected, restart`)
      await intelionApi.startPod({ podId, restart: true })
    }
  }, 5 * 60 * 1000)

  // Max-runtime safety
  setTimeout(async () => {
    const stat = await intelionApi.getPodStatus(podId)
    if (stat === 'running') {
      await intelionApi.killPod(podId)
      await telegramAlert(`${tenant.name}: GPU pod kill (2h timeout)`)
      clearInterval(watchdogTimer)
    }
  }, 2 * 60 * 60 * 1000)

  return { podId, watchdogTimer }
}

// Новая сессия: реализовать остальные функции из этого файла,
// сохраняя 100% compliance checks.
