/**
 * GetCourse filter builder for Krajee dialog rule_string parameter.
 *
 * Confirmed in pre-flight diva.school 2026-04-18: GetCourse list pages accept
 * a URL param like `DealContext[rule_string]={...JSON...}` (URL-encoded) where
 * JSON describes one or more filter rules.
 *
 * Date format MUST be DD.MM.YYYY (Russian convention used by GetCourse UI).
 */

export type FilterContext = "deal" | "contact"

interface DateRangeRule {
  type: "deal_created_at" | "contact_created_at"
  inverted: 0
  params: {
    value: {
      from: string
      to: string
      toNDays: null
      fromNDays: null
      dateType: null
      withTime: false
    }
    valueMode: null
  }
  maxSize: ""
}

/**
 * Format a Date as DD.MM.YYYY (no leading zero stripping; matches GC UI).
 */
function formatDdMmYyyy(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0")
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const yyyy = date.getFullYear()
  return `${dd}.${mm}.${yyyy}`
}

function buildDateRangeRule(
  context: FilterContext,
  from: Date,
  to: Date
): DateRangeRule {
  return {
    type: context === "deal" ? "deal_created_at" : "contact_created_at",
    inverted: 0,
    params: {
      value: {
        from: formatDdMmYyyy(from),
        to: formatDdMmYyyy(to),
        toNDays: null,
        fromNDays: null,
        dateType: null,
        withTime: false,
      },
      valueMode: null,
    },
    maxSize: "",
  }
}

/**
 * Build a full filtered list URL.
 *
 * Example:
 *   buildDateFilteredUrl("https://web.diva.school", "deal", new Date("2026-01-18"), new Date("2026-04-18"))
 *   → "https://web.diva.school/pl/sales/deal/index?DealContext[segment_id]=0&DealContext[rule_string]=..."
 */
export function buildDateFilteredUrl(
  accountUrl: string,
  context: FilterContext,
  from: Date,
  to: Date
): string {
  const path =
    context === "deal" ? "/pl/sales/deal/index" : "/pl/user/contact/index"
  const contextKey = context === "deal" ? "DealContext" : "ContactContext"

  const rule = buildDateRangeRule(context, from, to)
  const ruleJson = JSON.stringify(rule)

  const params = new URLSearchParams()
  params.set(`${contextKey}[segment_id]`, "0")
  params.set(`${contextKey}[rule_string]`, ruleJson)

  return `${accountUrl}${path}?${params.toString()}`
}

/**
 * Convert "Всего записей: 1,234,567" string from GetCourse list page footer
 * into a number. Returns null if pattern not found.
 *
 * GetCourse uses Krajee dialog with a confirmation message containing the total.
 */
export function parseTotalRecords(html: string): number | null {
  const match = html.match(/Всего записей:\s*([\d\s,.]+)/)
  if (!match) return null
  const cleaned = match[1].replace(/[\s,.]/g, "")
  const n = Number.parseInt(cleaned, 10)
  return Number.isFinite(n) ? n : null
}
