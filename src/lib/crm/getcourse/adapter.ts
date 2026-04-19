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
import { safeFetch, safeFetchJson, extractInnerHtml } from "./safe-fetch"
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
import {
  parseResponsesList,
  type ParsedResponse,
} from "./parsers/responses"
import {
  parseConversationThread,
  type ParsedConversationMessage,
} from "./parsers/conversation"
import {
  parseBotMessages,
  type ParsedBotMessage,
} from "./parsers/bot-messages"

const RATE_LIMIT_DELAY_MS = 1000 // 1 req/sec safe default

interface PaginatedFetchOptions {
  maxPages?: number       // hard cap to prevent runaway in tests (default 50)
  perPage?: number        // try larger per-page (default 100, GC supports up to 200)
  onProgress?: (page: number, totalRows: number) => void
}

export interface PaginatedStreamOptions {
  maxPages?: number       // hard cap (default 2000 for full sync)
  startPage?: number      // resume from this page (default 1)
  perPage?: number        // request size (GC ignores, but kept for parity)
  rateLimitMs?: number    // sleep between pages (default 1000)
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
   * Stream deals page-by-page, calling onPage(rows, pageNum) for each.
   * Returns total rows fetched. Memory stays O(1 page).
   */
  async streamDealsByDateRange(
    from: Date,
    to: Date,
    onPage: (rows: ParsedDeal[], pageNum: number) => Promise<void>,
    options: PaginatedStreamOptions = {}
  ): Promise<number> {
    const baseUrl = buildDateFilteredUrl(this.accountUrl, "deal", from, to)
    return this.streamGrid(baseUrl, parseDealList, onPage, options)
  }

  async streamContactsByDateRange(
    from: Date,
    to: Date,
    onPage: (rows: ParsedContact[], pageNum: number) => Promise<void>,
    options: PaginatedStreamOptions = {}
  ): Promise<number> {
    const baseUrl = buildDateFilteredUrl(this.accountUrl, "contact", from, to)
    return this.streamGrid(baseUrl, parseContactList, onPage, options)
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

  /**
   * List responses (обращения) of a given status with pagination.
   * status: "open" → 0, "closed" → 1.
   * objectTypeId: 55 = thread/conversation type for diva.school.
   */
  async getResponsesPage(
    status: "open" | "closed",
    pageNumber: number,
    objectTypeId = 55
  ): Promise<{ models: ParsedResponse[]; totalCount: number }> {
    const statusNum = status === "open" ? 0 : 1
    const url =
      `${this.accountUrl}/pl/tasks/resp/models-list` +
      `?filter%5Bobject_type_id%5D=${objectTypeId}` +
      `&filter%5Bstatus%5D=${statusNum}` +
      `&page=${pageNumber}`
    const result = await safeFetchJson(url, this.cookie)
    const parsed = parseResponsesList(result)
    return { models: parsed.models, totalCount: parsed.totalCount }
  }

  /**
   * Stream all responses of a given status, page by page,
   * calling onPage(models, pageNum) for each. Stops on empty page or maxPages.
   */
  async streamResponses(
    status: "open" | "closed",
    onPage: (models: ParsedResponse[], pageNum: number) => Promise<void>,
    options: { maxPages?: number; startPage?: number; rateLimitMs?: number; objectTypeId?: number } = {}
  ): Promise<number> {
    const maxPages = options.maxPages ?? 200
    const startPage = options.startPage ?? 1
    const rate = options.rateLimitMs ?? RATE_LIMIT_DELAY_MS
    const objectTypeId = options.objectTypeId ?? 55

    let total = 0
    for (let page = startPage; page < startPage + maxPages; page++) {
      const { models } = await this.getResponsesPage(status, page, objectTypeId)
      if (models.length === 0) break
      total += models.length
      await onPage(models, page)
      await sleep(rate)
    }
    return total
  }

  /**
   * Fetch full conversation thread for a respId.
   * Returns ordered list of messages (system events + human comments).
   */
  async getResponseThread(respId: string): Promise<ParsedConversationMessage[]> {
    const url =
      `${this.accountUrl}/pl/tasks/resp/model-view?id=${respId}&withHistory=1`
    const json = await safeFetchJson(url, this.cookie)
    const innerHtml = extractInnerHtml(json)
    if (!innerHtml) return []
    return parseConversationThread(innerHtml)
  }

  /**
   * Fetch bot/auto-mailing messages for a conversationId. This is the SECOND
   * parallel layer of messages alongside getResponseThread (manager + client).
   * Bot messages = автоматические рассылки от ботов (DIVAonline_bot, etc).
   * Returns empty array on no bot data — common for accounts not using mailing bots.
   */
  async getBotMessages(conversationId: string): Promise<ParsedBotMessage[]> {
    const url =
      `${this.accountUrl}/chtm/app/filebrainpro/~filebrain-get-bot-messages` +
      `?conversationId=${encodeURIComponent(conversationId)}`
    const json = await safeFetchJson(url, this.cookie)
    return parseBotMessages(json)
  }

  // ─── private ──────────────────────────────────────────────────────────────

  /**
   * Streaming version of paginateGrid: invokes onPage(rows, n) per page,
   * so caller can flush to DB without holding everything in memory.
   * Returns total rows seen. Uses startPage for resumability.
   */
  private async streamGrid<T>(
    baseUrl: string,
    parser: (html: string) => T[],
    onPage: (rows: T[], pageNum: number) => Promise<void>,
    options: PaginatedStreamOptions
  ): Promise<number> {
    const maxPages = options.maxPages ?? 2000
    const startPage = options.startPage ?? 1
    const perPage = options.perPage ?? 100
    const rateLimitMs = options.rateLimitMs ?? RATE_LIMIT_DELAY_MS

    let totalRows = 0
    for (let page = startPage; page < startPage + maxPages; page++) {
      const sep = baseUrl.includes("?") ? "&" : "?"
      const url = `${baseUrl}${sep}page=${page}&per-page=${perPage}`

      const result = await safeFetch(url, { cookie: this.cookie })
      const rows = parser(result.html)

      if (rows.length === 0) break
      totalRows += rows.length

      await onPage(rows, page)

      await sleep(rateLimitMs)
    }
    return totalRows
  }

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
