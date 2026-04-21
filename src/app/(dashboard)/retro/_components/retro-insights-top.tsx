import { AiInsights } from "@/app/(dashboard)/_components/ai-insights"
import type { InsightWithDetails } from "@/lib/queries/dashboard"

interface RetroInsightsTopProps {
  insights: InsightWithDetails[]
}

/**
 * Thin wrapper around the existing AiInsights component so the retro page
 * stays consistent with the live dashboard. Sorting/limiting happens upstream
 * in `getRetroTopInsights`.
 */
export function RetroInsightsTop({ insights }: RetroInsightsTopProps) {
  return <AiInsights insights={insights} />
}
