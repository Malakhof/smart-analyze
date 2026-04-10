import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { z } from "zod"
import { authOptions } from "@/lib/auth"
import { analyzeDeal, analyzeDeals } from "@/lib/ai/analyze-deal"

const singleDealSchema = z.object({
  dealId: z.string().min(1),
})

const batchSchema = z.object({
  tenantId: z.string().min(1),
})

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()

    // Single deal analysis
    if ("dealId" in body) {
      const result = singleDealSchema.safeParse(body)
      if (!result.success) {
        return NextResponse.json(
          { error: result.error.issues[0].message },
          { status: 400 },
        )
      }

      const analysis = await analyzeDeal(result.data.dealId)
      return NextResponse.json({ success: true, analysis })
    }

    // Batch analysis for tenant
    if ("tenantId" in body) {
      const result = batchSchema.safeParse(body)
      if (!result.success) {
        return NextResponse.json(
          { error: result.error.issues[0].message },
          { status: 400 },
        )
      }

      // Ensure user can only analyze their own tenant's deals
      if (result.data.tenantId !== session.user.tenantId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }

      const count = await analyzeDeals(result.data.tenantId)
      return NextResponse.json({ success: true, analyzedCount: count })
    }

    return NextResponse.json(
      { error: "Request must include dealId or tenantId" },
      { status: 400 },
    )
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Analysis failed"
    console.error("Deal analysis error:", error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
