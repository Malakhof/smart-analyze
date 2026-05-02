/**
 * onpbx-adapter.ts — typed thin client for onlinePBX REST.
 *
 * Reads creds from `Tenant.pbxConfig` (encrypted JSON):
 *   { provider: "ONPBX", domain,
 *     keyId, key,        — derived via /auth.json, expire ~7-9 days (encrypted)
 *     authKey            — permanent, refreshes the above (encrypted) }
 *
 * Endpoints used by cron-master-pipeline:
 *   POST /auth.json                     — refresh KEY_ID:KEY using auth_key
 *   POST /mongo_history/search.json     — list calls (delta sync)
 *   POST /mongo_history/search.json     — get one-time download URL (uuid + download=1)
 *
 * Self-healing:
 *   - On HTTP 200 + errorCode=API_KEY_CHECK_FAILED → refresh keys via auth_key,
 *     persist new keyId/key to Tenant.pbxConfig, retry ONCE.
 *   - If refresh itself fails OR retry still fails → throw OnPbxAuthFatalError
 *     (caller alerts via Telegram).
 */
import type { PrismaClient } from "../../generated/prisma/client"
import { decrypt, encrypt } from "../crypto"

export class OnPbxAuthFatalError extends Error {
  constructor(message: string) { super(message); this.name = "OnPbxAuthFatalError" }
}

export interface OnPbxRawCall {
  uuid: string
  caller_id_number: string
  destination_number: string
  start_stamp: number     // unix seconds
  duration: number
  user_talk_time: number
  hangup_cause: string
  accountcode?: string    // 'inbound' / 'outbound'
  gateway?: string
  quality_score?: number
  [k: string]: unknown
}

export interface OnPbxConfig {
  provider: "ONPBX"
  domain: string          // e.g. "pbx1720.onpbx.ru"
  keyId: string           // encrypted, derived (TTL ~7-9 days)
  key: string             // encrypted, derived
  authKey?: string        // encrypted, permanent (refresh source)
}

interface OnPbxAuth {
  domain: string
  keyId: string
  key: string
  authKey: string | null   // null when not yet stored — refresh impossible
}

const isEnc = (s: string) => /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i.test(s)
const dec = (s: string | undefined): string | null =>
  !s ? null : (isEnc(s) ? decrypt(s) : s)

/**
 * Decrypt creds. Tolerates plain (un-encrypted) values during migration.
 */
export function loadOnPbxAuth(config: OnPbxConfig): OnPbxAuth {
  return {
    domain: config.domain,
    keyId: dec(config.keyId) ?? "",
    key: dec(config.key) ?? "",
    authKey: dec(config.authKey),
  }
}

/**
 * One-shot key refresh — ask onPBX for fresh KEY_ID:KEY using authKey.
 * Returns the new pair OR throws OnPbxAuthFatalError when authKey itself
 * is rejected (revoked / wrong).
 */
export async function refreshOnPbxKeys(
  domain: string,
  authKey: string,
): Promise<{ keyId: string; key: string }> {
  const r = await fetch(`https://api.onlinepbx.ru/${domain}/auth.json`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ auth_key: authKey }),
  })
  const json = await r.json() as { status?: string; data?: { key?: string; key_id?: string }; comment?: string }
  if (json.status !== "1" || !json.data?.key || !json.data?.key_id) {
    throw new OnPbxAuthFatalError(
      `auth.json refresh failed: ${json.comment ?? JSON.stringify(json).slice(0, 200)}`
    )
  }
  return { keyId: json.data.key_id, key: json.data.key }
}

/**
 * Persist freshly-refreshed keys back to Tenant.pbxConfig (encrypted) and
 * append an audit row to PbxKeyRefreshLog (created lazily — table optional).
 */
export async function persistRefreshedKeys(
  db: PrismaClient,
  tenantId: string,
  fresh: { keyId: string; key: string },
  reason: "proactive" | "reactive_auth_fail",
): Promise<void> {
  const rows = await db.$queryRawUnsafe<{ pbxConfig: Record<string, string> }[]>(
    `SELECT "pbxConfig" FROM "Tenant" WHERE id = $1`, tenantId,
  )
  const cfg = rows[0]?.pbxConfig ?? {}
  cfg.keyId = encrypt(fresh.keyId)
  cfg.key   = encrypt(fresh.key)
  await db.$executeRawUnsafe(
    `UPDATE "Tenant" SET "pbxConfig" = $1::jsonb WHERE id = $2`,
    JSON.stringify(cfg), tenantId,
  )
  // Audit — best-effort, table is created on demand.
  try {
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "PbxKeyRefreshLog" (
        id          TEXT PRIMARY KEY,
        "tenantId"  TEXT NOT NULL,
        "refreshedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reason      TEXT NOT NULL,
        "newKeyIdPrefix" TEXT
      )`)
    await db.$executeRawUnsafe(
      `INSERT INTO "PbxKeyRefreshLog" (id, "tenantId", reason, "newKeyIdPrefix")
       VALUES (gen_random_uuid()::text, $1, $2, $3)`,
      tenantId, reason, fresh.keyId.slice(0, 12),
    )
  } catch (e) { console.warn(`[onpbx] refresh audit log failed: ${(e as Error).message}`) }
}

export class OnPbxAdapter {
  private base: string
  private authHeader: string

  // db + tenantId optional — passed only when auto-refresh is desired.
  // When absent, auth-fail throws immediately.
  constructor(
    private auth: OnPbxAuth,
    private readonly db?: PrismaClient,
    private readonly tenantId?: string,
  ) {
    this.base = `https://api.onlinepbx.ru/${auth.domain}`
    this.authHeader = `${auth.keyId}:${auth.key}`
  }

  /**
   * Probe → refresh → retry once. Throws OnPbxAuthFatalError if even retry
   * comes back with API_KEY_CHECK_FAILED.
   */
  private async refreshAndRetryOnce(reason: "proactive" | "reactive_auth_fail"): Promise<void> {
    if (!this.auth.authKey) {
      throw new OnPbxAuthFatalError(
        "auth fail and no authKey stored — can't refresh. Re-run setup-tenant-onpbx-authkey.ts."
      )
    }
    const fresh = await refreshOnPbxKeys(this.auth.domain, this.auth.authKey)
    this.auth.keyId = fresh.keyId
    this.auth.key = fresh.key
    this.authHeader = `${fresh.keyId}:${fresh.key}`
    if (this.db && this.tenantId) {
      await persistRefreshedKeys(this.db, this.tenantId, fresh, reason)
    }
    console.log(`[onpbx] keys refreshed (${reason}) — new keyId=${fresh.keyId.slice(0,12)}...`)
  }

  /**
   * Proactive refresh: caller checks PbxKeyRefreshLog age and refreshes BEFORE
   * the next cron cycle if last refresh > 5 days. Skips when authKey absent.
   */
  async refreshIfStale(staleAfterDays = 5): Promise<boolean> {
    if (!this.auth.authKey || !this.db || !this.tenantId) return false
    const rows = await this.db.$queryRawUnsafe<{ refreshedAt: Date }[]>(
      `SELECT "refreshedAt" FROM "PbxKeyRefreshLog"
       WHERE "tenantId" = $1 ORDER BY "refreshedAt" DESC LIMIT 1`,
      this.tenantId,
    ).catch(() => [])
    const lastRefresh = rows[0]?.refreshedAt ? new Date(rows[0].refreshedAt) : null
    const ageMs = lastRefresh ? Date.now() - lastRefresh.getTime() : Number.MAX_SAFE_INTEGER
    if (ageMs < staleAfterDays * 24 * 60 * 60 * 1000) return false
    await this.refreshAndRetryOnce("proactive")
    return true
  }

  /**
   * POST helper with auto-refresh on API_KEY_CHECK_FAILED. Wraps fetch +
   * one-shot refresh+retry. Throws OnPbxAuthFatalError if retry also fails.
   */
  private async authedPost(path: string, body: URLSearchParams, retryAfterRefresh = true): Promise<Record<string, unknown>> {
    const send = async () => {
      const r = await fetch(`${this.base}${path}`, {
        method: "POST",
        headers: {
          "x-pbx-authentication": this.authHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      })
      if (!r.ok) throw new Error(`onPBX ${path} HTTP ${r.status}: ${await r.text().catch(() => "?")}`)
      return await r.json() as Record<string, unknown>
    }
    let json = await send()
    if (json.errorCode === "API_KEY_CHECK_FAILED" && retryAfterRefresh) {
      console.warn(`[onpbx] auth fail on ${path} — refreshing keys and retrying once`)
      await this.refreshAndRetryOnce("reactive_auth_fail")
      json = await send()
      if (json.errorCode === "API_KEY_CHECK_FAILED") {
        throw new OnPbxAuthFatalError(
          `auth fail persists after refresh: ${String(json.comment ?? "?")}`
        )
      }
    }
    return json
  }

  /**
   * Fetch calls in [from..to] window. Paginates by start_stamp until empty.
   * onPBX caps `limit` at ~1000 per page; we use 500 to stay safe.
   */
  async fetchHistoryRange(from: Date, to: Date): Promise<OnPbxRawCall[]> {
    const fromUnix = Math.floor(from.getTime() / 1000)
    const toUnix = Math.floor(to.getTime() / 1000)
    const all: OnPbxRawCall[] = []
    const pageLimit = 500
    let cursorTo = toUnix

    for (let page = 0; page < 50; page++) {
      const body = new URLSearchParams({
        limit: String(pageLimit),
        start_stamp_from: String(fromUnix),
        start_stamp_to: String(cursorTo),
      })
      const json = await this.authedPost("/mongo_history/search.json", body)
      const rows = Array.isArray(json.data) ? json.data as OnPbxRawCall[] : []
      if (rows.length === 0) break
      all.push(...rows)
      if (rows.length < pageLimit) break
      const oldest = rows.reduce((a, b) => (a.start_stamp < b.start_stamp ? a : b))
      const next = oldest.start_stamp - 1
      if (next <= fromUnix) break
      cursorTo = next
    }

    const seen = new Set<string>()
    return all.filter((c) => {
      if (seen.has(c.uuid)) return false
      seen.add(c.uuid)
      return true
    })
  }

  /**
   * Resolve a one-time download URL for a recording. URL is valid ~30 min.
   * Returns null if onPBX has no recording for the uuid.
   */
  async getRecordUrl(uuid: string): Promise<string | null> {
    const body = new URLSearchParams({ uuid, download: "1" })
    try {
      const json = await this.authedPost("/mongo_history/search.json", body)
      return typeof json.data === "string" && (json.data as string).startsWith("http")
        ? json.data as string : null
    } catch {
      return null
    }
  }
}
