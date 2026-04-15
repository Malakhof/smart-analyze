import { requireTenantId } from "@/lib/auth"
export const dynamic = "force-dynamic"

import { Suspense } from "react"
import {
  getDashboardStats,
  getFunnelData,
  getManagerRanking,
  getInsights,
  getDailyConversion,
} from "@/lib/queries/dashboard"
import { PeriodFilter } from "./_components/period-filter"
import { FunnelChart } from "./_components/funnel-chart"
import { SuccessFailCards } from "./_components/success-fail-cards"
import { RevenuePotential } from "./_components/revenue-potential"
import { KeyMetrics } from "./_components/key-metrics"
import { ConversionChart } from "./_components/conversion-chart"
import { ManagerRatingTable } from "./_components/manager-rating-table"
import { AiInsights } from "./_components/ai-insights"

export default async function DashboardPage() {
  const tenantId = await requireTenantId()

}
