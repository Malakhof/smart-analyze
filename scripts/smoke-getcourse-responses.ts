/**
 * Smoke-test for new GC adapter response endpoints.
 *
 * Run:
 *   COOKIE='PHPSESSID5=...; PHPSESSID5_glob=...' \
 *   ./node_modules/.bin/tsx scripts/smoke-getcourse-responses.ts
 */
import { GetCourseAdapter } from "../src/lib/crm/getcourse/adapter"

const cookie = process.env.COOKIE
const accountUrl = process.env.ACCOUNT_URL ?? "https://web.diva.school"

if (!cookie) {
  console.error("Missing env: COOKIE")
  process.exit(1)
}

async function main() {
  const adapter = new GetCourseAdapter(accountUrl, cookie!)

  console.log("\n=== getResponsesPage('open', 1) ===")
  const page1 = await adapter.getResponsesPage("open", 1)
  console.log(`  total open: ${page1.totalCount}`)
  console.log(`  page 1 size: ${page1.models.length}`)
  if (page1.models[0]) {
    const m = page1.models[0]
    console.log("  sample[0]:", JSON.stringify({
      crmId: m.crmId,
      clientUserId: m.clientUserId,
      clientName: m.clientName,
      managerUserName: m.managerUserName,
      status: m.status,
      openedAt: m.openedAt?.toISOString(),
      lastSnippet: m.lastSnippet?.slice(0, 60),
      conversationId: m.conversationId,
    }))
  }

  console.log("\n=== getResponseThread (first respId) ===")
  const respId = page1.models[0]?.crmId
  if (!respId) {
    console.log("  no respId to test")
    return
  }
  const thread = await adapter.getResponseThread(respId)
  console.log(`  thread messages: ${thread.length}`)
  console.log(`  system events: ${thread.filter(m => m.isSystem).length}`)
  console.log(`  user messages: ${thread.filter(m => !m.isSystem).length}`)
  if (thread[0]) {
    console.log("  first message:", JSON.stringify({
      authorUserId: thread[0].authorUserId,
      timestamp: thread[0].timestamp?.toISOString(),
      isSystem: thread[0].isSystem,
      channel: thread[0].channel,
      text: thread[0].text.slice(0, 100),
    }))
  }
  if (thread.length > 1) {
    const last = thread[thread.length - 1]
    console.log("  last message:", JSON.stringify({
      authorUserId: last.authorUserId,
      timestamp: last.timestamp?.toISOString(),
      isSystem: last.isSystem,
      channel: last.channel,
      text: last.text.slice(0, 100),
    }))
  }

  console.log("\n=== Stats: ===")
  const totalChars = thread.reduce((sum, m) => sum + m.text.length, 0)
  console.log(`  total text chars: ${totalChars}`)
  console.log(`  avg msg length: ${(totalChars / thread.length).toFixed(0)} chars`)

  // Test 2nd respond too
  if (page1.models[1]) {
    console.log("\n=== Second respId for variety ===")
    const t2 = await adapter.getResponseThread(page1.models[1].crmId)
    console.log(`  thread2 messages: ${t2.length}`)
    if (t2[0]) {
      console.log("  first:", t2[0].text.slice(0, 80))
    }
  }
}

main().catch((e) => {
  console.error("\nFAILED:", e)
  process.exit(1)
})
