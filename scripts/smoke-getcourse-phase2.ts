/**
 * Smoke-test for Phase 2 GetCourse parsers (deal-list, contact-list, user-list).
 * Reads real HTML samples from /tmp/gc-scan/ collected during pre-flight 2026-04-18.
 *
 * Run:
 *   ./node_modules/.bin/tsx scripts/smoke-getcourse-phase2.ts
 */
import { readFileSync, existsSync } from "node:fs"
import {
  parseDealList,
  gcStatusToUnified,
} from "../src/lib/crm/getcourse/parsers/deal-list"
import {
  parseContactList,
  parseRussianDate,
} from "../src/lib/crm/getcourse/parsers/contact-list"
import {
  parseUserList,
  isSalesRole,
} from "../src/lib/crm/getcourse/parsers/user-list"

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

function loadHtml(path: string): string | null {
  if (!existsSync(path)) {
    console.log(`  ⚠ skip ${path} (file missing)`)
    return null
  }
  return readFileSync(path, "utf-8")
}

console.log("\n=== parseRussianDate (pure) ===")
const dateA = parseRussianDate("18 апр. 2026 21:07")
assert(
  '"18 апр. 2026 21:07" parses correctly',
  dateA?.getFullYear() === 2026 &&
    dateA?.getMonth() === 3 &&
    dateA?.getDate() === 18 &&
    dateA?.getHours() === 21 &&
    dateA?.getMinutes() === 7,
  String(dateA)
)
const dateB = parseRussianDate("3 янв 2025")
assert(
  '"3 янв 2025" parses correctly (no time)',
  dateB?.getFullYear() === 2025 &&
    dateB?.getMonth() === 0 &&
    dateB?.getDate() === 3
)
assert("garbage returns null", parseRussianDate("hello world") === null)

console.log("\n=== gcStatusToUnified mapping ===")
assert("payed → won", gcStatusToUnified("payed") === "won")
assert("completed → won", gcStatusToUnified("completed") === "won")
assert("cancelled → lost", gcStatusToUnified("cancelled") === "lost")
assert("refunded → lost", gcStatusToUnified("refunded") === "lost")
assert("new → open", gcStatusToUnified("new") === "open")
assert("in_work → open", gcStatusToUnified("in_work") === "open")
assert("payment_waiting → open", gcStatusToUnified("payment_waiting") === "open")
assert("unknown → open", gcStatusToUnified("unknown") === "open")

console.log("\n=== isSalesRole heuristic ===")
assert("'администратор' → true", isSalesRole("администратор"))
assert("'куратор' → true", isSalesRole("Куратор продаж"))
assert("'менеджер' → true", isSalesRole("менеджер"))
assert("'ученик' → false", !isSalesRole("ученик"))
assert("'student' → false", !isSalesRole("student"))

console.log("\n=== parseDealList on /tmp/gc-scan/13-sales-deal.html ===")
{
  const html = loadHtml("/tmp/gc-scan/13-sales-deal.html")
  if (html) {
    const deals = parseDealList(html)
    assert(`parsed at least 20 deals (got ${deals.length})`, deals.length >= 20)

    if (deals.length > 0) {
      const first = deals[0]
      assert(`first.crmId is numeric (got "${first.crmId}")`, /^\d+$/.test(first.crmId))
      assert(`first.clientUserId is numeric`, /^\d+$/.test(first.clientUserId))
      assert(`first.title not empty`, first.title.length > 0)
      assert(
        `first.status is known (got "${first.status}")`,
        ["new", "in_work", "payed", "cancelled", "completed", "payment_waiting", "refunded", "unknown"].includes(first.status)
      )
      assert(
        `first.statusLabel is human ("${first.statusLabel}")`,
        first.statusLabel.length > 0
      )
      assert(`first.amount is number or null`, typeof first.amount === "number" || first.amount === null)

      // Status distribution
      const statusCounts: Record<string, number> = {}
      for (const d of deals) {
        statusCounts[d.status] = (statusCounts[d.status] ?? 0) + 1
      }
      console.log(`    Status distribution: ${JSON.stringify(statusCounts)}`)

      const wonCount = deals.filter((d) => gcStatusToUnified(d.status) === "won").length
      console.log(`    Unified WON: ${wonCount}, OPEN: ${deals.length - wonCount}`)
    }
  }
}

console.log("\n=== parseDealList on /tmp/gc-scan/22-deals-90d.html ===")
{
  const html = loadHtml("/tmp/gc-scan/22-deals-90d.html")
  if (html) {
    const deals = parseDealList(html)
    assert(
      `parsed deals from 90d page (got ${deals.length})`,
      deals.length >= 20
    )
  }
}

console.log("\n=== parseContactList on /tmp/gc-scan/21-contact-index.html ===")
{
  const html = loadHtml("/tmp/gc-scan/21-contact-index.html")
  if (html) {
    const contacts = parseContactList(html)
    assert(`parsed at least 20 contacts (got ${contacts.length})`, contacts.length >= 20)

    if (contacts.length > 0) {
      const first = contacts[0]
      assert(`first.crmId numeric`, /^\d+$/.test(first.crmId))
      assert(`first.clientUserId numeric`, /^\d+$/.test(first.clientUserId))
      assert(
        `first.callDate is Date or null (got ${first.callDate})`,
        first.callDate instanceof Date || first.callDate === null
      )
      assert(
        `first.direction is enum (got "${first.direction}")`,
        ["income", "outcome", "other"].includes(first.direction)
      )

      // Manager attribution
      const withManager = contacts.filter((c) => c.managerCrmId).length
      console.log(
        `    Manager attribution: ${withManager}/${contacts.length} contacts have manager`
      )
      assert(
        `at least some manager attribution`,
        withManager > 0
      )

      // Direction distribution
      const dirCounts: Record<string, number> = {}
      for (const c of contacts) {
        dirCounts[c.direction] = (dirCounts[c.direction] ?? 0) + 1
      }
      console.log(`    Direction distribution: ${JSON.stringify(dirCounts)}`)

      // Linked deals
      const withDeal = contacts.filter((c) => c.linkedDealId).length
      console.log(`    Linked to deal: ${withDeal}/${contacts.length}`)

      // Audio
      const withAudio = contacts.filter((c) => c.audioUrl).length
      console.log(`    With audio: ${withAudio}/${contacts.length}`)
    }
  }
}

console.log("\n=== parseContactList on /tmp/gc-scan/23-calls-90d.html ===")
{
  const html = loadHtml("/tmp/gc-scan/23-calls-90d.html")
  if (html) {
    const contacts = parseContactList(html)
    assert(`parsed contacts from 90d page (got ${contacts.length})`, contacts.length >= 10)

    const datedCount = contacts.filter((c) => c.callDate).length
    console.log(`    Dated contacts: ${datedCount}/${contacts.length}`)
    assert(`most contacts have parsed date (>=80%)`, datedCount >= contacts.length * 0.8)
  }
}

console.log("\n=== parseUserList on /tmp/gc-scan/02-users-index.html ===")
{
  const html = loadHtml("/tmp/gc-scan/02-users-index.html")
  if (html) {
    const users = parseUserList(html)
    assert(`parsed at least 20 users (got ${users.length})`, users.length >= 20)

    if (users.length > 0) {
      const first = users[0]
      assert(`first.crmId numeric`, /^\d+$/.test(first.crmId))
      assert(`first.name not empty`, first.name.length > 0)
      assert(
        `first.email looks like email or null`,
        first.email === null || /@/.test(first.email)
      )
      assert(`first.role not empty`, first.role.length > 0)
      assert(`first.isActive is boolean`, typeof first.isActive === "boolean")

      // Role distribution
      const roleCounts: Record<string, number> = {}
      for (const u of users) {
        roleCounts[u.role] = (roleCounts[u.role] ?? 0) + 1
      }
      console.log(`    Role distribution (top): ${JSON.stringify(Object.fromEntries(Object.entries(roleCounts).slice(0, 5)))}`)

      const salesCount = users.filter((u) => isSalesRole(u.role)).length
      console.log(`    Sales-like roles: ${salesCount}/${users.length}`)
    }
  }
}

console.log(`\n${"=".repeat(50)}`)
console.log(`Phase 2 smoke: ${passed} passed, ${failed} failed`)
console.log("=".repeat(50))
process.exit(failed === 0 ? 0 : 1)
