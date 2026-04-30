/**
 * Backfill: link existing CallRecord rows (PBX sync) to their counterpart in
 * GetCourse (GC sync) by pbxUuid, and pull audio/talkDuration/endCause.
 *
 * Discovery (2026-04-29 diva): GC stores pbxUuid in plain text on the call
 * detail page ("Уникальный идентификатор звонка: <uuid>"). This is the only
 * reliable PBX↔GC matching key — phone+date is ambiguous and durations differ.
 *
 * Algorithm:
 *   1. Stream GC contact-list grid for date range (returns gcCallId = data-key)
 *   2. For each row, fetch detail page, parse pbxUuid + audio + talkDuration
 *   3. UPDATE CallRecord WHERE pbxUuid = <parsed> SET gcCallId=..., audioUrl=...
 *
 * Usage:
 *   tsx scripts/sync-gc-call-details.ts <tenantId> <YYYY-MM-DD from> <YYYY-MM-DD to>
 *
 * Example:
 *   tsx scripts/sync-gc-call-details.ts cmo4qkb1000000jo432rh0l3u 2026-04-24 2026-04-27
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { GetCourseAdapter } from "../src/lib/crm/getcourse/adapter"
import { safeFetch } from "../src/lib/crm/getcourse/safe-fetch"
import { parseCallDetail } from "../src/lib/crm/getcourse/parsers/call-detail"
import { decrypt } from "../src/lib/crypto"

interface Stats {
  gridRowsSeen: number
  detailsParsed: number
  detailsFailed: number
  matched: number
  unmatched: number
  alreadyLinked: number
  managerCrossCheck: { ok: number; mismatch: number }
}

async function main() {
  const [tenantId, fromStr, toStr] = process.argv.slice(2)
  if (!tenantId || !fromStr || !toStr) {
    console.error(
      "Usage: tsx scripts/sync-gc-call-details.ts <tenantId> <from YYYY-MM-DD> <to YYYY-MM-DD>"
    )
    process.exit(1)
  }
  const from = new Date(`${fromStr}T00:00:00Z`)
  const to = new Date(`${toStr}T23:59:59Z`)

  const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter: adapterPg })

  const config = await db.crmConfig.findFirst({
    where: { tenantId, provider: "GETCOURSE", isActive: true },
  })
  if (!config?.gcCookie || !config.subdomain) {
    console.error(`No active GETCOURSE config for tenant ${tenantId}`)
    process.exit(1)
  }
  // gcCookie may be encrypted (iv:tag:enc) or stored as plain Cookie header.
  // Detect by structure: encrypted form is exactly 3 hex segments split by ":".
  const cookieRaw = config.gcCookie
  const looksEncrypted = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i.test(cookieRaw)
  const cookie = looksEncrypted ? decrypt(cookieRaw) : cookieRaw
  const host = config.subdomain.includes(".")
    ? config.subdomain
    : `${config.subdomain}.getcourse.ru`
  const baseUrl = `https://${host}`
  const adapter = new GetCourseAdapter(baseUrl, cookie)

  console.log(`[start] tenant=${tenantId} range=${fromStr}..${toStr}`)
  console.log(`[start] host=${host}`)

  const stats: Stats = {
    gridRowsSeen: 0,
    detailsParsed: 0,
    detailsFailed: 0,
    matched: 0,
    unmatched: 0,
    alreadyLinked: 0,
    managerCrossCheck: { ok: 0, mismatch: 0 },
  }

  await adapter.streamContactsByDateRange(
    from,
    to,
    async (rows, pageNum) => {
      stats.gridRowsSeen += rows.length
      for (const row of rows) {
        const gcCallId = row.crmId
        if (!gcCallId) continue

        // Fetch detail page
        const detailUrl = `${baseUrl}/user/control/contact/update/id/${gcCallId}`
        let detailHtml: string
        try {
          const resp = await safeFetch(detailUrl, { cookie })
          detailHtml = resp.html
        } catch (e) {
          stats.detailsFailed++
          console.warn(`[detail-fail] gcCallId=${gcCallId} err=${(e as Error).message}`)
          continue
        }

        const parsed = parseCallDetail(detailHtml)
        stats.detailsParsed++

        if (!parsed.pbxUuid) {
          // GC card has no pbxUuid (legacy or non-PBX call) — skip
          continue
        }

        // Find PBX-side CallRecord with this pbxUuid
        const pbxRow = await db.callRecord.findFirst({
          where: { tenantId, pbxUuid: parsed.pbxUuid },
        })
        if (!pbxRow) {
          stats.unmatched++
          continue
        }

        if (pbxRow.gcCallId === gcCallId) {
          stats.alreadyLinked++
          continue
        }

        // Cross-check manager attribution (informational only — we trust
        // PBX ext as primary source per Manager.internalExtension)
        if (parsed.managerGcUserId && pbxRow.managerId) {
          const mgr = await db.manager.findFirst({
            where: { id: pbxRow.managerId },
          })
          if (mgr?.gcUserId) {
            if (mgr.gcUserId === parsed.managerGcUserId) {
              stats.managerCrossCheck.ok++
            } else {
              stats.managerCrossCheck.mismatch++
              console.warn(
                `[mgr-mismatch] pbxUuid=${parsed.pbxUuid} ` +
                `pbxMgr=${mgr.name}(gcUid=${mgr.gcUserId}) ` +
                `gcMgr=${parsed.managerName}(gcUid=${parsed.managerGcUserId})`
              )
            }
          } else if (mgr) {
            // Backfill Manager.gcUserId opportunistically
            await db.manager.update({
              where: { id: mgr.id },
              data: { gcUserId: parsed.managerGcUserId },
            })
          }
        }

        // Build correct gcCallCardUrl now that we have the right ID
        const gcCallCardUrl = `${baseUrl}/user/control/contact/update/id/${gcCallId}`

        await db.callRecord.update({
          where: { id: pbxRow.id },
          data: {
            gcCallId,
            audioUrl: parsed.audioUrl ?? pbxRow.audioUrl,
            talkDuration: parsed.talkDuration,
            gcOutcomeLabel: row.outcomeLabel ?? null,
            gcEndCause: parsed.endCause,
            gcCallCardUrl,
            gcDeepLinkType: "call_card",
          },
        })
        stats.matched++
      }

      console.log(
        `[p=${pageNum}] grid=${stats.gridRowsSeen} ` +
        `parsed=${stats.detailsParsed} matched=${stats.matched} ` +
        `unmatched=${stats.unmatched} already=${stats.alreadyLinked} ` +
        `failed=${stats.detailsFailed}`
      )
    },
    { perPage: 50, rateLimitMs: 1000 }
  )

  console.log("\n[done] final stats:")
  console.log(JSON.stringify(stats, null, 2))

  // How many PBX rows still have no gcCallId in this range?
  const stillMissing = await db.callRecord.count({
    where: {
      tenantId,
      startStamp: { gte: from, lte: to },
      transcript: { not: null },
      gcCallId: null,
    },
  })
  console.log(`[remaining] PBX rows with transcript but no gcCallId: ${stillMissing}`)

  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
