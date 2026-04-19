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
  "/pl/sales/dealstat",            // /pl/sales/dealstat/index + tab AJAX (Wave 1 #16)
  "/pl/sales/stat",                // cumulative + structure aggregations (Wave 2)
  "/pl/sales/stream",              // streams / cohorts (Wave 2)
  "/pl/crm/stat",                  // revenue-structure (Wave 2)
  "/sales/control/userProduct/my",
  "/sales/control/participant",    // Партнёрская программа (Wave 2)
  "/sales/default/deals",          // List redirect for /pl/sales/deal
  "/pl/gcpay/client/payment",      // Платёжный модуль (Wave 2)

  // Kanban / pipeline views (Wave 1 #15)
  "/pl/tasks/task/kanban",         // covers /kanban/deals + /kanban/tasks/{kanban,list}
  "/pl/tasks/kanban",              // AJAX endpoints: /index, /get-tasks, /get-counts, /get-stat (POST)
  "/pl/crm/api/v1/funnel",         // REST: list funnels (POST, body empty)
  "/pl/crm/api/v1/stage",          // REST: list stages of funnel (POST, body {funnel_id})
  "/pl/crm/api/v1/cancel-reason",  // REST: cancel reasons
  "/pl/crm/api/v1/preset",         // REST: filter presets
  "/pl/crm/api/v1/tag",            // REST: tags catalog
  "/pl/crm/api/v1/offer",          // REST: offers (products) per funnel
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

  // Bot messages (Wave 1 #18) — second layer of conversation messages
  // Real path: /chtm/app/filebrainpro/~filebrain-get-bot-messages?conversationId=X
  "/chtm/app/filebrainpro",

  // Анкеты / forms (Wave 2 #17)
  "/user/control/survey",
  "/pl/user/survey-answer",

  // Сообщения — рассылки и шаблоны (Wave 2 #19)
  "/notifications/control/mailings",
  "/pl/notifications/control",     // covers /mailings/active, /templates-list, /stat
  "/pl/user/employers-stat",       // Отчёты сотрудников (Wave 2 #27)

  // Обучение (Wave 3) — read-only feedback streams
  "/teach/control/answers",        // Лента ответов учеников (Wave 3 #26)
  "/teach/control/stat",           // userTrainingFeedback (Wave 3)
  "/teach/control/stream",         // Тренинги
  "/pl/teach",                     // /pl/teach/control/* + /pl/teach/questionary + /pl/teach/goal

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
