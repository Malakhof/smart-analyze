import { z } from "zod"
import { db } from "@/lib/db"
import { ai, AI_MODEL } from "./client"
import { PATTERN_EXTRACTION_PROMPT, INSIGHT_GENERATION_PROMPT } from "./prompts"
import type { ManagerStatus } from "@/generated/prisma/client"

// --- Schemas ---

const PatternSchema = z.object({
  type: z.enum(["success", "failure"]),
  title: z.string(),
  description: z.string(),
  dealIds: z.array(z.string()),
  managerNames: z.array(z.string()).optional(),
})

const PatternsResponseSchema = z.object({
  patterns: z.array(PatternSchema),
})

const InsightQuoteSchema = z.object({
  text: z.string(),
  dealCrmId: z.string().optional(),
})

const InsightSchema = z.object({
  type: z.enum(["success", "failure"]),
  title: z.string(),
  content: z.string(),
  detailedDescription: z.string().optional(),
  quotes: z.array(InsightQuoteSchema).optional(),
})

const InsightsResponseSchema = z.object({
  insights: z.array(InsightSchema),
})

// --- Helpers ---

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
  let cleaned = raw.trim()
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
  }
  const parsed = JSON.parse(cleaned)
  return schema.parse(parsed)
}

function calculateManagerStatus(
  conversionRate: number,
  avgConversion: number,
): ManagerStatus {
  if (conversionRate >= avgConversion * 1.2) return "EXCELLENT"
  if (conversionRate >= avgConversion * 0.8) return "WATCH"
  return "CRITICAL"
}

// --- Main ---

export async function extractPatterns(tenantId: string): Promise<number> {
  // 1. Fetch all analyzed deals (WON + LOST) with DealAnalysis
  const deals = await db.deal.findMany({
    where: {
      tenantId,
      isAnalyzed: true,
      status: { in: ["WON", "LOST"] },
      analysis: { isNot: null },
    },
    include: {
      analysis: true,
      manager: { select: { id: true, name: true } },
    },
  })

  if (deals.length === 0) return 0

  // 2. Build input for pattern extraction
  const dealSummaries = deals.map((d) => ({
    dealId: d.id,
    dealCrmId: d.crmId ?? d.id,
    managerName: d.manager?.name ?? "Unknown",
    status: d.status,
    summary: d.analysis!.summary,
    successFactors: d.analysis!.successFactors,
    failureFactors: d.analysis!.failureFactors,
  }))

  const userMessage = `Вот анализы ${deals.length} сделок:\n\n${JSON.stringify(dealSummaries, null, 2)}`

  // 3. Call DeepSeek for pattern extraction
  const rawPatterns = await callDeepSeek(PATTERN_EXTRACTION_PROMPT, userMessage)
  const { patterns } = parseJsonResponse(rawPatterns, PatternsResponseSchema)

  // Build lookup maps
  const dealMap = new Map(deals.map((d) => [d.id, d]))
  const wonIds = new Set(deals.filter((d) => d.status === "WON").map((d) => d.id))
  const lostIds = new Set(deals.filter((d) => d.status === "LOST").map((d) => d.id))
  const totalDeals = deals.length

  // Collect unique manager IDs from deals for manager metric computation
  const managerIds = [...new Set(deals.map((d) => d.manager?.id).filter(Boolean))] as string[]

  // 4. Build new patterns, then atomically swap old → new in a transaction
  const newPatterns: Array<{
    data: {
      tenantId: string
      type: "SUCCESS" | "FAILURE"
      title: string
      description: string
      strength: number
      impact: number
      reliability: number
      coverage: number
      dealCount: number
      managerCount: number
    }
    dealIds: string[]
  }> = []

  for (const p of patterns) {
    // Only keep dealIds that actually exist in our fetched deals
    const validDealIds = p.dealIds.filter((id) => dealMap.has(id))
    if (validDealIds.length < 2) continue

    // Calculate metrics
    const patternDealManagers = new Set(
      validDealIds.map((id) => dealMap.get(id)?.manager?.id).filter(Boolean),
    )

    const strength = Math.min(100, Math.round((validDealIds.length / totalDeals) * 100 * 3))
    const wonInPattern = validDealIds.filter((id) => wonIds.has(id)).length
    const lostInPattern = validDealIds.filter((id) => lostIds.has(id)).length
    const patternConversion = wonInPattern / validDealIds.length
    const overallConversion = wonIds.size / totalDeals
    const impact = Math.round(Math.abs(patternConversion - overallConversion) * 100)
    const reliability = Math.round((patternDealManagers.size / Math.max(managerIds.length, 1)) * 100)
    const relevantDeals = p.type === "success" ? wonIds.size : lostIds.size
    const coverage = Math.round((validDealIds.length / Math.max(relevantDeals, 1)) * 100)

    newPatterns.push({
      data: {
        tenantId,
        type: p.type === "success" ? "SUCCESS" : "FAILURE",
        title: p.title,
        description: p.description,
        strength: Math.min(strength, 100),
        impact: Math.min(impact, 100),
        reliability: Math.min(reliability, 100),
        coverage: Math.min(coverage, 100),
        dealCount: validDealIds.length,
        managerCount: patternDealManagers.size,
      },
      dealIds: validDealIds,
    })
  }

  let patternCount = 0

  await db.$transaction(async (tx) => {
    // Delete old patterns + deal-pattern links
    await tx.dealPattern.deleteMany({
      where: { pattern: { tenantId } },
    })
    await tx.pattern.deleteMany({
      where: { tenantId },
    })

    // Create new patterns and links
    for (const np of newPatterns) {
      const pattern = await tx.pattern.create({ data: np.data })

      await tx.dealPattern.createMany({
        data: np.dealIds.map((dealId) => ({
          dealId,
          patternId: pattern.id,
        })),
      })

      patternCount++
    }
  })

  // 6. Generate department insights
  const keyQuotes = deals
    .filter((d) => d.analysis?.keyQuotes)
    .flatMap((d) => {
      const quotes = d.analysis!.keyQuotes as Array<{
        text: string
        context: string
        isPositive: boolean
      }>
      return quotes.map((q) => ({
        text: q.text,
        dealCrmId: d.crmId ?? d.id,
        isPositive: q.isPositive,
      }))
    })
    .slice(0, 50) // Limit to keep prompt reasonable

  const insightInput = {
    patterns: patterns.map((p) => ({
      type: p.type,
      title: p.title,
      description: p.description,
      dealCount: p.dealIds.filter((id) => dealMap.has(id)).length,
    })),
    stats: {
      totalDeals: deals.length,
      wonDeals: wonIds.size,
      lostDeals: lostIds.size,
      conversionRate: Math.round((wonIds.size / totalDeals) * 100),
    },
    keyQuotes,
  }

  const rawInsights = await callDeepSeek(
    INSIGHT_GENERATION_PROMPT,
    JSON.stringify(insightInput, null, 2),
  )
  const { insights } = parseJsonResponse(rawInsights, InsightsResponseSchema)

  // Build new insights, then atomically swap old → new
  const newInsights = insights.map((ins) => {
    const relatedDealIds = deals
      .filter((d) => {
        if (!ins.quotes) return false
        const dQuotes = d.analysis?.keyQuotes as Array<{ text: string }> | undefined
        if (!dQuotes) return false
        return ins.quotes.some((iq) =>
          dQuotes.some((dq) => dq.text === iq.text),
        )
      })
      .map((d) => d.id)

    const relatedManagerIds: string[] = [
      ...new Set(
        relatedDealIds
          .map((id) => dealMap.get(id)?.manager?.id)
          .filter((id): id is string => id != null),
      ),
    ]

    return {
      tenantId,
      type: ins.type === "success" ? "SUCCESS_INSIGHT" as const : "FAILURE_INSIGHT" as const,
      title: ins.title,
      content: ins.content,
      detailedDescription: ins.detailedDescription ?? null,
      dealIds: relatedDealIds.length > 0 ? relatedDealIds : undefined,
      managerIds: relatedManagerIds.length > 0 ? relatedManagerIds : undefined,
      quotes: ins.quotes ?? undefined,
    }
  })

  await db.$transaction(async (tx) => {
    await tx.insight.deleteMany({ where: { tenantId } })

    for (const data of newInsights) {
      await tx.insight.create({ data })
    }
  })

  // 7. Update Manager cached metrics
  // Calculate overall conversion from ALL tenant deals (not just analyzed ones)
  const allTenantDealCounts = await db.deal.groupBy({
    by: ["status"],
    where: { tenantId, status: { in: ["WON", "LOST"] } },
    _count: true,
  })
  const allWon = allTenantDealCounts.find((g) => g.status === "WON")?._count ?? 0
  const allTotal = allTenantDealCounts.reduce((sum, g) => sum + g._count, 0)
  const overallConversion = allTotal > 0 ? allWon / allTotal : 0

  for (const managerId of managerIds) {
    const managerDeals = deals.filter((d) => d.manager?.id === managerId)
    const total = managerDeals.length
    const success = managerDeals.filter((d) => d.status === "WON").length
    const conversion = total > 0 ? success / total : 0

    const wonDeals = managerDeals.filter((d) => d.status === "WON" && d.amount)
    const avgValue =
      wonDeals.length > 0
        ? wonDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0) / wonDeals.length
        : null

    const dealsWithDuration = managerDeals.filter((d) => d.duration != null)
    const avgTime =
      dealsWithDuration.length > 0
        ? dealsWithDuration.reduce((sum, d) => sum + (d.duration ?? 0), 0) /
          dealsWithDuration.length
        : null

    // Calculate average talkRatio from analyses
    const analyses = managerDeals
      .map((d) => d.analysis)
      .filter((a) => a?.talkRatio != null)
    const avgTalkRatio =
      analyses.length > 0
        ? analyses.reduce((sum, a) => sum + (a!.talkRatio ?? 0), 0) /
          analyses.length
        : null

    await db.manager.update({
      where: { id: managerId },
      data: {
        totalDeals: total,
        successDeals: success,
        conversionRate: Math.round(conversion * 100),
        avgDealValue: avgValue ? Math.round(avgValue) : null,
        avgDealTime: avgTime ? Math.round(avgTime) : null,
        talkRatio: avgTalkRatio ? Math.round(avgTalkRatio * 100) / 100 : null,
        status: total >= 3 ? calculateManagerStatus(conversion, overallConversion) : null,
      },
    })
  }

  return patternCount
}
