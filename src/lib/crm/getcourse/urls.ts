/**
 * GetCourse URL whitelist + blacklist.
 * Source: pre-flight scan diva.school 2026-04-18 (docs/scans/2026-04-18-diva-school-preflight.md).
 *
 * Adapter MUST only fetch URLs whose path starts with one of GC_WHITELIST_PREFIXES
 * AND does NOT match any GC_BLACKLIST_PATTERNS. Enforced by assertSafeUrl().
 */

export const GC_WHITELIST_PREFIXES = [
  // Listings (totals + filtered queries)
  "/pl/user/user/index",
  "/pl/user/contact/index",
  "/pl/sales/deal",
  "/pl/sales/product/index",
  "/pl/sales/dealstat/index",
  "/sales/control/userProduct/my",

  // Kanban / pipeline views
  "/pl/tasks/task/kanban/deals",
  "/pl/tasks/task/kanban/tasks",
  "/pl/tasks/task/my",
  "/pl/tasks/task/stat",
  "/pl/tasks/resp",
  "/pl/tasks/resp/models-list",   // AJAX list of responses (JSON)
  "/pl/tasks/resp/model-view",    // AJAX detail of one response (JSON+HTML)
  "/pl/tasks/resp/objects",
  "/pl/tasks/resp/one",
  "/pl/tasks/mission/index",
  "/pl/logic/funnel",
  "/chtm/app/builder/v2",

  // Single-entity detail pages (read-only views, IDs are appended)
  "/user/control/contact/update/id/",
  "/user/control/user/update/id/",
  "/sales/control/deal/update/id/",
] as const

export const GC_BLACKLIST_PATTERNS: readonly RegExp[] = [
  /\/delete\b/i,
  /\/remove\b/i,
  /\/save\b/i,
  /\/create\b/i,
  /\/destroy\b/i,
  /\bsendmessage\b/i,
  /\bemailsend\b/i,
  /\bcron\//i,
  /\/admin\/(?!stats|reports)/i,
  /[?&](save|submit|action=delete|action=create|action=update)/i,
] as const

export class UnsafeUrlError extends Error {
  constructor(reason: string, url: string) {
    super(`Unsafe GetCourse URL: ${reason} — ${url}`)
    this.name = "UnsafeUrlError"
  }
}

/**
 * Verify a URL is safe for read-only GetCourse access.
 * Throws UnsafeUrlError if path is not whitelisted or matches a blacklist pattern.
 */
export function assertSafeUrl(rawUrl: string): void {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new UnsafeUrlError("malformed URL", rawUrl)
  }

  const path = parsed.pathname
  const isWhitelisted = GC_WHITELIST_PREFIXES.some((prefix) => path.startsWith(prefix))
  if (!isWhitelisted) {
    throw new UnsafeUrlError(`path not whitelisted: ${path}`, rawUrl)
  }

  const fullPath = path + parsed.search
  for (const pattern of GC_BLACKLIST_PATTERNS) {
    if (pattern.test(fullPath)) {
      throw new UnsafeUrlError(`matches blacklist ${pattern}`, rawUrl)
    }
  }
}
