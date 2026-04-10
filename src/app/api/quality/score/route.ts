import { NextResponse } from "next/server"
import { z } from "zod"
import { scoreCall, scoreUnprocessedCalls } from "@/lib/ai/score-call"

const singleSchema = z.object({
  callRecordId: z.string().min(1),
})

const batchSchema = z.object({
  tenantId: z.string().min(1),
})

export async function POST(request: Request) {
  try {
    const body = await request.json()

    // Single call scoring
    const singleResult = singleSchema.safeParse(body)
    if (singleResult.success) {
      const score = await scoreCall(singleResult.data.callRecordId)
      return NextResponse.json({ score })
    }

    // Batch scoring
    const batchResult = batchSchema.safeParse(body)
    if (batchResult.success) {
      const count = await scoreUnprocessedCalls(batchResult.data.tenantId)
      return NextResponse.json({ scored: count })
    }

    return NextResponse.json(
      { error: "Provide callRecordId or tenantId" },
      { status: 400 },
    )
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to score call"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
