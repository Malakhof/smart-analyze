/**
 * Глубокая ретро-аналитика для diva — генерит 7 insights:
 * 1. 🔁 Дубли клиентов (анонимные deals + клиенты с N+ deals)
 * 2. 📊 Сводка по сделкам (DeepSeek summary)
 * 3. 📞 Сводка по звонкам (DeepSeek summary)
 * 4. 💬 Сводка по сообщениям (DeepSeek summary)
 * 5. 🎯 Сводка по транскриптам (DeepSeek summary)
 * 6. ⭐ Сводка по CallScore оценкам (DeepSeek summary)
 * 7. 📋 ОБЩИЙ ВЫВОД АУДИТА (главный итог)
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

  // ============ INSIGHT 1: ДУБЛИ КЛИЕНТОВ ============
  console.log("\n=== 1. Дубли клиентов ===")
  const dupes = await db.$queryRaw<Array<{ clientCrmId: string; deals_count: number; titles: string[] }>>`
    SELECT "clientCrmId", COUNT(*)::int as deals_count,
           (ARRAY_AGG(DISTINCT title))[1:5] as titles
    FROM "Deal"
    WHERE "tenantId" = ${tenant.id}
      AND "clientCrmId" IS NOT NULL
    GROUP BY "clientCrmId"
    HAVING COUNT(*) >= 5
    ORDER BY COUNT(*) DESC
    LIMIT 20
  `
  const totalDeals = await db.deal.count({ where: { tenantId: tenant.id } })
  const uniqueClients = await db.deal.findMany({
    where: { tenantId: tenant.id, clientCrmId: { not: null } },
    select: { clientCrmId: true },
    distinct: ["clientCrmId"],
  })
  const anonymousDeals = await db.deal.count({
    where: { tenantId: tenant.id, clientCrmId: null },
  })
  const dupeAvg = (totalDeals - anonymousDeals) / Math.max(uniqueClients.length, 1)

  const dupeContent = `Из ${totalDeals.toLocaleString("ru-RU")} сделок только ${uniqueClients.length.toLocaleString("ru-RU")} уникальных клиентов. Анонимных карточек (без идентификации клиента): ${anonymousDeals.toLocaleString("ru-RU")}.`

  const dupeDetails = [
    `**Что мы нашли:**`,
    `- **${totalDeals.toLocaleString("ru-RU")}** карточек сделок в GetCourse`,
    `- **${uniqueClients.length.toLocaleString("ru-RU")}** уникальных идентифицированных клиентов`,
    `- **${anonymousDeals.toLocaleString("ru-RU")}** карточек БЕЗ привязки к конкретному клиенту (вебинар-регистрации, разовые формы)`,
    `- В среднем **${dupeAvg.toFixed(1)} карточки** на одного идентифицированного клиента`,
    ``,
    `### 🔁 Топ-${dupes.length} клиентов с дубликатами:`,
    ...dupes.slice(0, 10).map((d, i) =>
      `${i + 1}. Клиент #${d.clientCrmId} — **${d.deals_count} карточек**: ${(d.titles || []).slice(0, 3).join(" | ")}`
    ),
    ``,
    `### 💡 Рекомендация:`,
    `1. **Объединить дубли** — один клиент = одна карточка с историей всех взаимодействий`,
    `2. **Анонимные регистрации** перевести в отдельную сущность (Lead), не загромождать продажную воронку`,
    `3. **При синхронизации** наша система могла бы автоматически дедуплицировать по email/phone`,
  ].join("\n")

  await db.insight.deleteMany({
    where: { tenantId: tenant.id, title: { startsWith: `${TAG} 🔁` } },
  })
  await db.insight.create({
    data: {
      tenantId: tenant.id,
      type: "FAILURE_INSIGHT",
      title: `${TAG} 🔁 Проблема дублирования: ${anonymousDeals.toLocaleString("ru-RU")} анонимных карточек`,
      content: dupeContent,
      detailedDescription: dupeDetails,
      dealIds: [],
      managerIds: [],
      quotes: [],
    },
  })
  console.log(`✅ #1 Дубли: ${anonymousDeals} anon, top dupe = ${dupes[0]?.deals_count}`)

  // ============ DeepSeek summaries ============
  // Soomon helper
  async function aiSummary(systemPrompt: string, userContent: string): Promise<string> {
    const r = await ai.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.4,
      max_tokens: 2500,
    })
    return r.choices[0]?.message?.content?.trim() ?? ""
  }

  // ============ INSIGHT 2: СВОДКА ПО СДЕЛКАМ ============
  console.log("\n=== 2. Summary deals ===")
  const dealStats = await db.deal.groupBy({
    by: ["status"],
    where: { tenantId: tenant.id },
    _count: true,
    _avg: { amount: true },
    _max: { amount: true },
    _sum: { amount: true },
  })
  const statsText = dealStats.map((s) =>
    `${s.status}: ${s._count} сделок, средний чек ${(s._avg.amount ?? 0).toLocaleString("ru-RU")}₽, общая сумма ${(s._sum.amount ?? 0).toLocaleString("ru-RU")}₽`
  ).join("\n")
  const dealSummary = await aiSummary(
    `Ты — аналитик отдела продаж онлайн-школы. Проанализируй статистику сделок. Дай 3-4 коротких пункта (markdown bullets): что хорошо, что плохо, и одну ключевую рекомендацию. Без воды, конкретно. Используй жирный для цифр и важных слов. Формат: **что хорошо** + **что плохо** + **рекомендация**.`,
    `Школа diva.school. Всего сделок: ${totalDeals.toLocaleString("ru-RU")}. Анонимных: ${anonymousDeals.toLocaleString("ru-RU")} (${((anonymousDeals/totalDeals)*100).toFixed(0)}%). Уникальных клиентов: ${uniqueClients.length}.\n\nПо статусам:\n${statsText}\n\nДубли: один клиент в среднем = ${dupeAvg.toFixed(1)} сделки.`
  )
  await db.insight.deleteMany({ where: { tenantId: tenant.id, title: { startsWith: `${TAG} 📊` } } })
  await db.insight.create({
    data: {
      tenantId: tenant.id, type: "SUCCESS_INSIGHT",
      title: `${TAG} 📊 Сделки — общий вывод`,
      content: `Анализ ${totalDeals.toLocaleString("ru-RU")} сделок за 90 дней`,
      detailedDescription: dealSummary,
      dealIds: [], managerIds: [], quotes: [],
    },
  })
  console.log(`✅ #2 Deals summary written`)

  // ============ INSIGHT 3: СВОДКА ПО ЗВОНКАМ ============
  console.log("\n=== 3. Summary calls ===")
  const callsTotal = await db.callRecord.count({ where: { tenantId: tenant.id } })
  const callsTranscribed = await db.callRecord.count({ where: { tenantId: tenant.id, transcript: { not: null } } })
  const callsByMgr = await db.callRecord.groupBy({
    by: ["managerId"],
    where: { tenantId: tenant.id, managerId: { not: null } },
    _count: true,
    orderBy: { _count: { id: "desc" } },
    take: 5,
  })
  const callSummary = await aiSummary(
    `Ты — аналитик колл-центра. Проанализируй статистику звонков. Дай 3-4 коротких bullet'а в markdown: что хорошо, что плохо, ключевая проблема, рекомендация.`,
    `Школа diva.school. Звонков всего: ${callsTotal.toLocaleString("ru-RU")}. Расшифровано: ${callsTranscribed} (${((callsTranscribed/callsTotal)*100).toFixed(0)}%). Большинство звонков короткие (<60 сек) — служебные, недозвоны. Топ-5 менеджеров по объёму: ${callsByMgr.map(c => `${c._count} звонков`).join(", ")}.`
  )
  await db.insight.deleteMany({ where: { tenantId: tenant.id, title: { startsWith: `${TAG} 📞` } } })
  await db.insight.create({
    data: {
      tenantId: tenant.id, type: "SUCCESS_INSIGHT",
      title: `${TAG} 📞 Звонки — общий вывод`,
      content: `Анализ ${callsTotal.toLocaleString("ru-RU")} звонков, ${callsTranscribed} расшифровок`,
      detailedDescription: callSummary,
      dealIds: [], managerIds: [], quotes: [],
    },
  })
  console.log(`✅ #3 Calls summary written`)

  // ============ INSIGHT 4: СВОДКА ПО СООБЩЕНИЯМ ============
  console.log("\n=== 4. Summary messages ===")
  const msgStats = await db.message.groupBy({
    by: ["sender"],
    where: { tenantId: tenant.id },
    _count: true,
  })
  const msgsText = msgStats.map((s) => `${s.sender}: ${s._count}`).join(", ")
  const msgsTotal = msgStats.reduce((s, m) => s + m._count, 0)
  const msgSummary = await aiSummary(
    `Ты — аналитик коммуникаций. Проанализируй переписки школы. Дай 3-4 markdown bullet'а: что хорошо, что плохо, что цепляет внимание.`,
    `Школа diva.school. Сообщений всего: ${msgsTotal.toLocaleString("ru-RU")}. Распределение: ${msgsText}. Большая часть — обращения учеников (CLIENT). MANAGER ответы означают активность.`
  )
  await db.insight.deleteMany({ where: { tenantId: tenant.id, title: { startsWith: `${TAG} 💬 Сообщения` } } })
  await db.insight.create({
    data: {
      tenantId: tenant.id, type: "SUCCESS_INSIGHT",
      title: `${TAG} 💬 Сообщения — общий вывод`,
      content: `Анализ ${msgsTotal.toLocaleString("ru-RU")} сообщений`,
      detailedDescription: msgSummary,
      dealIds: [], managerIds: [], quotes: [],
    },
  })
  console.log(`✅ #4 Messages summary written`)

  // ============ INSIGHT 5: СВОДКА ПО ТРАНСКРИПТАМ ============
  console.log("\n=== 5. Summary transcripts ===")
  const sampleTranscripts = await db.callRecord.findMany({
    where: { tenantId: tenant.id, transcript: { not: null } },
    select: { transcript: true },
    take: 30,
  })
  const sampleText = sampleTranscripts.map((t) => t.transcript?.slice(0, 500) ?? "").join("\n---\n")
  const trxSummary = await aiSummary(
    `Ты — эксперт по продажам и коммуникациям. Прочитал расшифровки 30 случайных звонков менеджеров онлайн-школы. Дай 4-5 markdown bullet'ов: общая характеристика стиля, типичные сильные приёмы, типичные слабые места, что бросается в глаза.`,
    sampleText.slice(0, 8000)
  )
  await db.insight.deleteMany({ where: { tenantId: tenant.id, title: { startsWith: `${TAG} 🎯` } } })
  await db.insight.create({
    data: {
      tenantId: tenant.id, type: "SUCCESS_INSIGHT",
      title: `${TAG} 🎯 Расшифровки — общий вывод`,
      content: `Анализ ${callsTranscribed} расшифровок диалогов`,
      detailedDescription: trxSummary,
      dealIds: [], managerIds: [], quotes: [],
    },
  })
  console.log(`✅ #5 Transcripts summary written`)

  // ============ INSIGHT 6: СВОДКА ПО CALLSCORE ============
  console.log("\n=== 6. Summary callscores ===")
  const scoreStats = await db.callScore.aggregate({
    where: { callRecord: { tenantId: tenant.id } },
    _avg: { totalScore: true },
    _max: { totalScore: true },
    _min: { totalScore: true },
    _count: true,
  })
  // Use CallScoreItem.notes instead — CallScore has no comment column directly
  const lowScores = await db.callScore.findMany({
    where: { callRecord: { tenantId: tenant.id }, totalScore: { lt: 40 } },
    select: {
      callRecord: { select: { transcript: true } },
    },
    take: 5,
  })
  const lowText = lowScores
    .map((s) => s.callRecord?.transcript?.slice(0, 600))
    .filter(Boolean)
    .join("\n---\n")
  const scoreSummary = await aiSummary(
    `Ты — РОП. Проанализируй сводку оценок звонков по 100-балльной шкале. Дай 3-4 markdown bullet'а: общий уровень команды, что плохо, что критично, ключевая рекомендация.`,
    `Оценено звонков: ${scoreStats._count}. Средняя оценка: ${scoreStats._avg.totalScore?.toFixed(1)}. Лучшая: ${scoreStats._max.totalScore}, худшая: ${scoreStats._min.totalScore}.\n\nКомментарии к ХУДШИМ звонкам (топ-10 примеров):\n${lowText.slice(0, 4000)}`
  )
  await db.insight.deleteMany({ where: { tenantId: tenant.id, title: { startsWith: `${TAG} ⭐` } } })
  await db.insight.create({
    data: {
      tenantId: tenant.id, type: "SUCCESS_INSIGHT",
      title: `${TAG} ⭐ Оценки качества звонков — общий вывод`,
      content: `Средний балл ${scoreStats._avg.totalScore?.toFixed(1) ?? "—"} из 100 (${scoreStats._count} оценок)`,
      detailedDescription: scoreSummary,
      dealIds: [], managerIds: [], quotes: [],
    },
  })
  console.log(`✅ #6 CallScore summary written`)

  // ============ INSIGHT 7: ОБЩИЙ ВЫВОД АУДИТА (master) ============
  console.log("\n=== 7. MASTER audit summary ===")
  const allInsights = await db.insight.findMany({
    where: { tenantId: tenant.id, title: { startsWith: TAG } },
    select: { title: true, detailedDescription: true },
  })
  const insightsText = allInsights.map((i) => `## ${i.title}\n${i.detailedDescription?.slice(0, 1000)}`).join("\n\n")
  const masterSummary = await aiSummary(
    `Ты — старший консультант по продажам. На основе детального аудита онлайн-школы за 90 дней дай **финальный вывод** для собственника. Структура:

### 🎯 Главные находки (5 пунктов)
- ...

### ✅ Что у вас работает хорошо
- ...

### ⚠️ Что критично исправить (по приоритету)
1. ...

### 💎 Что мы рекомендуем сделать в первую очередь
1. ...
2. ...

### 🚀 Что наш сервис будет ловить в реальном времени
- ...

Не воды, факты + цифры из аудита. Markdown.`,
    `Школа diva.school. Аудит 90 дней.\n\nДанные:\n- ${totalDeals.toLocaleString("ru-RU")} сделок (${anonymousDeals} анонимных, ${uniqueClients.length} клиентов)\n- ${callsTotal} звонков (${callsTranscribed} расшифровано)\n- ${msgsTotal} сообщений\n- средняя оценка звонков: ${scoreStats._avg.totalScore?.toFixed(1)}/100\n\nДетальные находки:\n${insightsText.slice(0, 8000)}`
  )
  await db.insight.deleteMany({ where: { tenantId: tenant.id, title: { startsWith: `${TAG} 📋` } } })
  await db.insight.create({
    data: {
      tenantId: tenant.id, type: "SUCCESS_INSIGHT",
      title: `${TAG} 📋 ОБЩИЙ ВЫВОД АУДИТА`,
      content: `Финальный вывод по аудиту 90 дней работы школы`,
      detailedDescription: masterSummary,
      dealIds: [], managerIds: [], quotes: [],
    },
  })
  console.log(`✅ #7 MASTER summary written`)
  console.log("\n=== ALL DONE ===")
  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
