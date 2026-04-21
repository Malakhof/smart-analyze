/**
 * Re-generate ONLY master audit insight with bigger max_tokens.
 * Other 6 retro insights stay as-is.
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { ai, AI_MODEL } from "../src/lib/ai/client"

const TENANT_NAME = "diva-school"
const TAG = "🔥RETRO_AUDIT"

async function main() {
  const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter: adapterPg })
  const tenant = await db.tenant.findFirstOrThrow({ where: { name: TENANT_NAME } })

  // Pull existing 6 section insights for context
  const existing = await db.insight.findMany({
    where: {
      tenantId: tenant.id,
      title: { startsWith: TAG },
      NOT: { title: { contains: "📋" } },
    },
    select: { title: true, detailedDescription: true },
  })
  const ctx = existing
    .map((i) => `## ${i.title}\n${i.detailedDescription?.slice(0, 1200)}`)
    .join("\n\n")

  const totalDeals = await db.deal.count({ where: { tenantId: tenant.id } })
  const anonymousDeals = await db.deal.count({
    where: { tenantId: tenant.id, clientCrmId: null },
  })
  const uniq = await db.deal.findMany({
    where: { tenantId: tenant.id, clientCrmId: { not: null } },
    select: { clientCrmId: true },
    distinct: ["clientCrmId"],
  })
  const callsTotal = await db.callRecord.count({ where: { tenantId: tenant.id } })
  const callsTrx = await db.callRecord.count({
    where: { tenantId: tenant.id, transcript: { not: null } },
  })
  const msgsTotal = await db.message.count({ where: { tenantId: tenant.id } })
  const scoreStats = await db.callScore.aggregate({
    where: { callRecord: { tenantId: tenant.id } },
    _avg: { totalScore: true },
    _count: true,
  })

  const userMessage = `Школа diva.school. Аудит 90 дней.

Базовые цифры:
- ${totalDeals.toLocaleString("ru-RU")} сделок (${anonymousDeals} анонимных, ${uniq.length} клиентов)
- ${callsTotal} звонков (${callsTrx} расшифровано)
- ${msgsTotal} сообщений
- средняя оценка звонков: ${scoreStats._avg.totalScore?.toFixed(1)}/100 (${scoreStats._count} оценок)

Детальные находки по разделам:
${ctx.slice(0, 10000)}`

  const response = await ai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      {
        role: "system",
        content: `Ты — старший консультант по продажам. На основе детального аудита онлайн-школы за 90 дней дай **финальный вывод** для собственника. Структура:

### 🎯 Главные находки (5 пунктов)
- ...

### ✅ Что у вас работает хорошо
- ...

### ⚠️ Что критично исправить (по приоритету)
1. ...

### 💎 Что мы рекомендуем сделать в первую очередь
1. ...
2. ...
3. ...

### 🚀 Что наш сервис будет ловить в реальном времени
- ...
- ...
- ...

Без воды, факты + цифры из аудита. Markdown. Каждый пункт раскрытым предложением, не обрывать.`,
      },
      { role: "user", content: userMessage },
    ],
    temperature: 0.4,
    max_tokens: 3500,
  })

  const text = response.choices[0]?.message?.content?.trim() ?? ""
  console.log(`Generated ${text.length} chars`)

  await db.insight.deleteMany({
    where: { tenantId: tenant.id, title: { startsWith: `${TAG} 📋` } },
  })
  await db.insight.create({
    data: {
      tenantId: tenant.id,
      type: "SUCCESS_INSIGHT",
      title: `${TAG} 📋 ОБЩИЙ ВЫВОД АУДИТА`,
      content: `Финальный вывод по аудиту 90 дней работы школы`,
      detailedDescription: text,
      dealIds: [],
      managerIds: [],
      quotes: [],
    },
  })
  console.log(`✅ Master summary updated`)
  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
