/**
 * Smoke-test for Phase 3 GetCourseAdapter — LIVE call to GetCourse account.
 *
 * REQUIRES a fresh cookie (PHPSESSID5 + PHPSESSID5_glob). Runs only against
 * the configured account; does NOT touch our database.
 *
 * Usage:
 *   COOKIE='PHPSESSID5=xxxx; PHPSESSID5_glob=yyyy' \
 *   ACCOUNT_URL='https://web.diva.school' \
 *   ./node_modules/.bin/tsx scripts/smoke-getcourse-phase3.ts
 *
 * Output: writes JSON summary to /tmp/gc-phase3-result.json
 */
import { writeFileSync } from "node:fs"
import { GetCourseAdapter } from "../src/lib/crm/getcourse/adapter"

const cookie = process.env.COOKIE
const accountUrl = process.env.ACCOUNT_URL ?? "https://web.diva.school"

if (!cookie) {
  console.error("Missing env: COOKIE='PHPSESSID5=...; PHPSESSID5_glob=...'")
  process.exit(1)
}

async function main() {
  const adapter = new GetCourseAdapter(accountUrl, cookie!)

  console.log(`\n=== testConnection() against ${accountUrl} ===`)
  const conn = await adapter.testConnection()
  console.log(`  ✓ connected (usersTotal=${conn.usersTotal})`)

  const to = new Date()
  const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  console.log(`\n=== getTotalDealsInRange (last 7 days) ===`)
  const dealsTotal = await adapter.getTotalDealsInRange(from, to)
  console.log(`  ✓ deals 7d total: ${dealsTotal}`)

  console.log(`\n=== getTotalContactsInRange (last 7 days) ===`)
  const contactsTotal = await adapter.getTotalContactsInRange(from, to)
  console.log(`  ✓ contacts 7d total: ${contactsTotal}`)

  console.log(`\n=== getDealsByDateRange (small page, max 2) ===`)
  const deals = await adapter.getDealsByDateRange(from, to, {
    maxPages: 2,
    perPage: 20,
    onProgress: (page, total) => console.log(`  page ${page} → ${total} rows`),
  })
  console.log(`  ✓ pulled ${deals.length} deals (sample first):`)
  if (deals[0]) {
    console.log(`    ${JSON.stringify({
      crmId: deals[0].crmId,
      title: deals[0].title.slice(0, 60),
      status: deals[0].status,
      amount: deals[0].amount,
    })}`)
  }

  console.log(`\n=== getContactsByDateRange (small page, max 2) ===`)
  const contacts = await adapter.getContactsByDateRange(from, to, {
    maxPages: 2,
    perPage: 20,
    onProgress: (page, total) => console.log(`  page ${page} → ${total} rows`),
  })
  console.log(`  ✓ pulled ${contacts.length} contacts (sample first):`)
  if (contacts[0]) {
    console.log(`    ${JSON.stringify({
      crmId: contacts[0].crmId,
      manager: contacts[0].managerName,
      direction: contacts[0].direction,
      hasAudio: !!contacts[0].audioUrl,
      callDate: contacts[0].callDate?.toISOString(),
    })}`)
  }

  // Manager attribution stats
  const withManager = contacts.filter((c) => c.managerCrmId).length
  const uniqueManagers = new Set(
    contacts.filter((c) => c.managerCrmId).map((c) => c.managerCrmId)
  )
  console.log(
    `\n  Manager stats: ${withManager}/${contacts.length} attributed, ${uniqueManagers.size} unique`
  )

  const summary = {
    ranAt: new Date().toISOString(),
    accountUrl,
    range: { from, to },
    totals: {
      usersTotal: conn.usersTotal,
      dealsExpected7d: dealsTotal,
      contactsExpected7d: contactsTotal,
    },
    pulled: {
      deals: deals.length,
      contacts: contacts.length,
      uniqueManagers: uniqueManagers.size,
    },
    sampleDeal: deals[0] ?? null,
    sampleContact: contacts[0] ?? null,
  }
  writeFileSync(
    "/tmp/gc-phase3-result.json",
    JSON.stringify(summary, null, 2)
  )
  console.log(`\n  Summary written to /tmp/gc-phase3-result.json`)
}

main().catch((e) => {
  console.error("\nFAILED:", e)
  process.exit(1)
})
