/**
 * Parser for GetCourse /pl/user/contact/index HTML table.
 * Source HTML: Yii2 Krajee GridView (kv-grid-table).
 *
 * Row attributes used:
 *   <tr data-user-id="..." data-key="...">  // data-key = contact id
 *
 * Columns parsed by data-col-seq:
 *   0  → contact id link
 *   1  → client name + user link (data-col-seq=1 also says "Отображаемое имя")
 *   2  → absolute date "18 апр. 2026 21:07"
 *   3  → direction ("Исходящий"/"Входящий") + linked deal id + deal status
 *   4  → outcome label ("Не состоялся", "Звонок состоялся", etc)
 *   5  → tags
 *   6  → MANAGER name + link to user (data-user-id is manager's id)
 *   7  → audio file URL
 *   8  → client phone
 *   9  → manager phone
 */

export interface ParsedContact {
  crmId: string                    // data-key (contact id, e.g. "208132646")
  clientUserId: string             // data-user-id (the customer)
  callDate: Date | null            // parsed from absolute date in col 2
  direction: "income" | "outcome" | "other"
  linkedDealId: string | null      // deal id this call is attached to
  outcomeLabel: string | null      // "Не состоялся", "Состоялся"
  managerCrmId: string | null      // GC user id of manager
  managerName: string | null
  audioUrl: string | null
  clientPhone: string | null
  managerPhone: string | null
  rawDateText: string | null
}

const RU_MONTHS: Record<string, number> = {
  "янв": 0, "фев": 1, "мар": 2, "апр": 3, "май": 4, "июн": 5,
  "июл": 6, "авг": 7, "сен": 8, "окт": 9, "ноя": 10, "дек": 11,
}

/**
 * Parse "18 апр. 2026 21:07" → Date.
 * Returns null if pattern doesn't match.
 */
export function parseRussianDate(text: string): Date | null {
  // Match: "18 апр. 2026 21:07" or without time "18 апр. 2026"
  const match = text.match(
    /(\d{1,2})\s+([а-яё]{3,})[.\s]+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/i
  )
  if (!match) return null

  const day = Number.parseInt(match[1], 10)
  const monthKey = match[2].slice(0, 3).toLowerCase()
  const month = RU_MONTHS[monthKey]
  if (month === undefined) return null
  const year = Number.parseInt(match[3], 10)
  const hh = match[4] ? Number.parseInt(match[4], 10) : 0
  const mm = match[5] ? Number.parseInt(match[5], 10) : 0

  return new Date(year, month, day, hh, mm)
}

export function parseContactList(html: string): ParsedContact[] {
  const contacts: ParsedContact[] = []

  // Contact rows have data-user-id (client) AND data-key (contact id) but NO data-deal-id.
  // Distinguish from deal rows by absence of data-deal-id.
  const rowRegex =
    /<tr[^>]*\bdata-user-id="(\d+)"[^>]*\bdata-key="(\d+)"[^>]*>([\s\S]*?)<\/tr>/g

  let match: RegExpExecArray | null
  while ((match = rowRegex.exec(html)) !== null) {
    const userId = match[1]
    const contactId = match[2]
    const rowHtml = match[3]

    // Skip if this row is actually a deal row (has data-deal-id)
    if (/\bdata-deal-id="/.test(html.slice(match.index, match.index + 200))) {
      continue
    }

    const cells = extractCells(rowHtml)

    contacts.push({
      crmId: contactId,
      clientUserId: userId,
      callDate: parseRussianDate(stripTags(cells[2] ?? "")),
      rawDateText: stripTags(cells[2] ?? "").trim() || null,
      direction: parseDirection(cells[3] ?? ""),
      linkedDealId: extractLinkedDealId(cells[3] ?? ""),
      outcomeLabel: extractOutcomeLabel(cells[4] ?? ""),
      ...extractManager(cells[6] ?? ""),
      audioUrl: extractAudioUrl(cells[7] ?? ""),
      clientPhone: stripTags(cells[8] ?? "").trim() || null,
      managerPhone: stripTags(cells[9] ?? "").trim() || null,
    })
  }

  return contacts
}

function extractCells(rowHtml: string): string[] {
  const cells: string[] = []
  const cellRegex = /<td[^>]*\bdata-col-seq="(\d+)"[^>]*>([\s\S]*?)<\/td>/g
  let match: RegExpExecArray | null
  while ((match = cellRegex.exec(rowHtml)) !== null) {
    const idx = Number.parseInt(match[1], 10)
    cells[idx] = match[2]
  }
  return cells
}

function parseDirection(cellHtml: string): "income" | "outcome" | "other" {
  const text = stripTags(cellHtml).toLowerCase()
  if (text.includes("исходящ")) return "outcome"
  if (text.includes("входящ")) return "income"
  return "other"
}

function extractLinkedDealId(cellHtml: string): string | null {
  const match = cellHtml.match(/\/sales\/control\/deal\/update\/id\/(\d+)/)
  return match ? match[1] : null
}

function extractOutcomeLabel(cellHtml: string): string | null {
  const match = cellHtml.match(/<div class="label[^>]*>([^<]+)<\/div>/)
  return match ? match[1].trim() : null
}

function extractManager(cellHtml: string): {
  managerCrmId: string | null
  managerName: string | null
} {
  // <a class="user-profile-link worker" href="/user/control/user/update/id/257915635" data-user-id="257915635" ...>
  //   <span class="text">Вероника Эйрих</span>
  // </a>
  const idMatch = cellHtml.match(/data-user-id="(\d+)"/)
  const nameMatch = cellHtml.match(/<span class="text">([^<]+)<\/span>/)
  return {
    managerCrmId: idMatch ? idMatch[1] : null,
    managerName: nameMatch ? nameMatch[1].trim() : null,
  }
}

function extractAudioUrl(cellHtml: string): string | null {
  // GetCourse may render audio as: <audio><source src="..."> or just a link <a href="...mp3">
  const match = cellHtml.match(/(https?:\/\/[^\s"'<]+\.(?:mp3|wav|ogg|m4a))/i)
  if (match) return match[1]
  // Sometimes it's a relative path /fileservice/file/play/...
  const relMatch = cellHtml.match(/(?:src|href)="(\/fileservice\/[^"]+)"/)
  return relMatch ? relMatch[1] : null
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ")
}
