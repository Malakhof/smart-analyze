/**
 * onpbx-adapter.ts — typed thin client for onlinePBX REST.
 *
 * Reads creds from `Tenant.pbxConfig` (encrypted JSON):
 *   { provider: "ONPBX", domain, keyId, key }   — keyId/key are encrypted
 *
 * Endpoints used by cron-master-pipeline:
 *   POST /mongo_history/search.json     — list calls (delta sync)
 *   POST /mongo_history/search.json     — get one-time download URL (uuid + download=1)
 */
import { decrypt } from "../crypto"

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
  keyId: string           // encrypted
  key: string             // encrypted
}

interface OnPbxAuth {
  domain: string
  keyId: string
  key: string
}

/**
 * Decrypt creds. Tolerates plain (un-encrypted) values during migration —
 * detect by absence of "iv:tag:enc" structure.
 */
export function loadOnPbxAuth(config: OnPbxConfig): OnPbxAuth {
  const isEnc = (s: string) => /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i.test(s)
  return {
    domain: config.domain,
    keyId: isEnc(config.keyId) ? decrypt(config.keyId) : config.keyId,
    key: isEnc(config.key) ? decrypt(config.key) : config.key,
  }
}

export class OnPbxAdapter {
  private readonly base: string
  private readonly authHeader: string

  constructor(auth: OnPbxAuth) {
    this.base = `https://api.onlinepbx.ru/${auth.domain}`
    this.authHeader = `${auth.keyId}:${auth.key}`
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

    // Walk backwards from `to` toward `from`, paging by trimming cursorTo to oldest seen.
    for (let page = 0; page < 50; page++) {
      const body = new URLSearchParams({
        limit: String(pageLimit),
        start_stamp_from: String(fromUnix),
        start_stamp_to: String(cursorTo),
      })
      const r = await fetch(`${this.base}/mongo_history/search.json`, {
        method: "POST",
        headers: {
          "x-pbx-authentication": this.authHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      })
      if (!r.ok) {
        throw new Error(`onPBX search.json HTTP ${r.status}: ${await r.text().catch(() => "?")}`)
      }
      const json = (await r.json()) as { status?: string; data?: OnPbxRawCall[] }
      const rows = Array.isArray(json.data) ? json.data : []
      if (rows.length === 0) break

      all.push(...rows)

      if (rows.length < pageLimit) break
      // advance cursor to the OLDEST row's timestamp minus 1 — onPBX returns descending
      const oldest = rows.reduce((a, b) => (a.start_stamp < b.start_stamp ? a : b))
      const next = oldest.start_stamp - 1
      if (next <= fromUnix) break
      cursorTo = next
    }

    // Dedup by uuid (paging boundaries can repeat)
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
    const r = await fetch(`${this.base}/mongo_history/search.json`, {
      method: "POST",
      headers: {
        "x-pbx-authentication": this.authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    })
    if (!r.ok) return null
    const json = (await r.json()) as { status?: string; data?: unknown }
    return typeof json.data === "string" && json.data.startsWith("http") ? json.data : null
  }
}
