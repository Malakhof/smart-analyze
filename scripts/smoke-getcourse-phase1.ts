/**
 * Smoke-test for Phase 1 GetCourse foundation:
 *  - assertSafeUrl: whitelist + blacklist enforcement
 *  - buildDateFilteredUrl: produces same URL shape as confirmed in pre-flight
 *  - parseTotalRecords: extracts totals from real saved HTML in /tmp/gc-scan/
 *
 * Run locally:
 *   ./node_modules/.bin/tsx scripts/smoke-getcourse-phase1.ts
 */
import { readFileSync } from "node:fs"
import { assertSafeUrl } from "../src/lib/crm/getcourse/urls"
import {
  buildDateFilteredUrl,
  parseTotalRecords,
} from "../src/lib/crm/getcourse/parsers/filters"

let passed = 0
let failed = 0

function assert(name: string, condition: boolean, details?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`)
    passed++
  } else {
    console.log(`  ✗ ${name}${details ? `\n      ${details}` : ""}`)
    failed++
  }
}

function assertThrows(name: string, fn: () => unknown, errType?: string) {
  try {
    fn()
    console.log(`  ✗ ${name} (expected throw, got no error)`)
    failed++
  } catch (e) {
    const ok = !errType || (e as Error).name === errType
    if (ok) {
      console.log(`  ✓ ${name}`)
      passed++
    } else {
      console.log(`  ✗ ${name} (wrong error type: ${(e as Error).name})`)
      failed++
    }
  }
}

console.log("\n=== assertSafeUrl: whitelist accepts ===")
const safeUrls = [
  "https://web.diva.school/pl/user/user/index?limit=1",
  "https://web.diva.school/pl/user/contact/index",
  "https://web.diva.school/pl/sales/deal",
  "https://web.diva.school/pl/sales/deal/index?DealContext%5Bsegment_id%5D=0",
  "https://web.diva.school/pl/tasks/task/kanban/deals?funnelId=920",
  "https://web.diva.school/user/control/contact/update/id/12345",
]
for (const u of safeUrls) {
  assert(`accepts: ${u.slice(0, 70)}`, !throwsAny(() => assertSafeUrl(u)))
}

console.log("\n=== assertSafeUrl: rejects non-whitelist ===")
const unwhitelisted = [
  "https://web.diva.school/pl/some/random/path",
  "https://web.diva.school/admin/cleanup",
  "https://web.diva.school/api/internal/v2",
]
for (const u of unwhitelisted) {
  assertThrows(`rejects: ${u}`, () => assertSafeUrl(u), "UnsafeUrlError")
}

console.log("\n=== assertSafeUrl: rejects blacklist patterns ===")
const blacklisted = [
  "https://web.diva.school/pl/user/contact/index?action=delete&id=1",
  "https://web.diva.school/pl/sales/deal/index?save=1",
  "https://web.diva.school/pl/user/user/index/delete",
  "https://web.diva.school/pl/sales/deal/create",
]
for (const u of blacklisted) {
  assertThrows(`rejects blacklist: ${u}`, () => assertSafeUrl(u), "UnsafeUrlError")
}

console.log("\n=== assertSafeUrl: rejects malformed ===")
assertThrows("malformed URL", () => assertSafeUrl("not a url"), "UnsafeUrlError")

console.log("\n=== buildDateFilteredUrl: deal context ===")
const dealUrl = buildDateFilteredUrl(
  "https://web.diva.school",
  "deal",
  new Date("2026-01-18T00:00:00Z"),
  new Date("2026-04-18T00:00:00Z")
)
assert(
  "URL contains /pl/sales/deal/index",
  dealUrl.includes("/pl/sales/deal/index"),
  dealUrl
)
assert(
  "URL contains DealContext[segment_id]=0",
  decodeURIComponent(dealUrl).includes("DealContext[segment_id]=0")
)
assert(
  "URL contains rule_string with deal_created_at",
  decodeURIComponent(dealUrl).includes("deal_created_at")
)
assert(
  "URL contains from=18.01.2026",
  decodeURIComponent(dealUrl).includes('"from":"18.01.2026"'),
  dealUrl
)
assert(
  "URL contains to=18.04.2026",
  decodeURIComponent(dealUrl).includes('"to":"18.04.2026"'),
  dealUrl
)
assert("built URL is itself safe", !throwsAny(() => assertSafeUrl(dealUrl)))

console.log("\n=== buildDateFilteredUrl: contact context ===")
const contactUrl = buildDateFilteredUrl(
  "https://web.diva.school",
  "contact",
  new Date("2026-01-18T00:00:00Z"),
  new Date("2026-04-18T00:00:00Z")
)
assert(
  "URL contains /pl/user/contact/index",
  contactUrl.includes("/pl/user/contact/index")
)
assert(
  "URL contains ContactContext",
  decodeURIComponent(contactUrl).includes("ContactContext[segment_id]=0")
)
assert(
  "URL contains contact_created_at type",
  decodeURIComponent(contactUrl).includes("contact_created_at")
)
assert("built URL is itself safe", !throwsAny(() => assertSafeUrl(contactUrl)))

console.log("\n=== parseTotalRecords from saved HTML ===")
const totalCases: Array<[string, number]> = [
  ["/tmp/gc-scan/02-users-index.html", 249549],
  ["/tmp/gc-scan/13-sales-deal.html", 966562],
  ["/tmp/gc-scan/21-contact-index.html", 982113],
  ["/tmp/gc-scan/19-mission-index.html", 761],
  ["/tmp/gc-scan/22-deals-90d.html", 330745],
  ["/tmp/gc-scan/23-calls-90d.html", 54325],
]
for (const [path, expected] of totalCases) {
  try {
    const html = readFileSync(path, "utf-8")
    const got = parseTotalRecords(html)
    assert(
      `${path.split("/").pop()} → ${expected}`,
      got === expected,
      `got ${got}, expected ${expected}`
    )
  } catch {
    console.log(`  ⚠ skip ${path} (file missing)`)
  }
}

console.log("\n=== parseTotalRecords on missing pattern ===")
assert("returns null when no match", parseTotalRecords("<html>nothing here</html>") === null)

console.log(`\n${"=".repeat(50)}`)
console.log(`Phase 1 smoke: ${passed} passed, ${failed} failed`)
console.log("=".repeat(50))
process.exit(failed === 0 ? 0 : 1)

function throwsAny(fn: () => unknown): boolean {
  try {
    fn()
    return false
  } catch {
    return true
  }
}
