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
  maxPages?: number           // default 200 — GC streamContactsByDateRange ignores
                              //   date filter on later pages and walks the entire
                              //   history. Cap protects cron cycle from running 30+ min.
  saturationStopAfter?: number // default 30 — stop early when matched count hasn't
                               //   grown for N consecutive pages (page-by-page
                               //   processing of unrelated rows past our window)
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

  const saturationLimit = input.saturationStopAfter ?? 30
  let lastMatchedSeen = 0
  let pagesWithoutNewMatch = 0
  const stopErr = new Error("STAGE_7_5B_STOP")

  try {
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
        // Don't short-circuit even when gcCallId already matches — Stage 7.5
        // phone-resolve historically wrote a wrong gcContactId, so we must
        // re-parse and overwrite. Track 'alreadyLinked' for telemetry only.
        if (pbxRow.gcCallId === gcCallId) stats.alreadyLinked++

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

        // gcContactId from call-detail HTML is the AUTHORITATIVE source.
        // Stage 7.5 phone-resolve via /pl/user/contact/index returns wrong
        // (generic) IDs for diva (3 IDs spread across 3378 calls), so we
        // OVERWRITE gcContactId here whenever the parser found a real client.
        const updateData: Record<string, unknown> = {
          gcCallId,
          audioUrl: parsed.audioUrl ?? pbxRow.audioUrl,
          talkDuration: parsed.talkDuration,
          gcOutcomeLabel: row.outcomeLabel ?? null,
          gcEndCause: parsed.endCause,
          gcCallCardUrl,
          gcDeepLinkType: "call_card",
        }
        if (parsed.clientGcUserId) {
          updateData.gcContactId = parsed.clientGcUserId
          if (parsed.clientName) updateData.clientName = parsed.clientName
        }
        await db.callRecord.update({ where: { id: pbxRow.id }, data: updateData })
        stats.matched++
      }

      console.log(
        `[3.5b p=${pageNum}] grid=${stats.gridRowsSeen} ` +
        `parsed=${stats.detailsParsed} matched=${stats.matched} ` +
        `unmatched=${stats.unmatched} already=${stats.alreadyLinked} ` +
        `failed=${stats.detailsFailed}`
      )

      // Saturation early-stop: if we've made no new PBX matches for N pages,
      // remaining grid rows are GC calls that don't belong to this window.
      // GC ignores date filter on later pages, so without this guard the cron
      // cycle runs for 30+ min walking the entire account history.
      if (stats.matched > lastMatchedSeen) {
        lastMatchedSeen = stats.matched
        pagesWithoutNewMatch = 0
      } else {
        pagesWithoutNewMatch++
        if (pagesWithoutNewMatch >= saturationLimit) {
          console.log(
            `[3.5b] saturation: ${saturationLimit} consecutive pages without new matches — stopping early`
          )
          throw stopErr
        }
      }
    },
    {
      perPage: input.perPage ?? 50,
      rateLimitMs: input.rateLimitMs ?? 1000,
      maxPages: input.maxPages ?? 200,
    }
  )
  } catch (e) {
    if (e !== stopErr) throw e
  }

  return stats
}
