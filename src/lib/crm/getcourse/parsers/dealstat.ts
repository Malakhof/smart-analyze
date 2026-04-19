/**
 * Parser for GetCourse sales statistics (готовые агрегации продаж).
 * Source: POST /pl/sales/dealstat/chartdata
 *   Content-Type: application/x-www-form-urlencoded
 *   Body: rule_string={Krajee filter JSON}&locationId=0&...
 *   Returns: { success, chartData: {...}, tableHtml: "..." }
 *
 * Wave 1 #16 — gold mine for РОПовский dashboard.
 *
 * Verified diva.school 2026-04-19 with empty filter (all-time):
 *   - 24,675 заказов создано / 277.7M₽ заработано
 *   - 71 monthly data points (2020.05 → 2026.04)
 *   - 4 metric series (created/paid/payment-sum/avg-check)
 *
 * Each filter param applies cumulatively: rule_string for date/manager/product,
 * locationId for site/account scope.
 */

export interface DealStatTotals {
  /** "Заказов создано" — orders created in selected period */
  ordersCreatedCount: number | null
  ordersCreatedAmount: number | null   // sum of created orders (rub, kopecks-truncated)
  /** "Заказов оплачено" — orders paid */
  ordersPaidCount: number | null
  ordersPaidAmount: number | null
  /** "Купило пользователей" — unique buyers */
  buyersCount: number | null
  /** "Число предоплат" — partial prepayments */
  prepaymentsCount: number | null
  prepaymentsAmount: number | null
  /** "Сумма налогов" / "Сумма комиссий" — deductions */
  taxAmount: number | null
  commissionAmount: number | null
  /** "Заработано" — net earned (после комиссий и налогов) */
  earnedAmount: number | null
}

export interface DealStatSeriesPoint {
  /** Month label as "YYYY.MM" (e.g. "2026.04") */
  month: string
  value: number
}

export interface DealStatSeries {
  name: string                          // e.g. "Создано заказов"
  points: DealStatSeriesPoint[]
}

export interface ParsedDealStat {
  totals: DealStatTotals
  series: DealStatSeries[]              // chart series with monthly points
  rawJson: unknown
  rawTableHtml: string
}

/**
 * Parse the JSON envelope returned by /pl/sales/dealstat/chartdata.
 * Extracts both the totals table and the chart series.
 */
export function parseDealStat(json: unknown): ParsedDealStat {
  const empty: ParsedDealStat = {
    totals: emptyTotals(),
    series: [],
    rawJson: json,
    rawTableHtml: "",
  }
  if (!json || typeof json !== "object") return empty
  const root = json as Record<string, unknown>

  const tableHtml = typeof root.tableHtml === "string" ? root.tableHtml : ""
  const totals = parseTotalsFromHtml(tableHtml)

  const series = parseSeriesFromChartData(root.chartData)

  return {
    totals,
    series,
    rawJson: json,
    rawTableHtml: tableHtml,
  }
}

function emptyTotals(): DealStatTotals {
  return {
    ordersCreatedCount: null,
    ordersCreatedAmount: null,
    ordersPaidCount: null,
    ordersPaidAmount: null,
    buyersCount: null,
    prepaymentsCount: null,
    prepaymentsAmount: null,
    taxAmount: null,
    commissionAmount: null,
    earnedAmount: null,
  }
}

/**
 * Parse the tableHtml block extracting count + money for each row.
 * Row titles are bound to known labels — order in HTML is fixed.
 */
function parseTotalsFromHtml(html: string): DealStatTotals {
  const totals = emptyTotals()
  if (!html) return totals

  // Each row: <tr>...<td>{label}</td>...<td class="text-right count-value">N</td>...
  //           <td class="money-value">{N руб.}</td></tr>
  // For the "summary" row (Заработано), count-value is empty.

  const labelMap: Record<string, [keyof DealStatTotals, keyof DealStatTotals | null]> = {
    "Заказов создано": ["ordersCreatedCount", "ordersCreatedAmount"],
    "Заказов оплачено": ["ordersPaidCount", "ordersPaidAmount"],
    "Купило пользователей": ["buyersCount", null],
    "Число предоплат": ["prepaymentsCount", "prepaymentsAmount"],
    "Сумма налогов": ["taxAmount", "taxAmount"], // tax has no count, only money
    "Сумма комиссий": ["commissionAmount", "commissionAmount"],
    "Заработано": ["earnedAmount", "earnedAmount"],
  }

  // Strip whitespace/tags between cells; iterate row-by-row.
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g
  let m: RegExpExecArray | null
  while ((m = rowRe.exec(html))) {
    const row = m[1]
    // First <td> contains the label text
    const labelMatch = /<td[^>]*>([\s\S]*?)<\/td>/.exec(row)
    if (!labelMatch) continue
    const label = stripTags(labelMatch[1]).trim()
    const mapEntry = labelMap[label]
    if (!mapEntry) continue
    const [countKey, moneyKey] = mapEntry

    const countMatch = /class="[^"]*count-value[^"]*"[^>]*>([\s\S]*?)<\/td>/.exec(row)
    const moneyMatch = /class="[^"]*money-value[^"]*"[^>]*>([\s\S]*?)<\/td>/.exec(row)

    if (countMatch) {
      const n = parseRussianNumber(stripTags(countMatch[1]))
      if (n !== null) {
        // Tax / commission / earned use moneyKey only — count is empty there
        if (countKey !== moneyKey) totals[countKey] = n
      }
    }
    if (moneyMatch && moneyKey) {
      const n = parseRussianNumber(stripTags(moneyMatch[1]))
      if (n !== null) totals[moneyKey] = n
    }
  }

  return totals
}

function parseSeriesFromChartData(chartData: unknown): DealStatSeries[] {
  if (!chartData || typeof chartData !== "object") return []
  const root = chartData as Record<string, unknown>
  const seriesRaw = root.series
  if (!Array.isArray(seriesRaw)) return []

  // First series carries [month, value] tuples — month axis comes from there.
  // Subsequent series may have just [value] (sharing x-axis with first).
  const out: DealStatSeries[] = []
  let monthAxis: string[] = []

  for (let idx = 0; idx < seriesRaw.length; idx++) {
    const s = seriesRaw[idx] as Record<string, unknown>
    const name = typeof s.name === "string" ? s.name : `series_${idx}`
    const data = s.data as unknown[]
    if (!Array.isArray(data)) {
      out.push({ name, points: [] })
      continue
    }

    const points: DealStatSeriesPoint[] = []
    for (let i = 0; i < data.length; i++) {
      const item = data[i]
      let month: string | null = null
      let value: number | null = null

      if (Array.isArray(item) && item.length >= 2) {
        const m = item[0]
        const v = item[1]
        month = typeof m === "string" ? m : String(m)
        value = typeof v === "number" ? v : Number(v)
      } else if (typeof item === "number" || typeof item === "string") {
        // Bare value — pull month from first series axis
        month = monthAxis[i] ?? null
        value = typeof item === "number" ? item : Number(item)
      }

      if (month && value !== null && !Number.isNaN(value)) {
        points.push({ month, value })
      }
    }

    if (idx === 0) monthAxis = points.map((p) => p.month)
    out.push({ name, points })
  }

  return out
}

/** Strip HTML tags and decode &nbsp; / common entities. */
function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim()
}

/**
 * Parse "24675", "646 471 342 руб.", "12 345.67 руб." into a number.
 * Russian thousand separator = space. Returns null if no digits found.
 */
function parseRussianNumber(s: string): number | null {
  if (!s) return null
  // Remove "руб.", currency symbols, then strip spaces between digits
  const cleaned = s
    .replace(/руб\.?/gi, "")
    .replace(/₽/g, "")
    .replace(/\s+/g, "")
    .replace(",", ".")
    .trim()
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}
