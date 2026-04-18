/**
 * GetCourseAdapter — production read-only adapter for GetCourse account.
 *
 * Phase 3 scope:
 *  - testConnection (whoami via /pl/user/user/index)
 *  - getDealsByDateRange (parses Yii2 GridView with pagination)
 *  - getContactsByDateRange (parses contacts/calls grid)
 *  - getUsers (single page sample for now; full sync extension later)
 *  - getTotalsByDateRange (cheap probe before heavy fetch)
 *
 * NOTE: This is intentionally separate from src/lib/crm/getcourse.ts (legacy
 * naive adapter implementing CrmAdapter interface). The new sync flow in
 * src/lib/sync/gc-sync-v2.ts uses this class directly. After Phase 5 we will
 * unify by replacing the old class.
 */
import { safeFetch } from "./safe-fetch"
import {
  buildDateFilteredUrl,
  parseTotalRecords,
} from "./parsers/filters"
import {
  parseDealList,
  type ParsedDeal,
} from "./parsers/deal-list"
import {
  parseContactList,
  type ParsedContact,
} from "./parsers/contact-list"
import {
  parseUserList,
  type ParsedGcUser,
} from "./parsers/user-list"

const RATE_LIMIT_DELAY_MS = 1000 // 1 req/sec safe default

interface PaginatedFetchOptions {
  maxPages?: number       // hard cap to prevent runaway in tests (default 50)
  perPage?: number        // try larger per-page (default 100, GC supports up to 200)
  onProgress?: (page: number, totalRows: number) => void
}

export class GetCourseAdapter {
  constructor(
    public readonly accountUrl: string,  // e.g. "https://web.diva.school"
    private readonly cookie: string
  ) {}

  /**
   * Quick probe — fetches user list page 1 and confirms 200 + non-login HTML.
   * Throws GetCourseAuthError if cookie expired.
   */
  async testConnection(): Promise<{ ok: true; usersTotal: number | null }> {
    const result = await safeFetch(`${this.accountUrl}/pl/user/user/index`, {
      cookie: this.cookie,
    })
    return { ok: true, usersTotal: parseTotalRecords(result.html) }
  }

  /**
   * Get the total count of deals in a date range without downloading all rows.
   * Cheap: 1 GET request returning ~500 KB of HTML; we read just the
   * "Всего записей: N" footer.
   */
  async getTotalDealsInRange(from: Date, to: Date): Promise<number | null> {
    const url = buildDateFilteredUrl(this.accountUrl, "deal", from, to)
    const result = await safeFetch(url, { cookie: this.cookie })
    return parseTotalRecords(result.html)
  }

  async getTotalContactsInRange(from: Date, to: Date): Promise<number | null> {
    const url = buildDateFilteredUrl(this.accountUrl, "contact", from, to)
    const result = await safeFetch(url, { cookie: this.cookie })
    return parseTotalRecords(result.html)
  }

  /**
   * Fetch deals in date range with pagination.
   * Returns at most options.maxPages * options.perPage deals.
   */
  async getDealsByDateRange(
    from: Date,
    to: Date,
    options: PaginatedFetchOptions = {}
  ): Promise<ParsedDeal[]> {
    const baseUrl = buildDateFilteredUrl(this.accountUrl, "deal", from, to)
    return this.paginateGrid(baseUrl, parseDealList, options)
  }

  async getContactsByDateRange(
    from: Date,
    to: Date,
    options: PaginatedFetchOptions = {}
  ): Promise<ParsedContact[]> {
    const baseUrl = buildDateFilteredUrl(this.accountUrl, "contact", from, to)
    return this.paginateGrid(baseUrl, parseContactList, options)
  }

  /**
   * Fetch users (managers + clients). Page 1 only by default — GetCourse has
   * 249K users for diva and full enumeration is wasteful. Caller should paginate
   * explicitly only when needed.
   */
  async getUsersPage(pageNumber = 1): Promise<ParsedGcUser[]> {
    const url = `${this.accountUrl}/pl/user/user/index?page=${pageNumber}`
    const result = await safeFetch(url, { cookie: this.cookie })
    return parseUserList(result.html)
  }

  // ─── private ──────────────────────────────────────────────────────────────

  private async paginateGrid<T>(
    baseUrl: string,
    parser: (html: string) => T[],
    options: PaginatedFetchOptions
  ): Promise<T[]> {
    const maxPages = options.maxPages ?? 50
    const perPage = options.perPage ?? 100
    const onProgress = options.onProgress

    const allRows: T[] = []
    for (let page = 1; page <= maxPages; page++) {
      const sep = baseUrl.includes("?") ? "&" : "?"
      const url = `${baseUrl}${sep}page=${page}&per-page=${perPage}`

      const result = await safeFetch(url, { cookie: this.cookie })
      const rows = parser(result.html)

      if (rows.length === 0) break
      allRows.push(...rows)

      onProgress?.(page, allRows.length)

      // GetCourse Yii2 GridView ignores ?per-page= param and returns its own
      // default (~30 rows). Cannot use rows.length < perPage as EOF heuristic.
      // Only stop on truly empty page.
      await sleep(RATE_LIMIT_DELAY_MS)
    }
    return allRows
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
