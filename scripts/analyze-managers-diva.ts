/**
 * Per-manager AI analysis для diva — для каждого менеджера агрегирует все его
 * сообщения за период и просит DeepSeek дать:
 *   - summary стиля общения
 *   - top 3 сильных стороны
 *   - top 3 слабых стороны
 *   - 3-5 цитат-примеров
 *   - 2-3 рекомендации
 * Результат пишется как Insight (по 1 на менеджера) с managerIds=[id].
 *
 * Run on server:
 *   docker run --rm --network smart-analyze_default -v /root/smart-analyze:/app -w /app \
 *     node:22-slim sh -c 'set -a && . /app/.env && set +a && \
 *       ./node_modules/.bin/tsx scripts/analyze-managers-diva.ts'
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { ai, AI_MODEL } from "../src/lib/ai/client"

const TENANT_NAME = "diva-school"
const MIN_MESSAGES = 30 // skip managers with too few messages
const MAX_MESSAGES_PER_MANAGER = 250 // keep prompt size reasonable

const PROMPT = `Ты — опытный аналитик отделов продаж. Тебе дан набор сообщений ОДНОГО менеджера в общении с разными клиентами через CRM. Твоя задача — выдать краткий портрет работы этого менеджера.

## Что нужно сделать
1. **summary** — 2-4 предложения о стиле общения менеджера (вежлив/настойчив, оперативен/медлен, шаблонные ответы или индивидуальный подход и т.п.)
2. **strengths** — 3 СИЛЬНЫЕ стороны менеджера (конкретные действия из переписки, не общие фразы)
3. **weaknesses** — 3 СЛАБЫЕ стороны / зоны роста
4. **keyQuotes** — массив 3-5 ДОСЛОВНЫХ цитат из СООБЩЕНИЙ менеджера (без префиксов и заголовков), которые иллюстрируют его подход
5. **recommendations** — 2-3 конкретные рекомендации что улучшить

## Формат ответа — строго JSON:
{
  "summary": "...",
  "strengths": ["...", "...", "..."],
  "weaknesses": ["...", "...", "..."],
  "keyQuotes": [{"text": "точная цитата из реплики менеджера"}],
  "recommendations": ["...", "..."]
}

Отвечай ТОЛЬКО валидным JSON, без markdown.`

interface ManagerAnalysisResult {
  summary: string
  strengths: string[]
  weaknesses: string[]
  keyQuotes: { text: string }[]
  recommendations: string[]
}

async function main() {
  const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter: adapterPg })

  const tenant = await db.tenant.findFirstOrThrow({
    where: { name: TENANT_NAME },
  })

  const managers = await db.manager.findMany({
    where: {
      tenantId: tenant.id,
      messages: { some: { sender: "MANAGER" } },
    },
    select: {
      id: true,
      name: true,
      _count: { select: { messages: { where: { sender: "MANAGER" } } } },
    },
    orderBy: { name: "asc" },
  })

  const eligible = managers.filter((m) => m._count.messages >= MIN_MESSAGES)
  console.log(
    `Found ${managers.length} managers with messages, ${eligible.length} have >=${MIN_MESSAGES}`
  )

  let ok = 0
  let fail = 0
  for (const [i, mgr] of eligible.entries()) {
    try {
      const messages = await db.message.findMany({
        where: {
          managerId: mgr.id,
          sender: "MANAGER",
          content: { not: "" },
        },
        orderBy: { timestamp: "desc" },
        take: MAX_MESSAGES_PER_MANAGER,
        select: { content: true, timestamp: true },
      })
      const conversationText = messages
        .filter((m) => m.content && m.content.trim().length > 5)
        .map((m) => `- ${m.content.trim()}`)
        .join("\n")

      if (conversationText.length < 200) {
        console.log(`  [${i + 1}/${eligible.length}] ${mgr.name}: too little text, skip`)
        continue
      }

      const userMessage = `Менеджер: ${mgr.name}\nТенант: diva-school\n\nЕго сообщения (${messages.length}, новейшие сверху):\n${conversationText}`

      const response = await ai.chat.completions.create({
        model: AI_MODEL,
        messages: [
          { role: "system", content: PROMPT },
          { role: "user", content: userMessage },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      })

      const raw = response.choices[0]?.message?.content ?? ""
      const cleaned = raw.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
      const result = JSON.parse(cleaned) as ManagerAnalysisResult

      // Build a single Insight as SUCCESS (содержит и сильные и слабые)
      const detailedDescription = [
        `СТИЛЬ: ${result.summary}`,
        ``,
        `СИЛЬНЫЕ СТОРОНЫ:`,
        ...result.strengths.map((s, i) => `${i + 1}. ${s}`),
        ``,
        `ЗОНЫ РОСТА:`,
        ...result.weaknesses.map((s, i) => `${i + 1}. ${s}`),
        ``,
        `РЕКОМЕНДАЦИИ:`,
        ...result.recommendations.map((s, i) => `${i + 1}. ${s}`),
      ].join("\n")

      // Delete previous insight for this manager if any
      await db.insight.deleteMany({
        where: {
          tenantId: tenant.id,
          title: `Портрет менеджера: ${mgr.name}`,
        },
      })

      await db.insight.create({
        data: {
          tenantId: tenant.id,
          type: "SUCCESS_INSIGHT",
          title: `Портрет менеджера: ${mgr.name}`,
          content: result.summary,
          detailedDescription,
          dealIds: [],
          managerIds: [mgr.id],
          quotes: result.keyQuotes.map((q) => ({
            text: q.text,
            dealCrmId: "",
          })),
        },
      })

      ok++
      console.log(
        `  [${i + 1}/${eligible.length}] ${mgr.name} (${messages.length} msgs) → ${result.keyQuotes.length} quotes`
      )
    } catch (e) {
      fail++
      console.error(
        `  [${i + 1}/${eligible.length}] ${mgr.name} failed: ${(e as Error).message.slice(0, 100)}`
      )
    }
  }

  console.log(`\nDONE: ${ok} portraits created, ${fail} failed`)
  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
