import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { z } from "zod"
import { authOptions } from "@/lib/auth"
import { extractPatterns } from "@/lib/ai/extract-patterns"

const bodySchema = z.object({
  tenantId: z.string().min(1),
})

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const result = bodySchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0].message },
        { status: 400 },
      )
    }

    // Ensure user can only extract patterns for their own tenant
    if (result.data.tenantId !== session.user.tenantId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const patternsFound = await extractPatterns(result.data.tenantId)
    return NextResponse.json({ success: true, patternsFound })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Pattern extraction failed"
    console.error("Pattern extraction error:", error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
