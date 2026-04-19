import { z } from "zod"
import { db } from "@/lib/db"
import { ai, AI_MODEL } from "./client"
import { DEAL_ANALYSIS_PROMPT } from "./prompts"
import type { DealAnalysis } from "@/generated/prisma/client"

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
  // Multi-line format with explicit separator so the model can never confuse
  // the "header line" with the actual quote content.
  return messages
    .filter((m) => m.content && m.content.trim().length > 0)
    .map((m) => {
      const role =
        m.sender === "MANAGER"
          ? "МЕНЕДЖЕР"
          : m.sender === "CLIENT"
            ? "КЛИЕНТ"
            : "СИСТЕМА"
      const ts = new Date(m.timestamp)
      const date = ts.toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
      })
      const time = ts.toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      })
      return `--- ${role} (${date} ${time}) ---\n${m.content.trim()}`
    })
    .join("\n\n")
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
  // 1. Fetch deal with messages + transcribed call records
  const deal = await db.deal.findUniqueOrThrow({
    where: { id: dealId },
    include: {
      messages: { orderBy: { timestamp: "asc" } },
      manager: { select: { name: true } },
      callRecords: {
        where: { transcript: { not: null } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          transcript: true,
          duration: true,
          createdAt: true,
          direction: true,
        },
      },
    },
  })

  // Drop SYSTEM noise (amoCRM common notes, GC bot mailings, sms blasts).
  // Keep only actual MANAGER↔CLIENT conversation.
  const realMessages = deal.messages.filter(
    (m) => m.sender !== "SYSTEM" && (m.content?.trim() || m.isAudio)
  )

  if (realMessages.length === 0 && deal.callRecords.length === 0) {
    throw new Error(`Deal ${dealId} has no MANAGER↔CLIENT content to analyze`)
  }

  // 2. Build conversation string (text messages)
  const conversation = formatConversation(realMessages)

  // 2b. Build call transcripts block (already labeled МЕНЕДЖЕР/КЛИЕНТ by Whisper stereo split)
  const callsBlock = deal.callRecords.length
    ? deal.callRecords
        .map((c, i) => {
          const ts = new Date(c.createdAt)
          const date = ts.toLocaleDateString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
          })
          const time = ts.toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
          })
          const dur = c.duration ? ` (${Math.round(c.duration / 60)} мин)` : ""
          return `=== ЗВОНОК ${i + 1} — ${date} ${time}${dur} ===\n${c.transcript}`
        })
        .join("\n\n")
    : ""

  // 3. Build user message with context
  const outcomeLabel =
    deal.status === "WON"
      ? "ВЫИГРАНА"
      : deal.status === "LOST"
        ? "ПРОИГРАНА"
        : "В РАБОТЕ"
  const userMessage = `Статус сделки: ${outcomeLabel}
Название сделки: ${deal.title}
${deal.amount ? `Сумма: ${deal.amount} руб.` : ""}
${deal.manager?.name ? `Менеджер: ${deal.manager.name}` : ""}

${conversation ? `Переписка:\n${conversation}` : ""}

${callsBlock ? `Расшифровки звонков (по ролям):\n${callsBlock}` : ""}`.trim()

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

export interface AnalyzeDealsOptions {
  // Only WON/LOST (best for pattern mining) — false includes OPEN deals too.
  closedOnly?: boolean
  // Cap how many deals to process this run (cost control).
  limit?: number
  // Skip already-analyzed deals (default true; set false to re-analyze).
  skipAnalyzed?: boolean
  // Require at least one transcribed call (good for prioritising rich deals).
  requireTranscript?: boolean
}

export async function analyzeDeals(
  tenantId: string,
  opts: AnalyzeDealsOptions = {}
): Promise<{ analyzed: number; skipped: number; failed: number }> {
  const closedOnly = opts.closedOnly !== false
  const skipAnalyzed = opts.skipAnalyzed !== false

  const deals = await db.deal.findMany({
    where: {
      tenantId,
      ...(skipAnalyzed ? { isAnalyzed: false } : {}),
      ...(closedOnly ? { status: { in: ["WON", "LOST"] } } : {}),
      OR: [
        { messages: { some: { sender: { in: ["MANAGER", "CLIENT"] } } } },
        ...(opts.requireTranscript
          ? []
          : [{ callRecords: { some: { transcript: { not: null } } } }]),
        ...(opts.requireTranscript
          ? [{ callRecords: { some: { transcript: { not: null } } } }]
          : []),
      ],
    },
    select: { id: true },
    orderBy: [{ amount: "desc" }, { createdAt: "desc" }],
    ...(opts.limit ? { take: opts.limit } : {}),
  })

  let analyzed = 0
  let skipped = 0
  let failed = 0

  // Sequential to respect API rate limits.
  for (const [i, deal] of deals.entries()) {
    try {
      await analyzeDeal(deal.id)
      analyzed++
      if ((i + 1) % 10 === 0) {
        console.log(
          `[analyzeDeals] ${i + 1}/${deals.length} done (ok=${analyzed} fail=${failed})`
        )
      }
    } catch (error) {
      const msg = (error as Error).message ?? String(error)
      if (/no MANAGER↔CLIENT content|no messages/.test(msg)) {
        skipped++
      } else {
        failed++
        console.error(`[analyzeDeals] deal ${deal.id} failed:`, msg)
      }
    }
  }

  return { analyzed, skipped, failed }
}
