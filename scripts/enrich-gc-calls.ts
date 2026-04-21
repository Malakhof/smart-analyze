/**
 * Enrich GetCourse CallRecords by fetching the per-call contact detail page
 * and extracting "Продолжительность разговора" (talk duration).
 *
 * Rationale: the /pl/sales/contact list page does NOT expose call duration;
 * only the per-contact page does. CallRecord.duration stays NULL for every
 * call unless we enrich. This script targets transcribed calls (the ones the
 * UI actually shows) so the expensive per-call fetch is scoped to ~445 rows,
 * not the full 138K.
 *
 * Usage:
 *   tsx scripts/enrich-gc-calls.ts <tenantId>
 *
 * The contact page lives at /user/control/contact/update/id/{callCrmId} on
 * the tenant's GetCourse host (custom domain or {subdomain}.getcourse.ru).
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { decrypt } from "../src/lib/crypto"

const CONCURRENCY = 3 // be gentle with GC — each fetch ~100KB

function parseDuration(html: string): number | null {
  // GC uses &nbsp; between "разговора:" and the number — normalize to plain space
  // before matching. Also word endings vary: "1 секунду", "2 секунды", "5 секунд".
  const norm = html.replace(/&nbsp;/g, " ")
  const talk =
    norm.match(
      /Продолжительность разговора\s*:?\s*(?:(\d+)\s*час[а-я]*\s*)?(?:(\d+)\s*минут[а-я]*\s*)?(?:(\d+)\s*секунд[а-я]*)?/i
    ) ||
    norm.match(
      /Продолжительность записи\s*:?\s*(?:(\d+)\s*час[а-я]*\s*)?(?:(\d+)\s*минут[а-я]*\s*)?(?:(\d+)\s*секунд[а-я]*)?/i
    )
  if (!talk) return null
  const h = talk[1] ? Number(talk[1]) : 0
  const m = talk[2] ? Number(talk[2]) : 0
  const s = talk[3] ? Number(talk[3]) : 0
  const total = h * 3600 + m * 60 + s
  return total > 0 ? total : null
}

async function fetchHtml(
  host: string,
  cookie: string,
  callCrmId: string
): Promise<string | null> {
  const url = `https://${host}/user/control/contact/update/id/${callCrmId}`
  try {
    const res = await fetch(url, {
      headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0" },
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

async function main() {
  const [tenantId] = process.argv.slice(2)
  if (!tenantId) {
    console.error("Usage: enrich-gc-calls.ts <tenantId>")
    process.exit(1)
  }

  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  })

  const config = await db.crmConfig.findFirst({
    where: { tenantId, provider: "GETCOURSE", isActive: true },
  })
  if (!config?.gcCookie || !config.subdomain) {
    console.error("No active GETCOURSE config for tenant", tenantId)
    process.exit(1)
  }
  const cookie = decrypt(config.gcCookie)
  const host = config.subdomain.includes(".")
    ? config.subdomain
    : `${config.subdomain}.getcourse.ru`

  // Target: transcribed calls without duration (or with <= 0)
  const calls = await db.callRecord.findMany({
    where: {
      tenantId,
      transcript: { not: null },
      crmId: { not: null },
      OR: [{ duration: null }, { duration: { lte: 0 } }],
    },
    select: { id: true, crmId: true },
  })
  console.log(`[init] ${calls.length} calls to enrich`)

  let cursor = 0
  let ok = 0
  let miss = 0
  let failed = 0

  async function worker(workerId: number) {
    while (true) {
      const i = cursor++
      if (i >= calls.length) return
      const call = calls[i]
      if (!call.crmId) {
        miss++
        continue
      }
      const html = await fetchHtml(host, cookie, call.crmId)
      if (!html) {
        failed++
        continue
      }
      const duration = parseDuration(html)
      if (duration == null) {
        miss++
        continue
      }
      await db.callRecord.update({
        where: { id: call.id },
        data: { duration },
      })
      ok++
      if ((ok + miss + failed) % 25 === 0) {
        console.log(
          `[w${workerId} i=${i + 1}/${calls.length}] ok=${ok} miss=${miss} failed=${failed}`
        )
      }
    }
  }

  await Promise.all(
    Array.from({ length: CONCURRENCY }, (_, id) => worker(id + 1))
  )

  console.log(`[done] ok=${ok} miss=${miss} failed=${failed}`)
  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
