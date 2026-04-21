/**
 * Parser for GetCourse /pl/sales/deal HTML table.
 * Source HTML: Yii2 Krajee GridView (kv-grid-table).
 *
 * Row attributes used:
 *   <tr data-deal-id="..." data-user-id="..." data-key="...">
 *
 * Columns parsed by data-col-seq:
 *   0  → display number (link to /sales/control/deal/update/id/{id})
 *   1  → relative date ("3 минуты назад") — best-effort, absolute date is in detail
 *   2  → client name + user link
 *   3  → title (deal name)
 *   4  → status badge (deal-status status-{name})
 *   5  → amount ("0 руб.", "1 234,56 руб.")
 *
 * NOTE: Manager is NOT in this view. Manager attribution is derived from CallRecord
 * (contact-list parser) which DOES include manager column.
 */

export interface ParsedDeal {
  crmId: string                  // URL id from cell[0] href /sales/control/deal/update/id/{X} — this is what the deal page actually uses
  gridKey: string | null         // data-deal-id attribute (Yii2 grid row key) — kept for legacy match during backfill
  clientUserId: string           // data-user-id (the buyer)
  displayNumber: string | null   // human-friendly number (e.g. "2673743") — text inside cell[0] anchor
  title: string                  // "[Пришел] Вебинар "ПРЕО"..."
  amount: number | null          // 0, 1234.56
  amountCurrency: "RUB"          // GetCourse always RUB by default
  status: GcDealStatus           // mapped from CSS class
  statusLabel: string            // "Завершен", "Новый", "В работе"
  clientName: string | null      // "Вероника"
  relativeDate: string | null    // "3 минуты назад" (raw)
}

export type GcDealStatus =
  | "new"
  | "in_work"
  | "payment_waiting"
  | "payed"
  | "cancelled"
  | "refunded"
  | "completed"
  | "unknown"

const STATUS_CLASS_MAP: Record<string, GcDealStatus> = {
  "status-new": "new",
  "status-in_work": "in_work",
  "status-inprocess": "in_work",
  "status-payment_waiting": "payment_waiting",
  "status-pwait": "payment_waiting",
  "status-payed": "payed",
  "status-cancelled": "cancelled",
  "status-cancel": "cancelled",
  "status-refunded": "refunded",
  "status-completed": "completed",
}

/**
 * Map GetCourse status to our unified Deal.status enum.
 */
export function gcStatusToUnified(
  status: GcDealStatus
): "open" | "won" | "lost" {
  if (status === "payed" || status === "completed") return "won"
  if (status === "cancelled" || status === "refunded") return "lost"
  return "open"
}

/**
 * Parse a full deals listing page. Returns ALL rows found.
 * Returns empty array if no rows match (caller should check size).
 */
export function parseDealList(html: string): ParsedDeal[] {
  const deals: ParsedDeal[] = []
  // Each row starts with <tr ... data-deal-id="..."> and ends with </tr>.
  // Use a non-greedy match scoped between data-deal-id and the next </tr>.
  // Real GetCourse markup has data-user-id BEFORE data-deal-id; capture both
  // separately so attribute order doesn't matter.
  const rowRegex =
    /<tr\b[^>]*\bdata-deal-id="(\d+)"[^>]*>([\s\S]*?)<\/tr>/g

  let match: RegExpExecArray | null
  while ((match = rowRegex.exec(html)) !== null) {
    const gridKey = match[1]
    const fullTagAndBody = html.slice(match.index, match.index + match[0].length)
    const userIdMatch = fullTagAndBody.match(/<tr\b[^>]*\bdata-user-id="(\d+)"/)
    const userId = userIdMatch ? userIdMatch[1] : ""
    const rowHtml = match[2]

    const cells = extractCells(rowHtml)
    // The URL id is embedded in cell[0]'s anchor href:
    //   <a href="/sales/control/deal/update/id/828629509">25428</a>
    // That 828629509 is the real deal id used by the GC deal page; data-deal-id
    // is a Yii2 grid row key that happens to be a different number.
    const urlDealId = extractUrlDealId(cells[0] ?? "")
    if (!urlDealId) continue

    deals.push({
      crmId: urlDealId,
      gridKey,
      clientUserId: userId,
      displayNumber: parseDisplayNumber(cells[0] ?? ""),
      title: extractTitle(cells[3] ?? ""),
      amount: parseAmount(cells[5] ?? ""),
      amountCurrency: "RUB",
      status: parseStatus(cells[4] ?? ""),
      statusLabel: extractStatusLabel(cells[4] ?? ""),
      clientName: extractClientName(cells[2] ?? ""),
      relativeDate: stripTags(cells[1] ?? "").trim() || null,
    })
  }

  return deals
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

function parseDisplayNumber(cellHtml: string): string | null {
  const match = cellHtml.match(/>([\d]+)</)
  return match ? match[1] : null
}

function extractUrlDealId(cellHtml: string): string | null {
  const match = cellHtml.match(/\/sales\/control\/deal\/update\/id\/(\d+)/)
  return match ? match[1] : null
}

function extractTitle(cellHtml: string): string {
  // Prefer text inside <a>, fall back to all-text
  const anchorMatch = cellHtml.match(/<a[^>]*>([\s\S]*?)<\/a>/)
  const raw = anchorMatch ? anchorMatch[1] : cellHtml
  return stripTags(raw).replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim()
}

function parseAmount(cellHtml: string): number | null {
  // "0 руб.", "1 234,56 руб.", "12345 руб."
  const text = stripTags(cellHtml).replace(/\s+/g, "").replace(/руб\.?/i, "")
  if (!text) return null
  const normalized = text.replace(",", ".")
  const n = Number.parseFloat(normalized)
  return Number.isFinite(n) ? n : null
}

function parseStatus(cellHtml: string): GcDealStatus {
  for (const [cls, status] of Object.entries(STATUS_CLASS_MAP)) {
    if (cellHtml.includes(cls)) return status
  }
  return "unknown"
}

function extractStatusLabel(cellHtml: string): string {
  const match = cellHtml.match(
    /<span[^>]*deal-status[^>]*>([^<]+)<\/span>/
  )
  return match ? match[1].trim() : ""
}

function extractClientName(cellHtml: string): string | null {
  const match = cellHtml.match(/<span class="text">([^<]+)<\/span>/)
  return match ? match[1].trim() : null
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ")
}
