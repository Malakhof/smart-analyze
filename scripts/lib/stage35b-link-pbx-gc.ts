/**
 * stage35b-link-pbx-gc.ts — Stage 3.5b of cron-master-pipeline.
 *
 * For every fresh CallRecord (PBX side) that has no gcCallId yet, walk
 * the GC contacts grid for the same time window and match via pbxUuid
 * (the only reliable PBX↔GC join key). On match, fill gcCallId, audioUrl,
 * talkDuration, gcOutcomeLabel, gcEndCause and the call-card deep link.
 *
 * Why this is its own stage (not folded into Stage 7.5):
 *  - Stage 7.5 resolves PHONE → gcContactId via /pl/user/contact/index.
 *    This stage walks /pl/user/contact/index ALSO (for the time window),
 *    but parses the call-detail page per row to extract pbxUuid.
 *  - The two queries can run in any order; gcContactId is for the client,
 *    gcCallId is for the call card itself.
 *
 * Algorithm (mirrors scripts/sync-gc-call-details.ts batch backfill):
 *   1. Stream GC contacts grid for [from..to] page-by-page.
 *   2. For each row: GET /user/control/contact/update/id/{gcCallId},
 *      parse pbxUuid + audio + talkDuration + endCause.
 *   3. Find local CallRecord by pbxUuid → UPDATE the GC fields.
 *   4. Track unmatched rows for Stage 9 reconciliation.
 */
import type { PrismaClient } from "../../src/generated/prisma/client"
import { GetCourseAdapter } from "../../src/lib/crm/getcourse/adapter"
import { safeFetch } from "../../src/lib/crm/getcourse/safe-fetch"
import { parseCallDetail } from "../../src/lib/crm/getcourse/parsers/call-detail"

export interface Stage35bInput {
  db: PrismaClient
  tenantId: string
  baseUrl: string             // e.g. "https://web.diva.school"
  cookie: string              // decrypted GC cookie
  windowStart: Date
  windowEnd: Date
  rateLimitMs?: number        // default 1000
  perPage?: number            // default 50
}

export interface Stage35bResult {
  gridRowsSeen: number
  detailsParsed: number
  detailsFailed: number
  matched: number
  unmatched: number
  alreadyLinked: number
  managerCrossCheck: { ok: number; mismatch: number }
}

export async function linkPbxCallsToGc(input: Stage35bInput): Promise<Stage35bResult> {
  const { db, tenantId, baseUrl, cookie } = input
  const adapter = new GetCourseAdapter(baseUrl, cookie)

  const stats: Stage35bResult = {
    gridRowsSeen: 0,
    detailsParsed: 0,
    detailsFailed: 0,
    matched: 0,
    unmatched: 0,
    alreadyLinked: 0,
    managerCrossCheck: { ok: 0, mismatch: 0 },
  }

  await adapter.streamContactsByDateRange(
    input.windowStart,
    input.windowEnd,
    async (rows, pageNum) => {
      stats.gridRowsSeen += rows.length
      for (const row of rows) {
        const gcCallId = row.crmId
        if (!gcCallId) continue

        const detailUrl = `${baseUrl}/user/control/contact/update/id/${gcCallId}`
        let detailHtml: string
        try {
          const resp = await safeFetch(detailUrl, { cookie })
          detailHtml = resp.html
        } catch (e) {
          stats.detailsFailed++
          console.warn(`[3.5b detail-fail] gcCallId=${gcCallId} err=${(e as Error).message}`)
          continue
        }

        const parsed = parseCallDetail(detailHtml)
        stats.detailsParsed++

        if (!parsed.pbxUuid) continue   // GC card has no pbxUuid (legacy / non-PBX)

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

        if (parsed.managerGcUserId && pbxRow.managerId) {
          const mgr = await db.manager.findFirst({ where: { id: pbxRow.managerId } })
          if (mgr?.gcUserId) {
            if (mgr.gcUserId === parsed.managerGcUserId) {
              stats.managerCrossCheck.ok++
            } else {
              stats.managerCrossCheck.mismatch++
              console.warn(
                `[3.5b mgr-mismatch] pbxUuid=${parsed.pbxUuid} ` +
                `pbxMgr=${mgr.name}(gcUid=${mgr.gcUserId}) ` +
                `gcMgr=${parsed.managerName}(gcUid=${parsed.managerGcUserId})`
              )
            }
          } else if (mgr) {
            // opportunistic Manager.gcUserId backfill
            await db.manager.update({
              where: { id: mgr.id },
              data: { gcUserId: parsed.managerGcUserId },
            })
          }
        }

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
        `[3.5b p=${pageNum}] grid=${stats.gridRowsSeen} ` +
        `parsed=${stats.detailsParsed} matched=${stats.matched} ` +
        `unmatched=${stats.unmatched} already=${stats.alreadyLinked} ` +
        `failed=${stats.detailsFailed}`
      )
    },
    { perPage: input.perPage ?? 50, rateLimitMs: input.rateLimitMs ?? 1000 }
  )

  return stats
}
