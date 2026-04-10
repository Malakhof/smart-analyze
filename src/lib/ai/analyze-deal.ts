import { z } from "zod"
import { db } from "@/lib/db"
import { ai, AI_MODEL } from "./client"
import { DEAL_ANALYSIS_PROMPT } from "./prompts"
import type { DealAnalysis } from "@/generated/prisma"

const KeyQuoteSchema = z.object({
  text: z.string(),
  context: z.string(),
  isPositive: z.boolean(),
})

const DealAnalysisResponseSchema = z.object({
  summary: z.string(),
  successFactors: z.string().nullable().optional(),
  failureFactors: z.string().nullable().optional(),
  keyQuotes: z.array(KeyQuoteSchema),
  recommendations: z.string().nullable().optional(),
  talkRatio: z.number().min(0).max(1).nullable().optional(),
  avgResponseTimeMinutes: z.number().nullable().optional(),
})

function formatConversation(
  messages: { sender: string; content: string; timestamp: Date }[],
): string {
  return messages
    .map((m) => {
      const role =
        m.sender === "MANAGER"
          ? "Менеджер"
          : m.sender === "CLIENT"
            ? "Клиент"
            : "Система"
      const ts = new Date(m.timestamp)
      const date = ts.toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
      })
      const time = ts.toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      })
      return `[${role}] ${date} ${time}: ${m.content}`
    })
    .join("\n")
}

async function callDeepSeek(
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const makeRequest = () =>
    ai.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    })

  try {
    const response = await makeRequest()
    return response.choices[0]?.message?.content ?? ""
  } catch (error: unknown) {
    // Retry once on 5xx errors
    const status = (error as Record<string, unknown>)?.status
    if (
      error instanceof Error &&
      typeof status === "number" &&
      status >= 500
    ) {
      const response = await makeRequest()
      return response.choices[0]?.message?.content ?? ""
    }
    throw error
  }
}

function parseJsonResponse<T>(raw: string, schema: z.ZodType<T>): T {
  // Strip potential markdown code fences
  let cleaned = raw.trim()
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
  }

  const parsed = JSON.parse(cleaned)
  return schema.parse(parsed)
}

export async function analyzeDeal(dealId: string): Promise<DealAnalysis> {
  // 1. Fetch deal with messages
  const deal = await db.deal.findUniqueOrThrow({
    where: { id: dealId },
    include: {
      messages: { orderBy: { timestamp: "asc" } },
      manager: { select: { name: true } },
    },
  })

  if (deal.messages.length === 0) {
    throw new Error(`Deal ${dealId} has no messages to analyze`)
  }

  // 2. Build conversation string
  const conversation = formatConversation(deal.messages)

  // 3. Build user message with context
  const outcomeLabel = deal.status === "WON" ? "ВЫИГРАНА" : "ПРОИГРАНА"
  const userMessage = `Статус сделки: ${outcomeLabel}
Название сделки: ${deal.title}
${deal.amount ? `Сумма: ${deal.amount} руб.` : ""}
${deal.manager?.name ? `Менеджер: ${deal.manager.name}` : ""}

Переписка:
${conversation}`

  // 4. Call DeepSeek
  const rawResponse = await callDeepSeek(DEAL_ANALYSIS_PROMPT, userMessage)

  // 5. Parse and validate
  const analysis = parseJsonResponse(rawResponse, DealAnalysisResponseSchema)

  // 6. Upsert DealAnalysis record
  const dealAnalysis = await db.dealAnalysis.upsert({
    where: { dealId },
    create: {
      dealId,
      summary: analysis.summary,
      successFactors: analysis.successFactors ?? null,
      failureFactors: analysis.failureFactors ?? null,
      keyQuotes: analysis.keyQuotes,
      recommendations: analysis.recommendations ?? null,
      talkRatio: analysis.talkRatio ?? null,
      avgResponseTime: analysis.avgResponseTimeMinutes ?? null,
    },
    update: {
      summary: analysis.summary,
      successFactors: analysis.successFactors ?? null,
      failureFactors: analysis.failureFactors ?? null,
      keyQuotes: analysis.keyQuotes,
      recommendations: analysis.recommendations ?? null,
      talkRatio: analysis.talkRatio ?? null,
      avgResponseTime: analysis.avgResponseTimeMinutes ?? null,
    },
  })

  // 7. Mark deal as analyzed
  const hasAudio = deal.messages.some((m) => m.isAudio)
  const hasText = deal.messages.some((m) => !m.isAudio)
  const analysisType =
    hasAudio && hasText ? "MIXED" : hasAudio ? "AUDIO" : "TEXT"

  await db.deal.update({
    where: { id: dealId },
    data: {
      isAnalyzed: true,
      analysisType,
    },
  })

  return dealAnalysis
}

export async function analyzeDeals(tenantId: string): Promise<number> {
  // Find all unanalyzed closed deals for tenant
  const deals = await db.deal.findMany({
    where: {
      tenantId,
      isAnalyzed: false,
      status: { in: ["WON", "LOST"] },
      messages: { some: {} },
    },
    select: { id: true },
  })

  let analyzedCount = 0

  // Analyze sequentially to respect rate limits
  for (const deal of deals) {
    try {
      await analyzeDeal(deal.id)
      analyzedCount++
    } catch (error) {
      console.error(`Failed to analyze deal ${deal.id}:`, error)
      // Continue with next deal
    }
  }

  return analyzedCount
}
