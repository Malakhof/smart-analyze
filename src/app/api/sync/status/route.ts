import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const tenantId = session.user.tenantId

    const configs = await db.crmConfig.findMany({
      where: { tenantId },
      select: {
        id: true,
        provider: true,
        isActive: true,
        lastSyncAt: true,
      },
    })

    const [dealCount, managerCount, funnelCount, messageCount] =
      await Promise.all([
        db.deal.count({ where: { tenantId } }),
        db.manager.count({ where: { tenantId } }),
        db.funnel.count({ where: { tenantId } }),
        db.message.count({
          where: { deal: { tenantId } },
        }),
      ])

    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { dealsUsed: true, dealsLimit: true },
    })

    return NextResponse.json({
      configs,
      stats: {
        deals: dealCount,
        managers: managerCount,
        funnels: funnelCount,
        messages: messageCount,
        dealsUsed: tenant?.dealsUsed ?? 0,
        dealsLimit: tenant?.dealsLimit ?? 0,
      },
    })
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch sync status" },
      { status: 500 },
    )
  }
}
