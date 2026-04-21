/** Re-generate ONLY transcripts retro insight after role-swap fix. */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { ai, AI_MODEL } from "../src/lib/ai/client"

const TENANT_NAME = "diva-school"
const TAG = "🔥RETRO_AUDIT"

async function main() {
  const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter: adapterPg })
  const tenant = await db.tenant.findFirstOrThrow({ where: { name: TENANT_NAME } })

  const sample = await db.callRecord.findMany({
    where: { tenantId: tenant.id, transcript: { not: null } },
    select: { transcript: true },
    take: 30,
  })
  const text = sample.map((t) => t.transcript?.slice(0, 600) ?? "").join("\n---\n")
  const transcribed = await db.callRecord.count({
    where: { tenantId: tenant.id, transcript: { not: null } },
  })

  const r = await ai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      {
        role: "system",
        content: `Ты — эксперт по продажам и коммуникациям. Прочитал расшифровки 30 случайных звонков менеджеров онлайн-школы. Дай 4-5 markdown bullet'ов: общая характеристика стиля, типичные сильные приёмы, типичные слабые места, что бросается в глаза. Внимание: в расшифровках уже корректно подписаны роли — МЕНЕДЖЕР это менеджер школы, КЛИЕНТ это ученик/потенциальный клиент.`,
      },
      { role: "user", content: text.slice(0, 8000) },
    ],
    temperature: 0.4,
    max_tokens: 2000,
  })
  const summary = r.choices[0]?.message?.content?.trim() ?? ""

  await db.insight.deleteMany({
    where: { tenantId: tenant.id, title: { startsWith: `${TAG} 🎯` } },
  })
  await db.insight.create({
    data: {
      tenantId: tenant.id,
      type: "SUCCESS_INSIGHT",
      title: `${TAG} 🎯 Расшифровки — общий вывод`,
      content: `Анализ ${transcribed} расшифровок диалогов`,
      detailedDescription: summary,
      dealIds: [],
      managerIds: [],
      quotes: [],
    },
  })
  console.log(`✅ Transcripts insight updated (${summary.length} chars)`)
  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
