import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { requireTenantId } from "@/lib/auth"

const scriptItemSchema = z.object({
  id: z.string().optional(),
  text: z.string().min(1),
  weight: z.number().min(0.5).max(2.0),
  isCritical: z.boolean(),
  order: z.number().int().min(0),
})

const createScriptSchema = z.object({
  name: z.string().min(1),
  category: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  items: z.array(scriptItemSchema),
})

const updateScriptSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  items: z.array(scriptItemSchema),
})

export async function GET() {
  try {
    const tenantId = await requireTenantId()

    const scripts = await db.script.findMany({
      where: { tenantId },
      include: {
        items: {
          orderBy: { order: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json({ scripts })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    return NextResponse.json(
      { error: "Failed to fetch scripts" },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const tenantId = await requireTenantId()

    const body = await request.json()
    const result = createScriptSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0].message },
        { status: 400 },
      )
    }

    const { name, category, isActive, items } = result.data

    const script = await db.script.create({
      data: {
        tenantId,
        name,
        category: category ?? null,
        isActive: isActive ?? true,
        items: {
          create: items.map((item) => ({
            text: item.text,
            weight: item.weight,
            isCritical: item.isCritical,
            order: item.order,
          })),
        },
      },
      include: {
        items: {
          orderBy: { order: "asc" },
        },
      },
    })

    return NextResponse.json({ script }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    return NextResponse.json(
      { error: "Failed to create script" },
      { status: 500 },
    )
  }
}

export async function PUT(request: Request) {
  try {
    const tenantId = await requireTenantId()

    const body = await request.json()
    const result = updateScriptSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0].message },
        { status: 400 },
      )
    }

    const { id, name, category, isActive, items } = result.data

    // Verify script belongs to tenant
    const existing = await db.script.findFirst({
      where: { id, tenantId },
    })

    if (!existing) {
      return NextResponse.json({ error: "Script not found" }, { status: 404 })
    }

    // Delete old items and recreate
    await db.scriptItem.deleteMany({ where: { scriptId: id } })

    const script = await db.script.update({
      where: { id },
      data: {
        name,
        category: category ?? null,
        isActive: isActive ?? existing.isActive,
        items: {
          create: items.map((item) => ({
            text: item.text,
            weight: item.weight,
            isCritical: item.isCritical,
            order: item.order,
          })),
        },
      },
      include: {
        items: {
          orderBy: { order: "asc" },
        },
      },
    })

    return NextResponse.json({ script })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    return NextResponse.json(
      { error: "Failed to update script" },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const tenantId = await requireTenantId()

    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json(
        { error: "Script id is required" },
        { status: 400 },
      )
    }

    const existing = await db.script.findFirst({
      where: { id, tenantId },
    })

    if (!existing) {
      return NextResponse.json({ error: "Script not found" }, { status: 404 })
    }

    await db.script.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    return NextResponse.json(
      { error: "Failed to delete script" },
      { status: 500 },
    )
  }
}
