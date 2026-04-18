/**
 * Parser for GetCourse /pl/user/user/index HTML table.
 * Source HTML: Yii2 Krajee GridView (kv-grid-table).
 *
 * Row attributes:
 *   <tr data-user-id="..." data-key="...">
 *
 * Columns parsed by data-col-seq:
 *   0  → avatar
 *   1  → display name (link)
 *   2  → email + verification badge
 *   3  → role ("администратор", "ученик", "куратор", etc)
 *   4  → status ("Активен", "Заблокирован")
 *   5  → email status ("Подтвержден")
 *   6  → phone
 */

export interface ParsedGcUser {
  crmId: string
  name: string
  email: string | null
  role: string
  isActive: boolean
  emailVerified: boolean
  phone: string | null
}

/**
 * Heuristic: GetCourse role labels that typically indicate sales staff or
 * managers we want to track in dashboards. "ученик" (student) is the buyer side.
 */
export const SALES_LIKE_ROLES = new Set([
  "администратор",
  "учитель",
  "куратор",
  "менеджер",
  "руководитель",
  "техадмин",
  "специалист",
])

export function isSalesRole(role: string): boolean {
  const lower = role.toLowerCase().trim()
  for (const r of SALES_LIKE_ROLES) {
    if (lower.includes(r)) return true
  }
  return false
}

export function parseUserList(html: string): ParsedGcUser[] {
  const users: ParsedGcUser[] = []

  // Some user rows have data-user-id == data-key (matches the user id in both attrs).
  const rowRegex =
    /<tr[^>]*\bdata-user-id="(\d+)"[^>]*\bdata-key="(\d+)"[^>]*>([\s\S]*?)<\/tr>/g

  let match: RegExpExecArray | null
  while ((match = rowRegex.exec(html)) !== null) {
    const userId = match[1]
    const keyId = match[2]
    if (userId !== keyId) continue // only true user rows

    const rowHtml = match[3]
    const cells = extractCells(rowHtml)

    users.push({
      crmId: userId,
      name: extractName(cells[1] ?? ""),
      email: extractEmail(cells[2] ?? ""),
      role: stripTags(cells[3] ?? "").trim(),
      isActive: extractIsActive(cells[4] ?? ""),
      emailVerified: extractEmailVerified(cells[2] ?? ""),
      phone: stripTags(cells[6] ?? "").trim() || null,
    })
  }

  return users
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

function extractName(cellHtml: string): string {
  const match = cellHtml.match(/<a[^>]*>([^<]+)<\/a>/)
  return match ? match[1].trim() : ""
}

function extractEmail(cellHtml: string): string | null {
  const match = cellHtml.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)
  return match ? match[0] : null
}

function extractIsActive(cellHtml: string): boolean {
  return /Активен/i.test(stripTags(cellHtml))
}

function extractEmailVerified(cellHtml: string): boolean {
  return /chevron-circle-down/i.test(cellHtml) || /Эл\. адрес подтвержден/i.test(cellHtml)
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ")
}
