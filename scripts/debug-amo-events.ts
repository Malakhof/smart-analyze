import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { getAmoCrmAccessToken } from "../src/lib/crm/amocrm-oauth"

async function main() {
  const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter: adapterPg })
  const cfg = await db.crmConfig.findFirstOrThrow({
    where: { tenant: { name: "reklamalift74" }, provider: "AMOCRM" },
  })
  const token = await getAmoCrmAccessToken(cfg.id)
  const deals = await db.deal.findMany({
    where: {
      tenant: { name: "reklamalift74" },
      status: "WON",
      crmId: { not: null },
    },
    take: 1,
    select: { crmId: true },
  })
  const url = `https://reklamalift74.amocrm.ru/api/v4/events?filter[entity]=lead&filter[entity_id]=${deals[0].crmId}&limit=200`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  const j = await r.json() as { _embedded?: { events?: { type: string; value_after?: unknown[]; value_before?: unknown[] }[] } }
  const events = j?._embedded?.events ?? []
  const counts: Record<string, number> = {}
  for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1
  console.log("=== All event types for deal", deals[0].crmId, "===")
  console.table(counts)
  // Try all stage-related types
  const stageEvents = events.filter((e) =>
    e.type.includes("status") ||
    e.type.includes("stage") ||
    (e as { value_after?: { lead_value?: unknown }[] }).value_after?.[0]?.lead_value
  )
  console.log(`\n=== Stage-relevant events: ${stageEvents.length} ===`)
  if (stageEvents[0])
    console.log("Sample:", JSON.stringify(stageEvents[0], null, 2).slice(0, 1200))
  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
