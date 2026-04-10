import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { z } from "zod"
import { authOptions } from "@/lib/auth"
import { syncFromCrm } from "@/lib/sync/sync-engine"

const syncSchema = z.object({
  crmConfigId: z.string().min(1, "crmConfigId is required"),
})

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const result = syncSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0].message },
        { status: 400 },
      )
    }

    const stats = await syncFromCrm(
      session.user.tenantId,
      result.data.crmConfigId,
    )

    return NextResponse.json({ success: true, stats })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Sync failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
