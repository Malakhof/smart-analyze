import { requireTenantId } from "@/lib/auth"
export const dynamic = "force-dynamic"

import { Suspense } from "react"
import { getPatterns } from "@/lib/queries/patterns"
import { PatternFilter } from "./_components/pattern-filter"
import { PatternCard } from "./_components/pattern-card"

export default async function PatternsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  const tenantId = await requireTenantId()

}
