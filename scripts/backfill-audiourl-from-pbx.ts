/**
 * backfill-audiourl-from-pbx.ts — one-shot data fix.
 *
 * Stage 7.5b (PBX↔GC link) failed for some rows (e.g. 130 on diva-school as
 * of 2026-05-03 — likely 2026-05-01 GC cookie expiry, ~308h age). These rows
 * have status=pending + valid pbxUuid but audioUrl IS NULL, so worker's
 * countPendingForTenant filter (`AND audioUrl IS NOT NULL`) excludes them.
 *
 * onPBX retains records ~30+ days, so resolve_onpbx_url() returns a fresh
 * download URL for each pbxUuid (curl smoke 2026-05-03: 3/3 incl. 2026-04-29
 * and 2026-05-01 returned valid URLs). This backfill writes those URLs into
 * CallRecord.audioUrl so the worker filter passes them through.
 *
 * Worker filter REMAINS in place — it's a legitimate guard for Stage 7.5b
 * health. Stage 7.5b root-cause regression is separate (open for reviewer).
 *
 * Usage:
 *   tsx scripts/backfill-audiourl-from-pbx.ts --tenant=diva-school          # dry-run
 *   tsx scripts/backfill-audiourl-from-pbx.ts --tenant=diva-school --apply  # write
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { decrypt } from "../src/lib/crypto"

interface Args { tenant: string; apply: boolean }
function parseArgs(): Args {
  const tenant = process.argv.find((a) => a.startsWith("--tenant="))?.slice(9)
  const apply  = process.argv.includes("--apply")
  if (!tenant) {
    console.error("Usage: tsx scripts/backfill-audiourl-from-pbx.ts --tenant=<name> [--apply]")
    process.exit(2)
  }
  return { tenant, apply }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

interface PbxConfig { domain: string; keyId: string; key: string }
async function loadDecryptedPbx(db: PrismaClient, tenantName: string): Promise<{ tenantId: string; pbx: PbxConfig }> {
  const rows = await db.$queryRawUnsafe<{ id: string; pbxConfig: { domain: string; keyId: string; key: string } | null }[]>(
    `SELECT id, "pbxConfig" FROM "Tenant" WHERE name = $1 LIMIT 1`,
    tenantName,
  )
  const t = rows[0]
  if (!t || !t.pbxConfig) throw new Error(`Tenant ${tenantName} not found or pbxConfig empty`)
  return {
    tenantId: t.id,
    pbx: {
      domain: t.pbxConfig.domain,
      keyId: decrypt(t.pbxConfig.keyId),
      key:   decrypt(t.pbxConfig.key),
    },
  }
}

async function resolveOnPbxUrl(pbx: PbxConfig, uuid: string): Promise<string | null> {
  const body = new URLSearchParams({ uuid, download: "1" }).toString()
  try {
    const r = await fetch(`https://api.onlinepbx.ru/${pbx.domain}/mongo_history/search.json`, {
      method: "POST",
      headers: {
        "x-pbx-authentication": `${pbx.keyId}:${pbx.key}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    })
    if (!r.ok) return null
    const j = await r.json() as { data?: unknown }
    if (typeof j.data === "string" && j.data.startsWith("http")) return j.data
    return null
  } catch {
    return null
  }
}

async function main() {
  const args = parseArgs()
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter })

  const { tenantId, pbx } = await loadDecryptedPbx(db, args.tenant)
  console.log(`[backfill] tenant=${args.tenant} (${tenantId}) domain=${pbx.domain} apply=${args.apply}`)

  const candidates = await db.$queryRawUnsafe<{ id: string; pbxUuid: string }[]>(
    `SELECT id, "pbxUuid" FROM "CallRecord"
     WHERE "tenantId" = $1
       AND "transcriptionStatus" = 'pending'
       AND ("audioUrl" IS NULL OR "audioUrl" = '')
       AND "pbxUuid" IS NOT NULL AND "pbxUuid" != ''
     ORDER BY "createdAt" DESC`,
    tenantId,
  )
  console.log(`[backfill] candidates: ${candidates.length} rows (audioUrl IS NULL, status=pending, pbxUuid present)`)

  if (candidates.length === 0) { await db.$disconnect(); return }

  const sampleN = Math.min(5, candidates.length)
  console.log(`[backfill] sample first ${sampleN} pbxUuid:`)
  for (const c of candidates.slice(0, sampleN)) console.log(`  - ${c.pbxUuid}`)

  let resolved = 0, skipped = 0, failed = 0
  const t0 = Date.now()

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    const url = await resolveOnPbxUrl(pbx, c.pbxUuid)
    if (!url) {
      skipped++
      console.log(`[backfill] ${i + 1}/${candidates.length} pbxUuid=${c.pbxUuid} → null (skip)`)
    } else if (!args.apply) {
      resolved++
      if (i < sampleN) console.log(`[backfill] ${i + 1}/${candidates.length} pbxUuid=${c.pbxUuid} → ${url.slice(0, 90)}... (dry-run)`)
    } else {
      try {
        await db.$executeRawUnsafe(
          `UPDATE "CallRecord" SET "audioUrl" = $1 WHERE id = $2`,
          url, c.id,
        )
        resolved++
        if ((i + 1) % 25 === 0) console.log(`[backfill] progress ${i + 1}/${candidates.length} resolved=${resolved} skipped=${skipped}`)
      } catch (e) {
        failed++
        console.log(`[backfill] ${i + 1}/${candidates.length} pbxUuid=${c.pbxUuid} → DB UPDATE failed: ${(e as Error).message}`)
      }
    }
    await sleep(100)
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`[backfill] DONE: resolved=${resolved} skipped=${skipped} failed=${failed} elapsed=${elapsed}s${args.apply ? " (APPLIED)" : " (DRY-RUN — no DB writes)"}`)
  await db.$disconnect()
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1) })
