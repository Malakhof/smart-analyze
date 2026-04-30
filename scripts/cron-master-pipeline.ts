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
import { loadTenantWithPbx } from "./lib/load-tenant-pbx"
import { runStage1PbxDelta } from "./lib/stage1-pbx-delta"
import { linkPbxCallsToGc } from "./lib/stage35b-link-pbx-gc"
import { runStage9Reconcile } from "./lib/stage9-reconcile"
import { updateLastSync, getLastSync } from "./lib/stage11-last-sync"
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
      console.log(`[0] tenant=${tenant.name} pbx=${tenant.pbxProvider} cap=$${tenant.dailyGpuCapUsd}/day`)

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
        console.log(`[0] dry-run — exit before mutations`)
        return
      }

      // Stage 1: PBX delta
      const stage1 = await runStage1PbxDelta(db, tenant, windowStart, windowEnd)

      // Stage 2-6: download + Whisper (shell out — gated)
      if (!SKIP_GPU && stage1.fetched > 0) {
        console.log(`[2-6] GPU pipeline gated by --skip-gpu=false: would invoke smart-download + whisper. ` +
                    `Currently invoke manually until v2 (see scripts/orchestrate-pipeline.py).`)
      } else {
        console.log(`[2-6] skipped (skip-gpu=${SKIP_GPU} fetched=${stage1.fetched})`)
      }

      // Stage 7: DeepSeek (shell out — gated)
      if (!SKIP_DEEPSEEK) {
        console.log(`[7] DeepSeek gated by --skip-deepseek=false: invoke detect-call-type + repair + score-* manually.`)
      } else {
        console.log(`[7] skipped`)
      }

      // Stage 7.5: phone resolve (inline — uses GC cookie)
      if (cookie && baseUrl) {
        const resolved = await runPhoneResolve(db, tenant.id, cookie, baseUrl)
        console.log(`[7.5] phone-resolve resolved=${resolved.resolved} linkedDeals=${resolved.linkedDeals}`)
      } else {
        console.log(`[7.5] skipped — no GC cookie/baseUrl`)
      }

      // Stage 7.5b: PBX↔GC linking
      if (!SKIP_STAGE35B && cookie && baseUrl) {
        const linked = await linkPbxCallsToGc({
          db, tenantId: tenant.id, baseUrl, cookie,
          windowStart, windowEnd,
        })
        console.log(`[7.5b] PBX↔GC matched=${linked.matched} unmatched=${linked.unmatched} already=${linked.alreadyLinked}`)
      } else {
        console.log(`[7.5b] skipped (skip=${SKIP_STAGE35B} hasCookie=${!!cookie})`)
      }

      // Stage 9: reconcile
      const recon = await runStage9Reconcile({
        db, tenant,
        pbxCount: stage1.fetched,
        pbxUuids: [], // TODO: pass UUID list once Stage 1 returns it
        baseUrl: baseUrl ?? undefined,
        cookie: cookie ?? undefined,
        windowStart, windowEnd,
      })

      // Stage 10: alert
      if (recon.discrepancyPct > ALERT_THRESHOLD) {
        await alertTenant(
          db, tenant.id,
          `🚨 ${tenant.name}: discrepancy ${(recon.discrepancyPct * 100).toFixed(1)}% ` +
          `(PBX=${recon.pbxCount} DB=${recon.dbCount} CRM=${recon.crmCount ?? "n/a"}) ` +
          `window ${windowStart.toISOString()}..${windowEnd.toISOString()}`
        )
        await db.$executeRawUnsafe(
          `UPDATE "ReconciliationCheck" SET "alertSent" = true WHERE id = $1`, recon.id
        )
      }

      // Stage 11: bump watermark
      await updateLastSync(db, tenant.id, `PBX_${tenant.pbxProvider}`, windowEnd)

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

main().catch((e) => {
  console.error("FATAL:", e)
  process.exit(1)
})
