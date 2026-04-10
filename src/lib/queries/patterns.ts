import { db } from "@/lib/db"
import { getTenantId } from "./dashboard"

export interface PatternQuote {
  text: string
  dealCrmId?: string
}

export interface PatternDeal {
  id: string
  crmId: string | null
}

export interface PatternManager {
  id: string
  name: string
}

export interface PatternData {
  id: string
  type: "SUCCESS" | "FAILURE"
  title: string
  description: string
  strength: number
  impact: number
  reliability: number
  coverage: number
  dealCount: number
  managerCount: number
  deals: PatternDeal[]
  managers: PatternManager[]
  quotes: PatternQuote[]
}

export async function getPatterns(
  tenantId: string,
  filter?: "success" | "failure"
): Promise<PatternData[]> {
  const typeFilter =
    filter === "success"
      ? "SUCCESS"
      : filter === "failure"
        ? "FAILURE"
        : undefined

  const patterns = await db.pattern.findMany({
    where: {
      tenantId,
      ...(typeFilter ? { type: typeFilter } : {}),
    },
    orderBy: [{ type: "asc" }, { strength: "desc" }],
    include: {
      dealPatterns: {
        include: {
          deal: {
            select: {
              id: true,
              crmId: true,
              managerId: true,
              manager: { select: { id: true, name: true } },
              analysis: {
                select: {
                  keyQuotes: true,
                },
              },
            },
          },
        },
      },
    },
  })

  return patterns.map((p) => {
    const deals: PatternDeal[] = p.dealPatterns.map((dp) => ({
      id: dp.deal.id,
      crmId: dp.deal.crmId,
    }))

    // Unique managers from linked deals
    const managerMap = new Map<string, string>()
    for (const dp of p.dealPatterns) {
      if (dp.deal.manager) {
        managerMap.set(dp.deal.manager.id, dp.deal.manager.name)
      }
    }
    const managers: PatternManager[] = Array.from(managerMap.entries()).map(
      ([id, name]) => ({ id, name })
    )

    // Collect quotes from linked deal analyses
    const quotes: PatternQuote[] = []
    for (const dp of p.dealPatterns) {
      if (dp.deal.analysis?.keyQuotes) {
        const kq = dp.deal.analysis.keyQuotes as Array<{
          text: string
          dealCrmId?: string
          isPositive?: boolean
        }>
        for (const q of kq) {
          quotes.push({ text: q.text, dealCrmId: q.dealCrmId })
        }
      }
    }

    return {
      id: p.id,
      type: p.type as "SUCCESS" | "FAILURE",
      title: p.title,
      description: p.description,
      strength: p.strength,
      impact: p.impact,
      reliability: p.reliability,
      coverage: p.coverage,
      dealCount: p.dealCount,
      managerCount: p.managerCount,
      deals,
      managers,
      quotes,
    }
  })
}

export { getTenantId }
