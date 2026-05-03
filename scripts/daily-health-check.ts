/**
 * daily-health-check.ts — early-morning sanity check for cron pipeline.
 *
 * Runs from crontab at 04:00 UTC daily. Computes:
 *   - producer health: # producer cron runs in last 24h, error count
 *   - worker health:   # batches processed, transcribed/pipeline_gap/failed
 *   - reconciliation:  worst discrepancyPct in last 24h, alertSent count
 *   - GPU spend:       today's $ vs cap (per-tenant)
 *   - storage:         disk free % on /tmp
 *   - cookie age:      hours since CrmConfig.gcCookieAt
 *
 * Writes one HealthCheckRun row per tenant. Sends Telegram alert if ANY
 * red signal (producer never ran, worker stuck, discrepancy > 10%, disk < 10%).
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { existsSync, readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { alertTenant } from "./lib/telegram-alert"
import { fetchBalances, formatBalances } from "./check-api-balances"

interface TenantRow { id: string; name: string }

async function checkTenant(db: PrismaClient, t: TenantRow): Promise<{ ok: boolean; summary: string; details: Record<string, unknown> }> {
  const issues: string[] = []
  const details: Record<string, unknown> = {}

  // Producer: cron-master-pipeline log lines in last 24h
  // Producer cycles parsed FROM the cycleId timestamp embedded in each tick:
  //   [0] tenant=... cycleId=diva-school-2026-05-02T07-30-04-520Z
  // Counting raw lines is wrong — log file may include older history when
  // logrotate hasn't run, so we'd over-report. Parse the ts and filter to
  // last 24h. Rejects ticks the parser couldn't recognise.
  const producerLog = `/var/log/smart-analyze/${t.name === "diva-school" ? "diva-producer.log" : `${t.name}-producer.log`}`
  let producerLines = 0
  let producerErrors = 0
  const cutoff24h = Date.now() - 24 * 60 * 60 * 1000
  if (existsSync(producerLog)) {
    const text = readFileSync(producerLog, "utf8")
    for (const line of text.split("\n")) {
      // tenant name itself may contain dashes (diva-school), so match the
      // ISO-shaped tail anchored at end of the cycleId token, not greedy-stop
      // on the first dash.
      const m = line.match(/cycleId=\S*?(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d+Z)/)
      if (m) {
        // Re-shape "2026-05-02T07-30-04-520Z" → "2026-05-02T07:30:04.520Z"
        const iso = m[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d+)Z/, "T$1:$2:$3.$4Z")
        const ts = Date.parse(iso)
        if (Number.isFinite(ts) && ts >= cutoff24h) producerLines++
      }
      if (/FATAL|✗ exit|fetched=0 discrepancy=N\/A/.test(line)) producerErrors++
    }
  }
  details.producerLines24h = producerLines
  details.producerErrors24h = producerErrors
  if (producerLines === 0) issues.push("producer never ran in 24h")

  // Worker batches in last 24h via stage events
  const workerEvents = `/var/log/smart-analyze/worker-${t.name}-events.jsonl`
  let claims = 0, transcribed = 0, persistOk = 0, persistFail = 0
  if (existsSync(workerEvents)) {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    for (const ln of readFileSync(workerEvents, "utf8").split("\n")) {
      if (!ln.trim()) continue
      try {
        const ev = JSON.parse(ln) as { ts?: string; stage?: string; status?: string }
        if (!ev.ts || new Date(ev.ts).getTime() < cutoff) continue
        if (ev.stage === "worker-claim" && ev.status === "done") claims++
        if (ev.stage === "worker-persist" && ev.status === "done") persistOk++
        if (ev.stage === "worker-persist" && ev.status === "error") persistFail++
      } catch { /* skip */ }
    }
  }
  details.workerClaims24h = claims
  details.workerPersistOk24h = persistOk
  details.workerPersistFail24h = persistFail

  // DB stats — pending stuck > 1h is bad
  const stuck = await db.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*)::int n FROM "CallRecord"
     WHERE "tenantId" = $1
       AND "transcriptionStatus" = 'in_flight'
       AND "transcriptionAt" < NOW() - INTERVAL '1 hour'`,
    t.id,
  )
  details.stuckInFlight = stuck[0]?.n ?? 0
  if ((stuck[0]?.n ?? 0) > 0) issues.push(`${stuck[0]?.n} rows stuck in_flight > 1h`)

  // Latest reconciliation
  const recon = await db.$queryRawUnsafe<{ discrepancyPct: number; checkedAt: Date }[]>(
    `SELECT "discrepancyPct", "checkedAt" FROM "ReconciliationCheck"
     WHERE "tenantId" = $1
     ORDER BY "checkedAt" DESC LIMIT 1`,
    t.id,
  )
  if (recon[0]) {
    details.lastDiscrepancyPct = recon[0].discrepancyPct
    details.lastReconAgeHrs = (Date.now() - new Date(recon[0].checkedAt).getTime()) / 3_600_000
    if (recon[0].discrepancyPct > 0.10) issues.push(`discrepancy ${(recon[0].discrepancyPct*100).toFixed(1)}% > 10%`)
  } else issues.push("no ReconciliationCheck row ever")

  // Today's GPU spend
  const gpu = await db.$queryRawUnsafe<{ total: number }[]>(
    `SELECT COALESCE(SUM(
       COALESCE("actualCost",
         "ratePerHour" * EXTRACT(EPOCH FROM (COALESCE("stoppedAt", NOW()) - "startedAt")) / 3600
       )
     ), 0)::float total
     FROM "GpuRun"
     WHERE "tenantId" = $1 AND "startedAt" > NOW() - INTERVAL '24 hours'`,
    t.id,
  )
  details.gpuSpend24hUsd = gpu[0]?.total ?? 0

  // Disk free
  const df = spawnSync("df", ["-P", "/tmp"], { encoding: "utf8" })
  if (df.status === 0) {
    const parts = df.stdout.trim().split("\n")[1]?.split(/\s+/)
    if (parts) {
      const total = Number(parts[1]); const avail = Number(parts[3])
      const freePct = total ? avail / total : 1
      details.diskFreePct = Number((freePct * 100).toFixed(1))
      if (freePct < 0.10) issues.push(`/tmp free ${(freePct*100).toFixed(1)}% < 10%`)
    }
  }

  // GC cookie age
  const cookie = await db.$queryRawUnsafe<{ gcCookieAt: Date | null }[]>(
    `SELECT "gcCookieAt" FROM "CrmConfig" WHERE "tenantId" = $1 AND provider = 'GETCOURSE' LIMIT 1`,
    t.id,
  )
  if (cookie[0]?.gcCookieAt) {
    const ageHrs = (Date.now() - new Date(cookie[0].gcCookieAt).getTime()) / 3_600_000
    details.gcCookieAgeHrs = Number(ageHrs.toFixed(1))
    if (ageHrs > 24 * 7) issues.push(`GC cookie age ${ageHrs.toFixed(0)}h > 7d`)
  }

  // API balances — informational, never gate ok.
  const bal = await fetchBalances().catch(() => ({ deepseekUsd: null, intelionRub: null, errors: ["fetch failed"] }))
  details.deepseekUsd = bal.deepseekUsd
  details.intelionRub = bal.intelionRub
  const balStr = formatBalances(bal)

  const ok = issues.length === 0
  const summary = ok
    ? `✅ ${t.name}: ${producerLines} ticks, ${claims} batches, GPU $${(details.gpuSpend24hUsd as number).toFixed(2)}, ${balStr}`
    : `🚨 ${t.name}: ${issues.join(", ")} | ${balStr}`
  return { ok, summary, details }
}

async function main() {
  const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter: adapterPg })

  const tenants = await db.$queryRawUnsafe<TenantRow[]>(
    `SELECT id, name FROM "Tenant" WHERE name = ANY($1::text[])`,
    ["diva-school"],   // start with one; extend when others come online
  )

  for (const t of tenants) {
    const r = await checkTenant(db, t)
    console.log(r.summary)
    await db.$executeRawUnsafe(
      `INSERT INTO "HealthCheckRun" (id, "tenantId", ok, summary, details)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4::jsonb)`,
      t.id, r.ok, r.summary, JSON.stringify(r.details),
    )
    // Always send the daily summary so the operator sees the daily heartbeat —
    // not just on red. Silence = uncertainty (was the cron killed?).
    await alertTenant(db, t.id, r.summary)
  }

  await db.$disconnect()
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1) })
