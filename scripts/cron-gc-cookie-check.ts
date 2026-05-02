/**
 * cron-gc-cookie-check.ts — hourly probe + smart refresh.
 *
 * Strategy (canon-gc-cookie):
 *   1. Read CrmConfig.gcCookie + gcCookieAt.
 *   2. AGE check: if cookieAge > STALE_AFTER_DAYS (default 5d) → refresh.
 *   3. PROBE check: cheap GET /pl/user/contact/index?per-page=1.
 *      - 200 + valid HTML → cookie alive, exit 0.
 *      - 302 → /login → cookie expired → refresh.
 *   4. REFRESH (only if needed): scripts/refresh-gc-cookie.ts via Playwright.
 *      Rate-limited inside (≤ 1 refresh per 30 min).
 *      On success: write new gcCookie + gcCookieAt; alert nothing.
 *      On failure: KEEP old gcCookie (don't lose what we have); Telegram alert.
 *
 * Idempotent — running every hour does NOT actually refresh every hour;
 * refresh fires only when probe fails OR age > 5d.
 *
 * Cron entry (0 * * * *): see scripts/install-cron-pipeline.sh.
 */
import { spawnSync } from "node:child_process"
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { decrypt } from "../src/lib/crypto"
import { alertTenant } from "./lib/telegram-alert"

const STALE_AFTER_DAYS = Number(process.env.GC_COOKIE_STALE_DAYS ?? "5")
const REFRESH_RATE_MIN = Number(process.env.GC_COOKIE_REFRESH_MIN_MIN ?? "30")

interface CookieRow {
  id: string
  tenantId: string
  gcCookie: string | null
  gcCookieAt: Date | null
  subdomain: string | null
}

async function probeAlive(host: string, cookie: string): Promise<boolean> {
  try {
    const r = await fetch(`https://${host}/pl/user/contact/index?per-page=1`, {
      method: "GET",
      headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0" },
      redirect: "manual",
    })
    if (r.status === 302 || r.status === 301) return false
    if (r.status !== 200) return false
    const text = await r.text()
    // Valid GC HTML contains the kv-grid table OR the user filter form.
    return /kv-grid-table|ContactSearch|grid-view/.test(text)
  } catch {
    return false
  }
}

async function lastRefreshTooRecent(db: PrismaClient, tenantId: string): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<{ gcCookieAt: Date | null }[]>(
    `SELECT "gcCookieAt" FROM "CrmConfig" WHERE "tenantId" = $1 AND provider = 'GETCOURSE' LIMIT 1`,
    tenantId,
  )
  const last = rows[0]?.gcCookieAt
  if (!last) return false
  const ageMin = (Date.now() - new Date(last).getTime()) / 60_000
  return ageMin < REFRESH_RATE_MIN
}

async function runRefresh(tenantName: string): Promise<{ ok: boolean; output: string }> {
  // refresh-gc-cookie.ts uses Playwright — must run via the playwright image,
  // env-loaded by caller (install script puts GC_DIVA_EMAIL / GC_DIVA_PASSWORD).
  const r = spawnSync(
    "node_modules/.bin/tsx",
    ["scripts/refresh-gc-cookie.ts", tenantName],
    { cwd: "/app", env: process.env, encoding: "utf8", timeout: 5 * 60 * 1000 },
  )
  return { ok: r.status === 0, output: (r.stdout ?? "") + (r.stderr ?? "") }
}

async function checkOne(db: PrismaClient, row: CookieRow & { tenantName: string }): Promise<void> {
  const ageDays = row.gcCookieAt
    ? (Date.now() - new Date(row.gcCookieAt).getTime()) / (24 * 60 * 60 * 1000)
    : Number.MAX_SAFE_INTEGER
  const cookieRaw = row.gcCookie ?? ""
  const cookie = /^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/i.test(cookieRaw) ? decrypt(cookieRaw) : cookieRaw
  const host = (row.subdomain ?? "").includes(".") ? row.subdomain! : `${row.subdomain}.getcourse.ru`

  const stale = ageDays > STALE_AFTER_DAYS
  const probeOk = stale ? false : await probeAlive(host, cookie)
  if (probeOk && !stale) {
    console.log(`[gc-cookie] ${row.tenantName}: alive (age=${ageDays.toFixed(1)}d) — skip`)
    return
  }
  const reason = stale ? `age=${ageDays.toFixed(1)}d > ${STALE_AFTER_DAYS}d` : "probe failed"
  console.log(`[gc-cookie] ${row.tenantName}: refresh needed (${reason})`)

  if (await lastRefreshTooRecent(db, row.tenantId)) {
    console.log(`[gc-cookie] ${row.tenantName}: last refresh < ${REFRESH_RATE_MIN}m ago — defer`)
    return
  }

  const r = await runRefresh(row.tenantName)
  if (r.ok) {
    console.log(`[gc-cookie] ${row.tenantName}: refreshed ✓`)
  } else {
    console.error(`[gc-cookie] ${row.tenantName}: refresh FAILED — keeping old cookie`)
    console.error(r.output.slice(-400))
    await alertTenant(db, row.tenantId,
      `🟠 GC cookie refresh failed for ${row.tenantName} (reason: ${reason}). Old cookie kept. Manual intervention needed.`)
  }
}

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter })
  const rows = await db.$queryRawUnsafe<(CookieRow & { tenantName: string })[]>(`
    SELECT cc.id, cc."tenantId", cc."gcCookie", cc."gcCookieAt", cc.subdomain, t.name AS "tenantName"
    FROM "CrmConfig" cc
    JOIN "Tenant" t ON t.id = cc."tenantId"
    WHERE cc.provider = 'GETCOURSE' AND cc."isActive" = true
  `)
  for (const r of rows) await checkOne(db, r)
  await db.$disconnect()
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1) })
