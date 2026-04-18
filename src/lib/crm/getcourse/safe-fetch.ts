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
