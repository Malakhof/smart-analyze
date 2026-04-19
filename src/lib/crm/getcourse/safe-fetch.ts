import { assertSafeUrl } from "./urls"

export class GetCourseHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string
  ) {
    super(message)
    this.name = "GetCourseHttpError"
  }
}

export class GetCourseAuthError extends Error {
  constructor(public readonly url: string) {
    super(`GetCourse cookie expired or invalid (URL: ${url})`)
    this.name = "GetCourseAuthError"
  }
}

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

const DEFAULT_TIMEOUT_MS = 30_000

interface SafeFetchOptions {
  cookie: string
  timeoutMs?: number
  userAgent?: string
}

interface SafeFetchResult {
  status: number
  html: string
  size: number
  url: string
}

/**
 * Read-only HTTP GET wrapper for GetCourse.
 *
 * Enforces:
 * - Whitelist + blacklist on URL (assertSafeUrl) — throws UnsafeUrlError if violated
 * - Method ALWAYS GET (no way to override via options)
 * - No request body
 * - Detects cookie expiry (login redirect, "Вход" page, 401/403) → throws GetCourseAuthError
 * - Throws GetCourseHttpError on 5xx/429
 *
 * Returns parsed HTML body + status. Caller is responsible for parsing.
 */
export async function safeFetch(
  url: string,
  options: SafeFetchOptions
): Promise<SafeFetchResult> {
  assertSafeUrl(url)

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const userAgent = options.userAgent ?? DEFAULT_UA

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Cookie: options.cookie,
      "User-Agent": userAgent,
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  })

  // Auth failures
  if (response.status === 401 || response.status === 403) {
    throw new GetCourseAuthError(url)
  }

  if (response.status >= 500 || response.status === 429) {
    throw new GetCourseHttpError(
      `HTTP ${response.status}`,
      response.status,
      url
    )
  }

  const html = await response.text()

  // GetCourse redirects expired sessions to login page (200 OK with login form).
  // Detect by title or response URL containing /pl/user/login or /cms/login.
  const finalUrl = response.url
  if (
    finalUrl.includes("/login") ||
    /<title>[^<]*\b(?:Вход|Login)\b[^<]*<\/title>/i.test(html.slice(0, 2048))
  ) {
    throw new GetCourseAuthError(url)
  }

  return {
    status: response.status,
    html,
    size: html.length,
    url: finalUrl,
  }
}

/**
 * Variant of safeFetch that requests JSON (sets Accept + X-Requested-With) and parses it.
 * Same security guarantees: GET only, whitelist enforced, auth detection.
 */
export async function safeFetchJson(
  url: string,
  cookie: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<unknown> {
  assertSafeUrl(url)

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Cookie: cookie,
      "User-Agent": DEFAULT_UA,
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (response.status === 401 || response.status === 403) {
    throw new GetCourseAuthError(url)
  }
  if (response.status >= 500 || response.status === 429) {
    throw new GetCourseHttpError(`HTTP ${response.status}`, response.status, url)
  }

  const text = await response.text()
  // GC sometimes returns HTML login page even with XHR — detect and throw auth.
  if (text.startsWith("\n<!DOCTYPE") || text.startsWith("<!DOCTYPE")) {
    throw new GetCourseAuthError(url)
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new GetCourseHttpError(
      `Expected JSON, got: ${text.slice(0, 100)}`,
      response.status,
      url
    )
  }
}

/**
 * POST variant of safeFetchJson — for GC REST API endpoints (kanban funnel/stage etc).
 * Body is serialized as JSON. Same security: whitelist + auth detection.
 * Read-only at semantic level: blacklist already blocks /save/, /create/, /delete/ etc.
 */
export async function safeFetchPostJson(
  url: string,
  cookie: string,
  body: Record<string, unknown> = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<unknown> {
  assertSafeUrl(url)

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "User-Agent": DEFAULT_UA,
      Accept: "application/json",
      "Content-Type": "json",                       // GC's quirky non-standard value
      "X-Requested-With": "XMLHttpRequest",
      Origin: new URL(url).origin,
      Referer: new URL(url).origin + "/",
    },
    body: JSON.stringify(body),
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (response.status === 401 || response.status === 403) {
    throw new GetCourseAuthError(url)
  }
  if (response.status >= 500 || response.status === 429) {
    throw new GetCourseHttpError(`HTTP ${response.status}`, response.status, url)
  }

  const text = await response.text()
  if (text.startsWith("\n<!DOCTYPE") || text.startsWith("<!DOCTYPE")) {
    throw new GetCourseAuthError(url)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new GetCourseHttpError(
      `Expected JSON from POST, got: ${text.slice(0, 100)}`,
      response.status,
      url
    )
  }
}

/**
 * Helper: extract data.html from GC AJAX wrapper { success, data: { html: ... } }
 */
export function extractInnerHtml(json: unknown): string | null {
  if (!json || typeof json !== "object") return null
  const root = json as Record<string, unknown>
  const data = root.data as Record<string, unknown> | undefined
  if (!data) return null
  const html = data.html
  return typeof html === "string" ? html : null
}
