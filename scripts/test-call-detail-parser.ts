/**
 * test-call-detail-parser.ts — quick verification of extractClientFromCallDetail
 * patch (Stage 7.5 fix). Fetches sample GC call card, parses, prints result.
 *
 * Usage: tsx scripts/test-call-detail-parser.ts <tenantId> <gcCallId>
 */
import { parseCallDetail } from "../src/lib/crm/getcourse/parsers/call-detail"
import { safeFetch } from "../src/lib/crm/getcourse/safe-fetch"
import { decrypt } from "../src/lib/crypto"
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

async function main() {
  const tenantId = process.argv[2] ?? "cmo4qkb1000000jo432rh0l3u"
  const gcCallId = process.argv[3] ?? "209102786"

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter })
  const cfg = await db.crmConfig.findFirstOrThrow({
    where: { tenantId, provider: "GETCOURSE" },
  })
  const cookieRaw = cfg.gcCookie!
  const cookie = /^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/i.test(cookieRaw)
    ? decrypt(cookieRaw)
    : cookieRaw
  const host = cfg.subdomain!.includes(".") ? cfg.subdomain : `${cfg.subdomain}.getcourse.ru`
  const url = `https://${host}/user/control/contact/update/id/${gcCallId}`

  const r = await safeFetch(url, { cookie })
  const parsed = parseCallDetail(r.html)
  console.log(JSON.stringify({
    gcCallId,
    pbxUuid: parsed.pbxUuid,
    audioUrl: parsed.audioUrl?.slice(0, 80) ?? null,
    talkDuration: parsed.talkDuration,
    clientGcUserId: parsed.clientGcUserId,
    clientName: parsed.clientName,
    managerGcUserId: parsed.managerGcUserId,
    managerName: parsed.managerName,
  }, null, 2))
  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
