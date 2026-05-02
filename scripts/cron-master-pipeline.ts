/**
 * cron-master-pipeline.ts — master orchestrator for the SalesGuru cron.
 *
 * Runs end-to-end every 15 min from crontab, OR can be invoked manually with
 * --window-from / --window-to to do a backfill (e.g. 28-29 апреля for diva).
 *
 * Stages (canon refs in scripts/cron-master-pipeline.skeleton.ts):
 *   0  preflight     — kill switch, lockfile, disk cleanup, GC cookie health
 *   1  PBX delta     — fetch new calls, UPSERT CallRecord (transcriptionStatus='pending')
 *   2  download      — shells out to /root/onpbx-smart-download.py (1 IP rate limit)
 *   3-6  GPU Whisper — shells out to existing intelion-transcribe-v2 pipeline
 *                       (gated by --enable-gpu OR pending count >= MIN_FOR_GPU)
 *   7  DeepSeek      — shells out to detect-call-type, repair, score, insights
 *   7.5 phone resolve — TS, scripts/cron-stage35-link-fresh-calls flow inlined
 *   7.5b PBX↔GC link — TS, scripts/lib/stage35b-link-pbx-gc
 *   8  upsert        — folded into Stage 1 (canon #8 — single pass)
 *   9  reconcile     — TS, scripts/lib/stage9-reconcile (3-way diff)
 *   10 alert         — Telegram if discrepancyPct > 0.05
 *   11 LastSync      — bump watermark (only after 9-10 succeed)
 *
 * Usage (cron):
 *   tsx scripts/cron-master-pipeline.ts diva-school
 *
 * Usage (manual backfill 28-29 april):
 *   tsx scripts/cron-master-pipeline.ts diva-school \
 *     --window-from 2026-04-28T00:00:00+03:00 \
 *     --window-to   2026-04-29T23:59:59+03:00 \
 *     --skip-gpu --skip-deepseek
 *
 * Flags:
 *   --window-from / --window-to    explicit ISO window (overrides LastSync)
 *   --skip-gpu                     don't trigger GPU stages 4-6 (rely on existing audio)
 *   --skip-deepseek                don't run Stage 7 downstream
 *   --skip-stage35b                don't run PBX↔GC linking
 *   --dry-run                      log what would happen, no DB writes after Stage 0
 *   --alert-threshold=0.05         override discrepancy alert threshold
 */
import { promises as fs } from "node:fs"
import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { acquireLock } from "./lib/cron-lock"
import { cleanupOldFiles, getDiskFreePct } from "./lib/disk-cleanup"
import { alertTenant } from "./lib/telegram-alert"
import { loadTenantWithPbx, type LoadedTenant } from "./lib/load-tenant-pbx"
import { runStage1PbxDelta } from "./lib/stage1-pbx-delta"
import { linkPbxCallsToGc } from "./lib/stage35b-link-pbx-gc"
import { runStage9Reconcile } from "./lib/stage9-reconcile"
import { updateLastSync, getLastSync } from "./lib/stage11-last-sync"
import { StageLogger } from "./lib/stage-timestamps"
import { assertUnderCap } from "./lib/gpu-cost-tracker"
import { decrypt } from "../src/lib/crypto"

// ───────────────────────────── CLI ─────────────────────────────

function arg(name: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (eq) return eq.slice(name.length + 3)
  const idx = process.argv.indexOf(`--${name}`)
  if (idx >= 0) {
    const next = process.argv[idx + 1]
    if (next && !next.startsWith("--")) return next
    return "true"
  }
  return undefined
}

const TENANT = process.argv[2]
if (!TENANT) {
  console.error("Usage: cron-master-pipeline.ts <tenantName> [flags]")
  process.exit(1)
}

const SKIP_GPU = arg("skip-gpu") === "true"
const SKIP_DEEPSEEK = arg("skip-deepseek") === "true"
const SKIP_STAGE35B = arg("skip-stage35b") === "true"
const DRY_RUN = arg("dry-run") === "true"
const ALERT_THRESHOLD = Number(arg("alert-threshold") ?? "0.05")
const WINDOW_FROM_RAW = arg("window-from")
const WINDOW_TO_RAW = arg("window-to")
// Stage 4-6 GPU/Whisper trigger threshold — skip GPU spin-up unless we have
// at least this many real_pending rows. Cost-saving: short cycles with 1-2
// new calls just wait for the next cycle when more accumulate.
const MIN_FOR_GPU = Number(arg("min-for-gpu") ?? "10")
// Hard wall-clock cap for Stage 4-7 inside one cron cycle. Realistic budget
// for 30-file Whisper batch + DeepSeek persist on a single RTX 3090 is
// 15-20 min. The lockfile (canon) prevents overlapping cycles when one runs
// long, so we can exceed the */15 crontab interval without race conditions.
const MAX_CYCLE_MIN = Number(arg("max-cycle-min") ?? "25")

const KILL_SWITCH = "/tmp/disable-cron-pipeline"
const LOCK_PATH = `/tmp/cron-pipeline-${TENANT}.lock`

// ──────────────────────────── main ─────────────────────────────

async function main() {
  const t0 = Date.now()

  // Stage 0a: kill switch
  if (existsSync(KILL_SWITCH)) {
    console.log(`[0] kill switch ${KILL_SWITCH} present — exit 0`)
    return
  }

  // Stage 0b: lockfile
  const lock = await acquireLock(LOCK_PATH, { staleMs: 30 * 60 * 1000 })
  if (!lock) {
    console.log(`[0] another cycle running for ${TENANT} — exit 0`)
    return
  }

  try {
    // Stage 0c: disk cleanup + free space probe
    const cleanup = await cleanupOldFiles({
      paths: ["/tmp/whisper-input", "/tmp/whisper-output", "/tmp/cron-debug"],
      maxAgeMs: 24 * 60 * 60 * 1000,
    })
    const freePct = getDiskFreePct("/tmp")
    console.log(`[0] cleanup deleted=${cleanup.deleted} freed=${(cleanup.bytesFreed/1024/1024).toFixed(1)}MB ` +
                `freePct=${(freePct * 100).toFixed(1)}%`)
    if (freePct < 0.10) {
      console.warn(`[0] /tmp <10% free — skipping cycle`)
      return
    }

    // Stage 0d: load tenant + DB
    const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
    const db = new PrismaClient({ adapter: adapterPg })

    try {
      const tenant = await loadTenantWithPbx(db, TENANT)
      const cycleId = `${TENANT}-${new Date().toISOString().replace(/[:.]/g, "-")}`
      const stageLog = new StageLogger(
        `/tmp/cron-${TENANT}-timeline.log`,
        `/tmp/cron-${TENANT}-events.jsonl`,
        cycleId,
        tenant.id,
      )
      await stageLog.start("preflight", { freePct, cleanupDeleted: cleanup.deleted })
      console.log(`[0] tenant=${tenant.name} pbx=${tenant.pbxProvider} cap=$${tenant.dailyGpuCapUsd}/day cycleId=${cycleId}`)

      const cfg = await db.crmConfig.findFirst({
        where: { tenantId: tenant.id, provider: "GETCOURSE", isActive: true },
      })
      const cookieRaw = cfg?.gcCookie ?? null
      const cookie = cookieRaw
        ? (/^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/i.test(cookieRaw) ? decrypt(cookieRaw) : cookieRaw)
        : null
      const baseUrl = cfg?.subdomain
        ? `https://${cfg.subdomain.includes(".") ? cfg.subdomain : cfg.subdomain + ".getcourse.ru"}`
        : null

      // Determine window
      const lastSync = await getLastSync(db, tenant.id, `PBX_${tenant.pbxProvider}`)
      const now = new Date()
      const windowStart = WINDOW_FROM_RAW
        ? new Date(WINDOW_FROM_RAW)
        : (lastSync?.lastTimestamp ?? new Date(now.getTime() - 30 * 60 * 1000))
      const windowEnd = WINDOW_TO_RAW ? new Date(WINDOW_TO_RAW) : now

      console.log(`[0] window ${windowStart.toISOString()} → ${windowEnd.toISOString()}`)

      if (DRY_RUN) {
        await stageLog.skip("preflight", "dry-run mode")
        console.log(`[0] dry-run — exit before mutations`)
        return
      }
      await stageLog.done("preflight")

      // Stage 0.6: proactive PBX key refresh — onPBX KEY_ID:KEY have ~7-9d TTL,
      // we refresh every 5d to never hit the expiry mid-cycle. Idempotent
      // (returns false when last refresh < 5d ago).
      try {
        // OnPbxAdapter has refreshIfStale; other adapters can be no-op.
        const ad = tenant.adapter as { refreshIfStale?: (days?: number) => Promise<boolean> }
        if (ad.refreshIfStale) {
          await stageLog.start("stage-0.6-pbx-key-refresh")
          const refreshed = await ad.refreshIfStale(5)
          await stageLog.done("stage-0.6-pbx-key-refresh", undefined, { refreshed })
        }
      } catch (e) {
        const err = e as Error
        await stageLog.error("stage-0.6-pbx-key-refresh", err)
        // OnPbxAuthFatalError → authKey itself rejected; alert and abort early
        // (continuing would just produce empty results forever).
        if (err.name === "OnPbxAuthFatalError") {
          await alertTenant(db, tenant.id,
            `🚨 ${tenant.name}: PBX authKey REJECTED — manual intervention required. ${err.message}`)
          throw err
        }
      }

      // Stage 1: PBX delta
      await stageLog.start("stage-1-pbx-delta", { windowStart, windowEnd })
      const stage1 = await runStage1PbxDelta(db, tenant, windowStart, windowEnd)
      await stageLog.done("stage-1-pbx-delta", stage1.fetched, {
        inserted: stage1.inserted, updated: stage1.updated,
        unmatchedExt: [...stage1.unmatchedExt],
      })

      // Stage 1.5: canon-#8 filter — split fresh rows into 'pending' (Whisper-bound)
      // vs 'no_speech' (NDZ/voicemail/short — counted in metrics but skipped from GPU).
      // Curators (ext 117/118) and the fired user (124) are excluded by hangup+talk
      // filter even before reaching Master Enrich.
      await stageLog.start("stage-1.5-canon8-filter")
      const filtered = await db.$executeRawUnsafe(
        `UPDATE "CallRecord" SET "transcriptionStatus" = CASE
           WHEN "userTalkTime" > 30
            AND "hangupCause" = 'NORMAL_CLEARING'
            AND "managerExt" NOT IN ('117','118','124')
           THEN 'pending'
           ELSE 'no_speech'
         END
         WHERE "tenantId" = $1
           AND "startStamp" BETWEEN $2 AND $3
           AND transcript IS NULL
           AND "transcriptionStatus" IS DISTINCT FROM 'transcribed'`,
        tenant.id, windowStart, windowEnd
      )
      await stageLog.done("stage-1.5-canon8-filter", Number(filtered))

      // Stage 7.5: phone resolve (inline — uses GC cookie)
      if (cookie && baseUrl) {
        await stageLog.start("stage-7.5-phone-resolve")
        const resolved = await runPhoneResolve(db, tenant.id, cookie, baseUrl)
        await stageLog.done("stage-7.5-phone-resolve", resolved.resolved, { linkedDeals: resolved.linkedDeals })
      } else {
        await stageLog.skip("stage-7.5-phone-resolve", "no GC cookie/baseUrl")
      }

      // Stage 7.5b: PBX↔GC linking + AUTHORITATIVE gcContactId from call-detail HTML
      if (!SKIP_STAGE35B && cookie && baseUrl) {
        await stageLog.start("stage-7.5b-pbx-gc-link")
        const linked = await linkPbxCallsToGc({
          db, tenantId: tenant.id, baseUrl, cookie,
          windowStart, windowEnd,
        })
        await stageLog.done("stage-7.5b-pbx-gc-link", linked.matched, {
          unmatched: linked.unmatched, already: linked.alreadyLinked,
          mgrCrossOk: linked.managerCrossCheck.ok,
          mgrCrossMismatch: linked.managerCrossCheck.mismatch,
        })

        // Re-run Deal JOIN with the now-corrected gcContactId values. Stage 7.5
        // earlier wrote dealId based on phone-resolve gcContactId (which was
        // wrong for diva — 3 generic IDs across 3378 rows). Re-JOIN now picks
        // the right Deal per client.
        await stageLog.start("stage-7.5c-deal-rejoin")
        const relinked = await db.$executeRawUnsafe(
          `UPDATE "CallRecord" cr
           SET "dealId" = (
             SELECT d.id FROM "Deal" d
             WHERE d."tenantId" = cr."tenantId" AND d."clientCrmId" = cr."gcContactId"
             ORDER BY d."createdAt" DESC LIMIT 1
           )
           WHERE cr."tenantId" = $1
             AND cr."gcContactId" IS NOT NULL
             AND cr."startStamp" >= $2
             AND cr."startStamp" <= $3`,
          tenant.id, windowStart, windowEnd
        )
        await stageLog.done("stage-7.5c-deal-rejoin", Number(relinked))
      } else {
        await stageLog.skip("stage-7.5b-pbx-gc-link",
          `skip=${SKIP_STAGE35B} hasCookie=${!!cookie}`)
      }

      // Stages 2-7 — Whisper + DeepSeek (shells out to existing pipeline)
      // Gates:
      //   --skip-gpu                  → stages 2-6 skip
      //   --skip-deepseek             → stage 7 skip
      //   real_pending < MIN_FOR_GPU  → batch too small, defer to next cycle
      //   GPU cost cap reached        → skip + telegram alert
      //   tenant.intelionToken absent → skip
      if (!SKIP_GPU) {
        const realPending = await db.$queryRawUnsafe<{ n: number }[]>(
          `SELECT COUNT(*)::int AS n FROM "CallRecord"
           WHERE "tenantId" = $1
             AND "transcriptionStatus" = 'pending'
             AND "audioUrl" IS NOT NULL`,
          tenant.id
        )
        const pendingCount = realPending[0]?.n ?? 0
        if (pendingCount < MIN_FOR_GPU) {
          await stageLog.skip("stage-2-6-gpu",
            `real_pending=${pendingCount} < MIN_FOR_GPU=${MIN_FOR_GPU} — wait next cycle`)
        } else if (!tenant.intelionToken) {
          await stageLog.skip("stage-2-6-gpu", "tenant has no intelionToken")
        } else {
          const cap = await assertUnderCap(db, tenant.id, tenant.dailyGpuCapUsd)
          if (!cap.ok) {
            await alertTenant(
              db, tenant.id,
              `💰 ${tenant.name}: GPU cap $${tenant.dailyGpuCapUsd.toFixed(2)} reached today (spent $${cap.spentUsd.toFixed(2)}) — skip Whisper`
            )
            await stageLog.skip("stage-2-6-gpu",
              `cap reached: spent=$${cap.spentUsd.toFixed(2)} cap=$${tenant.dailyGpuCapUsd.toFixed(2)}`)
          } else {
            const ok = await runWhisperAndPersist(db, tenant, stageLog, pendingCount)
            if (!ok) console.warn("[2-7] Whisper/persist had failures — see prior logs")
          }
        }
      } else {
        await stageLog.skip("stage-2-6-gpu", "skip-gpu=true")
      }

      // Stage 9: reconcile
      await stageLog.start("stage-9-reconcile")
      const recon = await runStage9Reconcile({
        db, tenant,
        pbxCount: stage1.fetched,
        pbxUuids: [],
        baseUrl: baseUrl ?? undefined,
        cookie: cookie ?? undefined,
        windowStart, windowEnd,
      })
      await stageLog.done("stage-9-reconcile", undefined, {
        pbx: recon.pbxCount, db: recon.dbCount, crm: recon.crmCount,
        discrepancyPct: recon.discrepancyPct,
        missingInDb: recon.missingInDb.length,
        duplicates: recon.duplicates.length,
      })

      // Stage 10: alert
      if (recon.discrepancyPct > ALERT_THRESHOLD) {
        await stageLog.start("stage-10-alert")
        await alertTenant(
          db, tenant.id,
          `🚨 ${tenant.name}: discrepancy ${(recon.discrepancyPct * 100).toFixed(1)}% ` +
          `(PBX=${recon.pbxCount} DB=${recon.dbCount} CRM=${recon.crmCount ?? "n/a"}) ` +
          `window ${windowStart.toISOString()}..${windowEnd.toISOString()}`
        )
        await db.$executeRawUnsafe(
          `UPDATE "ReconciliationCheck" SET "alertSent" = true WHERE id = $1`, recon.id
        )
        await stageLog.done("stage-10-alert", undefined, { discrepancyPct: recon.discrepancyPct })
      } else {
        await stageLog.skip("stage-10-alert",
          `discrepancy ${(recon.discrepancyPct * 100).toFixed(2)}% < threshold ${(ALERT_THRESHOLD * 100).toFixed(2)}%`)
      }

      // Stage 11: bump watermark
      await stageLog.start("stage-11-last-sync")
      await updateLastSync(db, tenant.id, `PBX_${tenant.pbxProvider}`, windowEnd)
      await stageLog.done("stage-11-last-sync")

      const dt = ((Date.now() - t0) / 1000).toFixed(1)
      console.log(`✓ done in ${dt}s (fetched=${stage1.fetched} discrepancy=${(recon.discrepancyPct * 100).toFixed(2)}%)`)
    } finally {
      await db.$disconnect()
    }
  } finally {
    await lock.release()
  }
}

// ────────────── Stage 7.5 inline (phone resolve) ──────────────
// Mirrors scripts/cron-stage35-link-fresh-calls.ts but doesn't shell out.

async function runPhoneResolve(
  db: PrismaClient,
  tenantId: string,
  cookie: string,
  baseUrl: string
): Promise<{ resolved: number; linkedDeals: number }> {
  const fresh = await db.$queryRawUnsafe<{ clientPhone: string }[]>(
    `SELECT DISTINCT "clientPhone" FROM "CallRecord"
     WHERE "tenantId" = $1
       AND "clientPhone" IS NOT NULL
       AND "gcContactId" IS NULL
       AND "createdAt" > NOW() - INTERVAL '7 days'`,
    tenantId
  )
  if (fresh.length === 0) return { resolved: 0, linkedDeals: 0 }

  const cachePath = `/tmp/phone-to-userid-${tenantId}.json`
  let cache: Record<string, string | null> = {}
  try { cache = JSON.parse(await fs.readFile(cachePath, "utf8")) } catch { /* fresh cache */ }

  let resolved = 0
  for (const { clientPhone } of fresh) {
    const phone = (clientPhone || "").replace(/\D/g, "").slice(-10)
    if (!phone || phone in cache) continue
    const url = `${baseUrl}/pl/user/contact/index?ContactSearch%5Bphone%5D=${phone}`
    try {
      const res = await fetch(url, { headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0" } })
      if (res.ok) {
        const html = await res.text()
        const m = html.match(/<tr[^>]*data-key="(\d+)"/) || html.match(/\/contact\/update\/id\/(\d+)/)
        cache[phone] = m ? m[1] : null
        if (cache[phone]) resolved++
      } else {
        cache[phone] = null
      }
    } catch { cache[phone] = null }
    await new Promise((r) => setTimeout(r, 250))
  }
  await fs.writeFile(cachePath, JSON.stringify(cache, null, 2))

  for (const [phone, userId] of Object.entries(cache)) {
    if (!userId) continue
    await db.$executeRawUnsafe(
      `UPDATE "CallRecord" SET "gcContactId" = $1
       WHERE "tenantId" = $2 AND "gcContactId" IS NULL AND "clientPhone" LIKE $3`,
      userId, tenantId, `%${phone}%`
    )
  }

  const linkedDeals = await db.$executeRawUnsafe(
    `UPDATE "CallRecord" cr
     SET "dealId" = (
       SELECT d.id FROM "Deal" d
       WHERE d."tenantId" = cr."tenantId" AND d."clientCrmId" = cr."gcContactId"
       ORDER BY d."createdAt" DESC LIMIT 1
     )
     WHERE cr."tenantId" = $1 AND cr."gcContactId" IS NOT NULL AND cr."dealId" IS NULL`,
    tenantId
  )
  return { resolved, linkedDeals: Number(linkedDeals) }
}

// ───────── Whisper + DeepSeek shell-out (Stages 2-7) ──────────
//
// Why shell-out and not in-process: the Whisper pipeline already exists as
// a battle-tested bash + python combo (run-full-pipeline.sh +
// intelion-transcribe-v2.py). Re-implementing in TS would duplicate logic
// that's been tuned over 24-27 backfill of 1786 calls.
//
// Self-healing:
//   * audioUrl is taken from CallRecord (Stage 7.5b filled it from GC
//     fileservice). The Whisper script falls back to onPBX resolve via env
//     creds when the row has no url, but the BD-derived jsonl supplies url
//     directly so the cycle succeeds even if onPBX API is down.
//   * MAX_DURATION=10800 (3h) for diva long calls.
//   * GPU is started inside run-full-pipeline.sh and stopped at [7/7] —
//     orchestrator does not hold the pod across cron cycles.
async function runWhisperAndPersist(
  db: PrismaClient,
  tenant: LoadedTenant,
  stageLog: StageLogger,
  pendingCount: number,
): Promise<boolean> {
  await stageLog.start("stage-2-6-gpu", { pendingCount, maxCycleMin: MAX_CYCLE_MIN })
  const repoRoot = process.env.REPO_ROOT ?? "/root/smart-analyze"
  const runDir = `${repoRoot}/tmp/runs/${tenant.name}-${Date.now()}`
  const batchPath = `${runDir}/batch.jsonl`

  // Generate batch.jsonl with the GC fileservice url so the pod doesn't
  // need to call onPBX to resolve a download URL (onPBX has been flaky).
  await fs.mkdir(runDir, { recursive: true })
  const rows = await db.$queryRawUnsafe<{
    id: string; uuid: string; url: string | null; dur: number | null
    manager_ext: string | null
  }[]>(
    `SELECT "pbxUuid" AS id, "pbxUuid" AS uuid, "audioUrl" AS url,
            duration AS dur, "managerExt" AS manager_ext
     FROM "CallRecord"
     WHERE "tenantId" = $1 AND "transcriptionStatus" = 'pending'
       AND "audioUrl" IS NOT NULL
     ORDER BY "startStamp"
     LIMIT 30`,                              // 30 calls × ~15s each ≈ 8 min on RTX 3090,
                                              // fits the MAX_CYCLE_MIN=12 budget. Backlog
                                              // shrinks one chunk per cycle until empty.
    tenant.id
  )
  const lines = rows.map((r) =>
    JSON.stringify({ id: r.id, uuid: r.uuid, url: r.url, dur: r.dur,
                     manager_ext: r.manager_ext, tenant: tenant.name })
  )
  await fs.writeFile(batchPath, lines.join("\n") + "\n")
  console.log(`[2] batch ${rows.length} files → ${batchPath}`)

  // Stages 3-6 — invoke run-full-pipeline.sh which handles GPU start, tar,
  // Whisper transcribe, fetch results, GPU stop. Pass onPBX creds so the
  // script's env-guard passes; Whisper itself prefers the url from jsonl.
  const env: Record<string, string> = {
    ...process.env,
    ON_PBX_DOMAIN: process.env.ON_PBX_DOMAIN ?? "pbx1720.onpbx.ru",
    ON_PBX_KEY_ID: process.env.ON_PBX_KEY_ID ?? "",
    ON_PBX_KEY:    process.env.ON_PBX_KEY    ?? "",
    WHISPER_MAX_DURATION: "10800",
  }
  const wp = spawnSync("bash", [
    `${repoRoot}/scripts/run-full-pipeline.sh`, batchPath, runDir, "--gpus=1",
  ], { env, encoding: "utf8", stdio: "inherit", timeout: MAX_CYCLE_MIN * 60 * 1000 })
  const whisperOk = wp.status === 0
  await stageLog.done("stage-2-6-gpu", rows.length, {
    exitCode: wp.status, durationMs: wp.error ? 0 : -1,
  })
  if (!whisperOk) {
    console.error(`[2-6] run-full-pipeline.sh exit=${wp.status} (timeout=${MAX_CYCLE_MIN}min)`)
    return false
  }

  // Stage 7: persist (apply transcripts + DeepSeek repair/detect/score).
  if (SKIP_DEEPSEEK) {
    await stageLog.skip("stage-7-deepseek", "--skip-deepseek")
    return true
  }
  const resultsPath = `${runDir}/whisper-0.jsonl`
  if (!existsSync(resultsPath)) {
    await stageLog.error("stage-7-deepseek",
      new Error(`results.jsonl missing at ${resultsPath}`))
    return false
  }
  await stageLog.start("stage-7-deepseek")
  const pp = spawnSync("node_modules/.bin/tsx", [
    "scripts/persist-pipeline-results.ts",
    resultsPath, tenant.name, `--limit=10000`,
  ], { cwd: repoRoot, env, encoding: "utf8", stdio: "inherit",
       timeout: 3 * 60 * 60 * 1000 })
  const persistOk = pp.status === 0
  await stageLog.done("stage-7-deepseek", undefined, {
    exitCode: pp.status, persistOk,
  })
  return whisperOk && persistOk
}

main().catch((e) => {
  console.error("FATAL:", e)
  process.exit(1)
})
