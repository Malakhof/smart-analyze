import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"

const bitrixSchema = z.object({
  provider: z.literal("BITRIX24"),
  webhookUrl: z.string().url("Invalid webhook URL"),
  funnelId: z.string().optional(),
})

const amocrmSchema = z.object({
  provider: z.literal("AMOCRM"),
  subdomain: z.string().min(1, "Subdomain is required"),
  apiKey: z.string().min(1, "API key is required"),
})

const getcourseSchema = z.object({
  provider: z.literal("GETCOURSE"),
  subdomain: z.string().min(1, "Account name is required"),
  gcEmail: z.string().email("Valid email required"),
  gcPassword: z.string().min(1, "Password is required"),
})

const crmConfigSchema = z.discriminatedUnion("provider", [
  bitrixSchema,
  amocrmSchema,
  getcourseSchema,
])

async function getTenantId(): Promise<string | null> {
  const tenant = await db.tenant.findFirst({
    select: { id: true },
  })
  return tenant?.id ?? null
}

export async function GET() {
  try {
    const tenantId = await getTenantId()
    if (!tenantId) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 })
    }

    const configs = await db.crmConfig.findMany({
      where: { tenantId },
    })

    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, plan: true, dealsUsed: true, dealsLimit: true },
    })

    const funnels = await db.funnel.findMany({
      where: { tenantId },
      select: { id: true, name: true },
    })

    return NextResponse.json({ configs, tenant, funnels })
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch CRM config" },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const tenantId = await getTenantId()
    if (!tenantId) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 })
    }

    const body = await request.json()
    const result = crmConfigSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0].message },
        { status: 400 },
      )
    }

    const data = result.data

    // Upsert: find existing config for this provider or create new
    const existing = await db.crmConfig.findFirst({
      where: { tenantId, provider: data.provider },
    })

    function getProviderData(d: typeof data) {
      switch (d.provider) {
        case "BITRIX24":
          return { webhookUrl: d.webhookUrl, isActive: true }
        case "AMOCRM":
          return { subdomain: d.subdomain, apiKey: d.apiKey, isActive: true }
        case "GETCOURSE":
          return { subdomain: d.subdomain, gcEmail: d.gcEmail, gcPassword: d.gcPassword, isActive: true }
      }
    }

    if (existing) {
      const updated = await db.crmConfig.update({
        where: { id: existing.id },
        data: getProviderData(data),
      })
      return NextResponse.json({ config: updated })
    }

    const created = await db.crmConfig.create({
      data: {
        tenantId,
        provider: data.provider,
        ...getProviderData(data),
      },
    })

    return NextResponse.json({ config: created }, { status: 201 })
  } catch {
    return NextResponse.json(
      { error: "Failed to save CRM config" },
      { status: 500 },
    )
  }
}
