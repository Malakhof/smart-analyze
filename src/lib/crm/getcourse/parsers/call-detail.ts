/**
 * Parser for GetCourse call detail page:
 *   /user/control/contact/update/id/{gcCallId}
 *
 * Despite the URL using "/contact/", this page is actually the CALL CARD
 * (page header is "Звонок {gcCallId}"). It contains:
 *   - "Уникальный идентификатор звонка: <pbxUuid>"  ← the only reliable PBX↔GC key
 *   - <audio><source src="..."> with fileservice URL for player
 *   - "Продолжительность записи: 1 минуту 12 секунд"  → recordDuration
 *   - "Продолжительность разговора: 36 секунд"        → talkDuration ⭐
 *   - "Причина завершения разговора: Нормальное завершение" → endCause
 *   - <a class="user-profile-link worker" data-user-id="..."> → manager's gcUserId
 *
 * Usage: feed raw HTML body fetched via safeFetch(). Parser is tolerant of
 * tags between the labels and values (GC inserts <span> wrappers).
 */

export interface ParsedCallDetail {
  pbxUuid: string | null
  audioUrl: string | null
  recordDuration: number | null  // seconds
  talkDuration: number | null    // seconds (NEW field, ground truth for "real conversation")
  endCause: string | null
  managerGcUserId: string | null
  managerName: string | null
  clientGcUserId: string | null  // GC user_id of the client — correct source for CallRecord.gcContactId
  clientName: string | null      // displayed name from <span class="text">
}

const PBX_UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

/**
 * Extract pbxUuid after "Уникальный идентификатор звонка:" label.
 * Tolerates HTML tags between label and UUID.
 */
export function extractPbxUuid(html: string): string | null {
  // Look for the label text, then grab the first UUID within next 200 chars
  const labelIdx = html.search(/Уникальный\s+идентификатор\s+звонка/i)
  if (labelIdx === -1) return null
  const tail = html.slice(labelIdx, labelIdx + 400)
  const match = tail.match(PBX_UUID_RE)
  return match ? match[1].toLowerCase() : null
}

/**
 * Extract audio file URL from <source src="..."> or <audio src="...">.
 * GC serves recordings from fs*.getcourse.ru/fileservice/file/...
 */
export function extractAudioUrl(html: string): string | null {
  // Prefer <source> tag inside <audio>
  const sourceMatch = html.match(
    /<source\b[^>]*\bsrc=["']([^"']+\/fileservice\/[^"']+)["']/i
  )
  if (sourceMatch) return sourceMatch[1]

  const audioMatch = html.match(
    /<audio\b[^>]*\bsrc=["']([^"']+\/fileservice\/[^"']+)["']/i
  )
  if (audioMatch) return audioMatch[1]

  return null
}

/**
 * Parse "1 минуту 12 секунд" / "36 секунд" / "1 час 5 минут 30 секунд" → seconds.
 * Returns null if no numeric data found.
 */
export function parseRussianDuration(text: string): number | null {
  if (!text) return null
  let total = 0
  let touched = false

  const hours = text.match(/(\d+)\s*час/i)
  if (hours) {
    total += Number.parseInt(hours[1], 10) * 3600
    touched = true
  }

  const minutes = text.match(/(\d+)\s*минут/i)
  if (minutes) {
    total += Number.parseInt(minutes[1], 10) * 60
    touched = true
  }

  const seconds = text.match(/(\d+)\s*секунд/i)
  if (seconds) {
    total += Number.parseInt(seconds[1], 10)
    touched = true
  }

  return touched ? total : null
}

/**
 * Extract a labeled value from the call detail page.
 * Strips tags between label colon and end of value (GC sometimes wraps numbers).
 */
const NEXT_FIELD_LABELS = [
  /Номер\s+телефона/i,
  /Транскриб/i,
  /Уникальный\s+идентификатор/i,
  /Продолжительность/i,
  /Причина/i,
  /Пользователь/i,
  /Менеджер/i,
  /Тип\s+коммуникации/i,
  /Когда/i,
  /Завершенность/i,
  /Направление/i,
] as const

function extractAfterLabel(html: string, label: RegExp, maxChars = 200): string | null {
  const m = html.search(label)
  if (m === -1) return null
  const tail = html.slice(m, m + maxChars)
  const colonIdx = tail.indexOf(":")
  if (colonIdx === -1) return null
  let raw = tail.slice(colonIdx + 1, colonIdx + maxChars)
  raw = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  if (!raw) return null

  // Cut at next field label or sentence/HTML break — whichever comes first.
  let cutAt = raw.length
  for (const next of NEXT_FIELD_LABELS) {
    const idx = raw.search(next)
    if (idx !== -1 && idx < cutAt) cutAt = idx
  }
  for (const ch of ["\n", "\r", "<"]) {
    const idx = raw.indexOf(ch)
    if (idx !== -1 && idx < cutAt) cutAt = idx
  }
  return raw.slice(0, cutAt).trim() || null
}

export function extractRecordDuration(html: string): number | null {
  const text = extractAfterLabel(html, /Продолжительность\s+записи/i)
  return text ? parseRussianDuration(text) : null
}

export function extractTalkDuration(html: string): number | null {
  const text = extractAfterLabel(html, /Продолжительность\s+разговора/i)
  return text ? parseRussianDuration(text) : null
}

export function extractEndCause(html: string): string | null {
  return extractAfterLabel(html, /Причина\s+завершения\s+разговора/i, 250)
}

/**
 * Extract manager attribution from the call detail page.
 * The manager is shown via <a class="user-profile-link worker" data-user-id="..."><span class="text">Name</span></a>.
 *
 * NOTE: This is the manager assigned by GC's automation (often differs from
 * who actually answered if calls are routed). For sales-attribution, prefer
 * matching by managerExt (PBX SIP extension) — see Manager.internalExtension.
 * Use this field only as a cross-check / for diagnostics.
 */
export function extractManagerFromCallDetail(html: string): {
  managerGcUserId: string | null
  managerName: string | null
} {
  // Find first <a class="user-profile-link worker" ...>
  const linkMatch = html.match(
    /<a\b[^>]*\bclass=["'][^"']*\buser-profile-link\b[^"']*\bworker\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i
  )
  if (!linkMatch) return { managerGcUserId: null, managerName: null }

  const linkTag = linkMatch[0]
  const idMatch = linkTag.match(/\bdata-user-id=["'](\d+)["']/)
  const nameMatch = linkMatch[1].match(/<span\b[^>]*\bclass=["'][^"']*\btext\b[^"']*["'][^>]*>([^<]+)<\/span>/i)

  return {
    managerGcUserId: idMatch ? idMatch[1] : null,
    managerName: nameMatch ? nameMatch[1].trim() : null,
  }
}

/**
 * Extract client (the customer being called) from the call detail page.
 * GC renders the client as the first <a class="user-profile-link"> WITHOUT
 * the "worker" sub-class (the manager link has "user-profile-link worker").
 *
 * Pattern (verified diva 30.04.2026):
 *   Пользователь: <a class="user-profile-link" href="/user/control/user/update/id/454724704"
 *                    data-user-id="454724704" ...>
 *                   <span class="text">Rita Vinnik</span> ...
 *
 * Returns the GC user_id of the client (CORRECT source for CallRecord.gcContactId)
 * — this fixes the Stage 7.5 phone-resolve bug where /pl/user/contact/index?phone=X
 * was returning 1 of 3 generic IDs for the entire diva tenant.
 */
export function extractClientFromCallDetail(html: string): {
  clientGcUserId: string | null
  clientName: string | null
} {
  // Match a non-worker user-profile-link (no `worker` token in class list).
  // We ban "worker" in the same class attr to skip the МОП anchor.
  const re = /<a\b[^>]*\bclass=["']([^"']*\buser-profile-link\b[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) !== null) {
    const classAttr = match[1]
    if (/\bworker\b/.test(classAttr)) continue   // skip manager link
    const linkTag = match[0]
    const idMatch = linkTag.match(/\bdata-user-id=["'](\d+)["']/)
      ?? linkTag.match(/\/user\/control\/user\/update\/id\/(\d+)/)
    const nameMatch = match[2].match(/<span\b[^>]*\bclass=["'][^"']*\btext\b[^"']*["'][^>]*>([^<]+)<\/span>/i)
    if (idMatch) {
      return {
        clientGcUserId: idMatch[1],
        clientName: nameMatch ? nameMatch[1].trim() : null,
      }
    }
  }
  return { clientGcUserId: null, clientName: null }
}

/**
 * Parse all relevant fields from the call detail HTML in one pass.
 */
export function parseCallDetail(html: string): ParsedCallDetail {
  const { managerGcUserId, managerName } = extractManagerFromCallDetail(html)
  const { clientGcUserId, clientName } = extractClientFromCallDetail(html)
  return {
    pbxUuid: extractPbxUuid(html),
    audioUrl: extractAudioUrl(html),
    recordDuration: extractRecordDuration(html),
    talkDuration: extractTalkDuration(html),
    endCause: extractEndCause(html),
    managerGcUserId,
    managerName,
    clientGcUserId,
    clientName,
  }
}
