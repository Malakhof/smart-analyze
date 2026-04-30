/**
 * stage1-pbx-delta.ts — fetch new PBX calls since LastSync watermark and
 * UPSERT them into CallRecord with transcriptionStatus='pending'.
 *
 * Idempotent via @@unique on (pbxUuid). Re-running with the same window
 * is a no-op for already-loaded calls.
 *
 * Manager attribution: Manager.internalExtension match (canon #8).
 * If no Manager row matches, leaves managerId=null and stashes ext in managerExt.
 *
 * Direction: derived from accountcode and/or extension match — onPBX uses
 * 'inbound'/'outbound' in accountcode field for most providers.
 */
import type { PrismaClient } from "../../src/generated/prisma/client"
import type { OnPbxRawCall } from "../../src/lib/pbx/onpbx-adapter"
import type { LoadedTenant } from "./load-tenant-pbx"

export interface Stage1Result {
  fetched: number
  inserted: number
  updated: number
  skipped: number
  unmatchedExt: Set<string>
}

function normalizePhone(p: string | null | undefined): string | null {
  if (!p) return null
  const d = p.replace(/\D/g, "")
  return d.length >= 10 ? d.slice(-10) : (d || null)
}

function deriveDirection(c: OnPbxRawCall): "INCOMING" | "OUTGOING" {
  const acc = (c.accountcode || "").toLowerCase()
  if (acc.includes("in")) return "INCOMING"
  if (acc.includes("out")) return "OUTGOING"
  // Fallback heuristic: external numbers are 7+ digits, internal exts are 3-4
  const callerLen = (c.caller_id_number || "").replace(/\D/g, "").length
  return callerLen <= 4 ? "OUTGOING" : "INCOMING"
}

export async function runStage1PbxDelta(
  db: PrismaClient,
  tenant: LoadedTenant,
  windowStart: Date,
  windowEnd: Date
): Promise<Stage1Result> {
  console.log(`[1] PBX delta tenant=${tenant.name} ${windowStart.toISOString()}..${windowEnd.toISOString()}`)
  const calls = await tenant.adapter.fetchHistoryRange(windowStart, windowEnd)
  console.log(`[1] PBX returned ${calls.length} calls`)

  const result: Stage1Result = {
    fetched: calls.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    unmatchedExt: new Set(),
  }

  // Pre-load Manager.internalExtension → id map (raw — schema model is fine here)
  const managers = await db.$queryRawUnsafe<{ id: string; internalExtension: string }[]>(
    `SELECT id, "internalExtension" FROM "Manager"
     WHERE "tenantId" = $1 AND "internalExtension" IS NOT NULL`,
    tenant.id
  )
  const extToManagerId = new Map(managers.map((m) => [m.internalExtension, m.id]))

  for (const c of calls) {
    if (!c.uuid) { result.skipped++; continue }
    const direction = deriveDirection(c)
    const managerExt = direction === "OUTGOING" ? c.caller_id_number : c.destination_number
    const clientPhoneRaw = direction === "OUTGOING" ? c.destination_number : c.caller_id_number
    const managerId = managerExt ? (extToManagerId.get(String(managerExt)) ?? null) : null
    if (managerExt && !managerId) result.unmatchedExt.add(String(managerExt))

    const startStamp = new Date(c.start_stamp * 1000)
    const existing = await db.$queryRawUnsafe<{ id: string; transcriptionStatus: string | null }[]>(
      `SELECT id, "transcriptionStatus" FROM "CallRecord"
       WHERE "tenantId" = $1 AND "pbxUuid" = $2 LIMIT 1`,
      tenant.id, c.uuid
    )

    if (existing.length === 0) {
      await db.$executeRawUnsafe(
        `INSERT INTO "CallRecord" (
           id, "tenantId", "pbxUuid", "managerId", "managerExt", "clientPhone",
           direction, "startStamp", "createdAt", duration, "userTalkTime",
           "hangupCause", gateway, "qualityScore", "pbxMeta", "transcriptionStatus"
         ) VALUES (
           gen_random_uuid()::text, $1, $2, $3, $4, $5,
           $6::"CallDirection", $7, $7, $8, $9,
           $10, $11, $12, $13::jsonb, 'pending'
         )`,
        tenant.id, c.uuid, managerId, managerExt ? String(managerExt) : null,
        normalizePhone(clientPhoneRaw),
        direction, startStamp,
        c.duration ?? null, c.user_talk_time ?? null,
        c.hangup_cause ?? null, c.gateway ?? null, c.quality_score ?? null,
        JSON.stringify(c)
      )
      result.inserted++
    } else {
      const setStatus = existing[0].transcriptionStatus ? "" : `, "transcriptionStatus" = 'pending'`
      await db.$executeRawUnsafe(
        `UPDATE "CallRecord" SET
           "managerId" = $1, "managerExt" = $2, "clientPhone" = $3,
           direction = $4::"CallDirection", "startStamp" = $5, duration = $6,
           "userTalkTime" = $7, "hangupCause" = $8, gateway = $9, "qualityScore" = $10,
           "pbxMeta" = $11::jsonb${setStatus}
         WHERE id = $12`,
        managerId, managerExt ? String(managerExt) : null, normalizePhone(clientPhoneRaw),
        direction, startStamp, c.duration ?? null,
        c.user_talk_time ?? null, c.hangup_cause ?? null, c.gateway ?? null, c.quality_score ?? null,
        JSON.stringify(c), existing[0].id
      )
      result.updated++
    }
  }

  if (result.unmatchedExt.size > 0) {
    console.warn(`[1] unmatched manager extensions: ${[...result.unmatchedExt].join(",")}`)
  }
  console.log(`[1] inserted=${result.inserted} updated=${result.updated} skipped=${result.skipped}`)
  return result
}
