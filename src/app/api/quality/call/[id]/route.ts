import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getCallDetail } from "@/lib/queries/quality"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const call = await getCallDetail(id)

    if (!call) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    return NextResponse.json(call)
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch call detail"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
