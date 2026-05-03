/**
 * whisper-worker.ts — long-running daemon. Picks pending CallRecord rows
 * from the queue (FOR UPDATE SKIP LOCKED), runs Whisper + DeepSeek persist,
 * marks rows transcribed.
 *
 * Run via systemd (Restart=always). Multiple instances are safe — each one
 * grabs disjoint batches via row-level locks.
 *
 * Loop body each iteration:
 *   1. recoverStaleInFlight (canon-whisper-resume) — rescue stuck rows
 *   2. cost-cap pre-check (canon-gpu-cost-cap) — refuse if today >= cap
 *   3. count pending; if < MIN_BATCH → sleep 60s, repeat
 *   4. claim batch (atomic)
 *   5. ensure GPU pod running (boot if needed; arm 25-min watchdog)
 *   6. write batch.jsonl + spawn run-full-pipeline.sh (with timeout 25 min)
 *   7. fetch results.jsonl + spawn persist-pipeline-results.ts (timeout 30 min)
 *   8. mark rows transcribed (or failed/pipeline_gap on errors)
 *   9. if no more pending → stop pod, sleep 60s
 *
 * On SIGTERM (systemd stop): finish current batch then exit cleanly.
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { hostname } from "node:os"
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import {
  claimWhisperBatch, claimPersistOnlyBatch, markBatchOutcome,
  recoverStaleInFlight, countPendingForTenant,
} from "./lib/worker-claim"
import { loadTenantWithPbx, type LoadedTenant } from "./lib/load-tenant-pbx"
import { assertUnderCap } from "./lib/gpu-cost-tracker"
import { alertTenant } from "./lib/telegram-alert"
import { StageLogger } from "./lib/stage-timestamps"
import {
  getPodStatus, startPod, stopPod, waitPodReady,
  openGpuRun, closeGpuRun,
} from "./lib/intelion-pod-control"

// ───── Config ─────
const TENANT_NAME = process.argv[2] ?? "diva-school"
const POD_ID = Number(process.env.WORKER_POD_ID ?? "5598")
const POD_RATE_RUB_PER_HOUR = Number(process.env.WORKER_POD_RATE_RUB ?? "34.23")
const POD_RATE_USD_PER_HOUR = POD_RATE_RUB_PER_HOUR / 95           // 1 USD ≈ 95 RUB
const MIN_BATCH = Number(process.env.WORKER_MIN_BATCH ?? "10")
const BATCH_SIZE = Number(process.env.WORKER_BATCH_SIZE ?? "30")
const IDLE_SLEEP_MS = Number(process.env.WORKER_IDLE_SLEEP_MS ?? "60000")
const STALE_AFTER_MS = Number(process.env.WORKER_STALE_AFTER_MS ?? String(30 * 60 * 1000))
const WATCHDOG_PING_MS = 25 * 60 * 1000
const REPO_ROOT = process.env.REPO_ROOT ?? "/root/smart-analyze"
const WORKER_ID = `${hostname()}-${process.pid}`

let SHUTDOWN_REQUESTED = false
process.on("SIGTERM", () => { SHUTDOWN_REQUESTED = true })
process.on("SIGINT",  () => { SHUTDOWN_REQUESTED = true })

// ───── Shared state ─────
let podOwnedByWorker = false
let activeGpuRunId: string | null = null
let watchdogTimer: NodeJS.Timeout | null = null

// ───── Helpers ─────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function shouldExit(): Promise<boolean> {
  return SHUTDOWN_REQUESTED
}

function startWatchdog(token: string, runId: string): void {
  if (watchdogTimer) clearInterval(watchdogTimer)
  watchdogTimer = setInterval(async () => {
    try {
      const info = await getPodStatus(token, POD_ID)
      if (info.status === -1) {
        console.warn(`[watchdog] pod ${POD_ID} silently died — restarting`)
        await startPod(token, POD_ID)
      }
    } catch (e) {
      console.warn(`[watchdog] ping failed: ${(e as Error).message}`)
    }
  }, WATCHDOG_PING_MS)
}

function stopWatchdog(): void {
  if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null }
}

async function ensurePodRunning(tenant: LoadedTenant): Promise<{ ok: boolean; ip: string | null }> {
  if (!tenant.intelionToken) return { ok: false, ip: null }
  const info = await getPodStatus(tenant.intelionToken, POD_ID)
  if (info.status === 2 && info.ip) return { ok: true, ip: info.ip }
  await startPod(tenant.intelionToken, POD_ID)
  const ready = await waitPodReady(tenant.intelionToken, POD_ID, 5 * 60 * 1000)
  if (!ready) return { ok: false, ip: null }
  podOwnedByWorker = true
  return { ok: true, ip: ready.ip }
}

async function stopPodIfOwned(tenant: LoadedTenant, finalOutcome: "completed" | "capped" | "killed"): Promise<void> {
  if (!podOwnedByWorker || !tenant.intelionToken) return
  try { await stopPod(tenant.intelionToken, POD_ID) } catch { /* best effort */ }
  podOwnedByWorker = false
  stopWatchdog()
}

// ───── Pipeline shell-out (Whisper + persist) ─────

async function runWhisperOnBatch(
  tenant: LoadedTenant,
  rows: Array<{ id: string; pbxUuid: string; audioUrl: string; duration: number | null; managerExt: string | null }>,
  runDir: string,
): Promise<{ ok: boolean; resultsPath: string }> {
  mkdirSync(runDir, { recursive: true })
  const batchPath = `${runDir}/batch.jsonl`
  const lines = rows.map((r) =>
    JSON.stringify({
      id: r.pbxUuid, uuid: r.pbxUuid, url: r.audioUrl,
      dur: r.duration, manager_ext: r.managerExt, tenant: tenant.name,
    })
  )
  writeFileSync(batchPath, lines.join("\n") + "\n")

  // Source of truth for onPBX creds is Tenant.pbxConfig (encrypted, decrypted by
  // loadOnPbxAuth in load-tenant-pbx.ts), not .env — auto-refresh writes back to
  // DB on rotate, so per-call getCreds() always returns the freshest pair.
  const { domain, keyId, key } = tenant.adapter.getCreds()
  const env: Record<string, string> = {
    ...process.env,
    ON_PBX_DOMAIN: domain,
    ON_PBX_KEY_ID: keyId,
    ON_PBX_KEY:    key,
    WHISPER_MAX_DURATION: "10800",
  }
  const r = spawnSync("bash", [
    `${REPO_ROOT}/scripts/run-full-pipeline.sh`, batchPath, runDir, "--gpus=1",
  ], { env, stdio: "inherit", encoding: "utf8", timeout: 30 * 60 * 1000 })
  return { ok: r.status === 0, resultsPath: `${runDir}/whisper-0.jsonl` }
}

interface WhisperResultRow {
  id?: string
  uuid?: string
  transcript?: string
  error?: string
  skipped?: string
  duration?: number
}

function readResultsJsonl(path: string): Map<string, WhisperResultRow> {
  const map = new Map<string, WhisperResultRow>()
  if (!existsSync(path)) return map
  const text = readFileSync(path, "utf8")
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line) as WhisperResultRow
      const uuid = row.uuid ?? row.id
      if (uuid) map.set(uuid, row)
    } catch { /* skip malformed line */ }
  }
  return map
}

async function runPersist(tenant: LoadedTenant, resultsPath: string, transcribedUuids: string[]): Promise<boolean> {
  if (!existsSync(resultsPath)) return false
  if (transcribedUuids.length === 0) return true   // nothing to persist
  // Pass exact pbxUuid list — repair/detect/score now read --uuids and process
  // EXACTLY these rows (no SELECT-by-NULL-column guessing). canon-call-record-states.
  const uuidsArg = `--uuids=${transcribedUuids.join(",")}`
  const r = spawnSync("node_modules/.bin/tsx", [
    "scripts/persist-pipeline-results.ts", resultsPath, tenant.name, uuidsArg,
  ], {
    cwd: REPO_ROOT, env: process.env, stdio: "inherit", encoding: "utf8",
    timeout: 30 * 60 * 1000,
  })
  return r.status === 0
}

// ───── Main loop ─────

async function main() {
  console.log(`[worker] id=${WORKER_ID} tenant=${TENANT_NAME} pod=${POD_ID} pid=${process.pid}`)
  const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter: adapterPg })
  const tenant = await loadTenantWithPbx(db, TENANT_NAME)
  if (!tenant.intelionToken) {
    console.error(`[worker] tenant ${tenant.name} has no intelionToken — exit`)
    process.exit(1)
  }

  // Stage logs go to /var/log/smart-analyze/ (mounted in systemd unit) so they
  // survive container restarts and are tail-able from the host without exec.
  const logDir = process.env.WORKER_LOG_DIR ?? "/var/log/smart-analyze"
  const stageLog = new StageLogger(
    `${logDir}/worker-${tenant.name}-timeline.log`,
    `${logDir}/worker-${tenant.name}-events.jsonl`,
    WORKER_ID, tenant.id,
  )
  console.log(`[worker] cap=$${tenant.dailyGpuCapUsd}/day MIN_BATCH=${MIN_BATCH} BATCH_SIZE=${BATCH_SIZE}`)

  while (!await shouldExit()) {
    try {
      // 1. Stale recovery
      const staleReset = await recoverStaleInFlight(db, tenant.id, STALE_AFTER_MS)
      if (staleReset > 0) {
        await stageLog.start("worker-stale-recovery")
        await stageLog.done("worker-stale-recovery", staleReset)
      }

      // 2. Cost cap pre-check
      const cap = await assertUnderCap(db, tenant.id, tenant.dailyGpuCapUsd)
      if (!cap.ok) {
        await alertTenant(db, tenant.id,
          `💰 ${tenant.name}: GPU daily cap $${tenant.dailyGpuCapUsd.toFixed(2)} hit (spent $${cap.spentUsd.toFixed(2)}). Worker idle until midnight МСК.`)
        await stopPodIfOwned(tenant, "capped")
        await stageLog.skip("worker-iter", `cap reached spent=$${cap.spentUsd.toFixed(2)}`)
        await sleep(15 * 60 * 1000)
        continue
      }

      // 3a. Persist-only sweep — handles rows transcribed in earlier sessions
      // that didn't reach 'processed'. Cheap (no GPU), runs every iter when
      // there's anything in 'transcribed'.
      const persistOnlyBatch = await claimPersistOnlyBatch(db, tenant.id, WORKER_ID, BATCH_SIZE)
      if (persistOnlyBatch.length > 0) {
        await stageLog.start("worker-persist-only", { batch: persistOnlyBatch.length })
        // Synthesize a results.jsonl-like file — apply already done, persist
        // just needs --uuids to know which rows to repair/detect/score.
        const runDir = `${REPO_ROOT}/tmp/runs/${tenant.name}-persist-${Date.now()}`
        mkdirSync(runDir, { recursive: true })
        const fakeResults = persistOnlyBatch.map((r) =>
          JSON.stringify({ id: r.pbxUuid, uuid: r.pbxUuid, transcript: r.transcript, duration: r.duration })
        ).join("\n") + "\n"
        const resultsPath = `${runDir}/whisper-0.jsonl`
        writeFileSync(resultsPath, fakeResults)
        const ok = await runPersist(tenant, resultsPath, persistOnlyBatch.map((r) => r.pbxUuid))
        if (ok) {
          await db.$executeRawUnsafe(
            `UPDATE "CallRecord" SET "transcriptionStatus" = 'processed', "transcriptionAt" = NOW()
             WHERE "tenantId" = $1 AND id = ANY($2::text[]) AND "transcriptionStatus" = 'transcribed'`,
            tenant.id, persistOnlyBatch.map((r) => r.id),
          )
        }
        await stageLog.done("worker-persist-only", persistOnlyBatch.length, { ok })
        // Don't sleep — try another batch immediately if more 'transcribed' rows
        continue
      }

      // 3b. Count pending (Whisper-bound work)
      const pending = await countPendingForTenant(db, tenant.id)
      if (pending < MIN_BATCH) {
        await stopPodIfOwned(tenant, "completed")
        await stageLog.skip("worker-iter", `pending=${pending} < min=${MIN_BATCH} — idle`)
        await sleep(IDLE_SLEEP_MS)
        continue
      }

      // 4. Claim batch
      await stageLog.start("worker-claim", { pendingTotal: pending })
      const claimed = await claimWhisperBatch(db, tenant.id, WORKER_ID, BATCH_SIZE)
      await stageLog.done("worker-claim", claimed.length)
      if (claimed.length === 0) {
        await sleep(IDLE_SLEEP_MS); continue
      }

      // 5. Ensure pod running + arm watchdog
      await stageLog.start("worker-pod-up")
      const pod = await ensurePodRunning(tenant)
      if (!pod.ok) {
        await markBatchOutcome(db, claimed.map((c) => c.id), "failed")
        await stageLog.error("worker-pod-up", new Error("pod failed to boot — batch released"))
        await sleep(IDLE_SLEEP_MS); continue
      }
      activeGpuRunId = await openGpuRun(db, tenant.id, POD_ID, POD_RATE_USD_PER_HOUR, claimed.length)
      startWatchdog(tenant.intelionToken, activeGpuRunId)
      await stageLog.done("worker-pod-up", undefined, { podId: POD_ID, ip: pod.ip, gpuRunId: activeGpuRunId })

      // 6. Whisper
      await stageLog.start("worker-whisper", { batch: claimed.length })
      const runDir = `${REPO_ROOT}/tmp/runs/${tenant.name}-worker-${Date.now()}`
      const { ok: wok, resultsPath } = await runWhisperOnBatch(tenant, claimed, runDir)
      await stageLog.done("worker-whisper", claimed.length, { ok: wok, resultsPath })

      // 7a. Pre-categorise rows from Whisper results — done BEFORE persist so
      // we can skip the expensive DeepSeek chain when this batch has zero
      // useful transcripts (all short/empty), and so failed rows release
      // their in_flight lock immediately.
      const results = readResultsJsonl(resultsPath)
      const transcribedIds: string[] = []
      const noSpeechIds: string[] = []
      const failedIds: string[] = []
      for (const row of claimed) {
        const r = results.get(row.pbxUuid)
        if (!r) { failedIds.push(row.id); continue }
        const hasTranscript = typeof r.transcript === "string" && r.transcript.length > 5
        if (hasTranscript && !r.error) { transcribedIds.push(row.id) }
        else { noSpeechIds.push(row.id) }
      }
      console.log(`[worker] batch outcome (pre-persist): transcribed=${transcribedIds.length} no_speech=${noSpeechIds.length} failed=${failedIds.length}`)

      // 7b. Persist (DeepSeek apply+repair+detect+score) — only if we have
      // transcripts to actually persist. Skipping when zero saves ~30 min of
      // pointless repair-transcripts loop over the whole tenant.
      let persistOk = false
      if (wok && transcribedIds.length > 0) {
        await stageLog.start("worker-persist")
        // Map CallRecord.id (claim returns id) to pbxUuid for --uuids arg.
        const transcribedRows = claimed.filter((c) => transcribedIds.includes(c.id))
        const transcribedUuids = transcribedRows.map((r) => r.pbxUuid)
        persistOk = await runPersist(tenant, resultsPath, transcribedUuids)
        await stageLog.done("worker-persist", undefined, { ok: persistOk })
      } else if (wok) {
        await stageLog.skip("worker-persist", `skipped: 0 transcribed in this batch`)
        persistOk = true   // nothing to persist — not a failure
      }

      // 7c. Mark in_flight rows with their final outcome (releases the lock).
      // canon-call-record-states:
      //   - successful Whisper + successful persist → 'processed'
      //   - successful Whisper + persist failed     → 'transcribed' (next cycle re-tries persist via --uuids)
      //   - Whisper skipped/empty                   → 'pipeline_gap' (terminal)
      //   - Whisper crashed mid-batch               → 'failed' (retryable, recovery via stale TTL)
      const transcribedFinalState = persistOk ? "transcribed" : "transcribed"  // both stay transcribed for visibility
      await markBatchOutcome(db, transcribedIds, transcribedFinalState)
      await markBatchOutcome(db, noSpeechIds,    "pipeline_gap")
      await markBatchOutcome(db, failedIds,      "failed")
      // Atomic transition: only flip transcribed→processed when ALL 3 persist
      // sub-stages reported success. If anything failed we leave the row at
      // 'transcribed' so next worker cycle re-runs persist on it via --uuids.
      if (persistOk && transcribedIds.length > 0) {
        const transcribedRows = claimed.filter((c) => transcribedIds.includes(c.id))
        const uuids = transcribedRows.map((r) => r.pbxUuid)
        await db.$executeRawUnsafe(
          `UPDATE "CallRecord"
           SET "transcriptionStatus" = 'processed',
               "transcriptionAt"     = NOW()
           WHERE "tenantId" = $1
             AND "pbxUuid" = ANY($2::text[])
             AND "transcriptionStatus" = 'transcribed'`,
          tenant.id, uuids,
        )
      }

      // 9. Close GpuRun + stop pod if no more pending
      if (activeGpuRunId) {
        await closeGpuRun(db, activeGpuRunId, wok ? "completed" : "killed",
          claimed.length)
        activeGpuRunId = null
      }
      const stillPending = await countPendingForTenant(db, tenant.id)
      if (stillPending < MIN_BATCH) {
        await stopPodIfOwned(tenant, "completed")
      }
    } catch (e) {
      const err = e as Error
      console.error(`[worker] iter error: ${err.message}`)
      await stageLog.error("worker-iter", err)
      await sleep(IDLE_SLEEP_MS)
    }
  }

  // Graceful shutdown — release pod + close GpuRun
  console.log("[worker] SIGTERM — graceful shutdown")
  if (activeGpuRunId) {
    await closeGpuRun(db, activeGpuRunId, "killed", 0)
  }
  await stopPodIfOwned(tenant, "killed")
  await db.$disconnect()
  process.exit(0)
}

main().catch((e) => {
  console.error("FATAL:", e)
  process.exit(1)
})
