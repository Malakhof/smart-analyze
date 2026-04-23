/**
 * Generate test batch JSONL for vastu Sipuni calls (transcription pipeline tuning).
 *
 * STRATEGY:
 *   Vastu's Sipuni audioUrls are stored on each CallRecord (pulled from amoCRM
 *   notes during sync). They're public-by-hash:
 *     https://sipuni.com/api/crm/record?id=<call_id>&hash=<hash>&user=078268
 *   No Sipuni API key/signature needed — just pick rows from CallRecord and emit.
 *
 *   This is exactly the path documented in
 *   docs/demo/2026-04-22-vastu-strategy.md ("Нужен прямой Sipuni API? ❌ НЕТ").
 *
 * WHAT IT PICKS:
 *   - Last 30 days of vastu Sipuni calls
 *   - 5 short  (60-180s)
 *   - 5 medium (180-600s)
 *   - 5 long   (>600s)
 *   - duration > 60s as a "real conversation" floor (CallRecord lacks
 *     user_talk_time, so we use total duration)
 *   - HEAD-checks each URL (HTTP 200 + audio content-type) before emitting
 *
 * Output: JSONL to stdout: {id, url, dur, voice}
 *
 * USAGE:
 *   # Default: pulls rows from production via SSH+docker exec (read-only SELECT).
 *   tsx scripts/sipuni-fetch-batch.ts > /tmp/tuning/batch-vastu.jsonl
 *
 *   # Override SSH command if your key/host differ:
 *   SA_SSH="ssh -i ~/.ssh/timeweb root@80.76.60.130" tsx scripts/sipuni-fetch-batch.ts
 *
 *   # Or use DIRECT_DB=1 with a DATABASE_URL env (e.g. via SSH tunnel) to skip SSH.
 *   DIRECT_DB=1 DATABASE_URL=postgres://... tsx scripts/sipuni-fetch-batch.ts
 *
 * NO MODIFICATIONS to the production server. SELECT-only.
 */
import { execFileSync } from "node:child_process"

const VASTU_TENANT_ID = "cmo2pddz000010ko1xjkr4nz8"
const SSH_CMD = process.env.SA_SSH ?? "ssh -i ~/.ssh/timeweb -o StrictHostKeyChecking=no root@80.76.60.130"
const DIRECT_DB = process.env.DIRECT_DB === "1"

interface Row {
  id: string
  duration: number
  audio_url: string
  client_phone: string | null
  manager_id: string | null
  created_at: string
}

async function fetchRowsViaSSH(): Promise<Row[]> {
  // Use psql -t -A -F'|' for tuple-only pipe-separated output.
  // Window: last 30 days. Pull broad set (300) so we can pick 15 diverse with
  // HEAD-check fallback for occasional dead URLs.
  //
  // Quoting: identifiers ("CallRecord", "tenantId", ...) need DOUBLE quotes that
  // survive SSH's command join. We pass the SQL via stdin to avoid shell quoting
  // hell entirely.
  const sql = `
    SELECT id, duration, "audioUrl", "clientPhone", "managerId", "createdAt"
    FROM "CallRecord"
    WHERE "tenantId" = '${VASTU_TENANT_ID}'
      AND "audioUrl" LIKE 'https://sipuni.com/%'
      AND duration > 60
      AND "createdAt" > NOW() - INTERVAL '30 days'
    ORDER BY "createdAt" DESC
    LIMIT 300;
  `

  const sshArgs = SSH_CMD.split(/\s+/)
  const cmd = sshArgs[0]
  const args = [
    ...sshArgs.slice(1),
    `docker exec -i smart-analyze-db psql -U smartanalyze -d smartanalyze -t -A -F '|'`,
  ]

  const out = execFileSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    input: sql,
  })
  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean)
  return lines.map((line) => {
    const [id, duration, audio_url, client_phone, manager_id, created_at] = line.split("|")
    return {
      id,
      duration: Number(duration),
      audio_url,
      client_phone: client_phone || null,
      manager_id: manager_id || null,
      created_at,
    }
  })
}

async function fetchRowsViaPg(): Promise<Row[]> {
  const { Client } = await import("pg")
  const c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    const r = await c.query<{
      id: string
      duration: number
      audioUrl: string
      clientPhone: string | null
      managerId: string | null
      createdAt: Date
    }>(
      `SELECT id, duration, "audioUrl", "clientPhone", "managerId", "createdAt"
         FROM "CallRecord"
        WHERE "tenantId" = $1
          AND "audioUrl" LIKE 'https://sipuni.com/%'
          AND duration > 60
          AND "createdAt" > NOW() - INTERVAL '30 days'
        ORDER BY "createdAt" DESC
        LIMIT 300`,
      [VASTU_TENANT_ID]
    )
    return r.rows.map((row) => ({
      id: row.id,
      duration: row.duration,
      audio_url: row.audioUrl,
      client_phone: row.clientPhone,
      manager_id: row.managerId,
      created_at: row.createdAt.toISOString(),
    }))
  } finally {
    await c.end()
  }
}

async function headOk(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "HEAD", redirect: "follow" })
    if (!r.ok) return false
    const ct = r.headers.get("content-type") ?? ""
    return ct.startsWith("audio/")
  } catch {
    return false
  }
}

function bucket(rows: Row[]): { short: Row[]; medium: Row[]; long: Row[] } {
  return {
    short: rows.filter((r) => r.duration >= 60 && r.duration < 180),
    medium: rows.filter((r) => r.duration >= 180 && r.duration < 600),
    long: rows.filter((r) => r.duration >= 600),
  }
}

async function pickWithHead(rows: Row[], target: number): Promise<Row[]> {
  const out: Row[] = []
  for (const r of rows) {
    if (out.length >= target) break
    const ok = await headOk(r.audio_url)
    if (ok) out.push(r)
    else console.error(`  skip ${r.id}: HEAD failed`)
  }
  return out
}

async function main() {
  console.error(`Fetching vastu Sipuni rows (tenant=${VASTU_TENANT_ID}) ...`)
  const rows = DIRECT_DB ? await fetchRowsViaPg() : await fetchRowsViaSSH()
  console.error(`Got ${rows.length} candidate rows from DB`)

  const { short, medium, long } = bucket(rows)
  console.error(`Buckets: short=${short.length} medium=${medium.length} long=${long.length}`)

  const pickedShort = await pickWithHead(short, 5)
  const pickedMedium = await pickWithHead(medium, 5)
  const pickedLong = await pickWithHead(long, 5)
  const picked = [...pickedShort, ...pickedMedium, ...pickedLong]
  console.error(
    `Picked: short=${pickedShort.length} medium=${pickedMedium.length} long=${pickedLong.length} (total=${picked.length})`
  )

  for (const r of picked) {
    // CallRecord doesn't tell us per-channel which is manager vs client without
    // joining on Manager. Mark generically; downstream stereo split can resolve
    // (left=manager, right=client is the Sipuni convention for outbound).
    const out = {
      id: r.id,
      url: r.audio_url,
      dur: r.duration,
      voice: "vastu_mixed",
      client_phone: r.client_phone,
      manager_id: r.manager_id,
      created_at: r.created_at,
    }
    console.log(JSON.stringify(out))
  }

  if (picked.length < 15) {
    console.error(
      `WARNING: only ${picked.length}/15 picked. Buckets may be sparse or many URLs dead.`
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
