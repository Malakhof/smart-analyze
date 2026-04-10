import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { sendTelegramMessage } from "@/lib/telegram/bot"

async function getTenantId(): Promise<string | null> {
  const tenant = await db.tenant.findFirst({
    select: { id: true },
  })
  return tenant?.id ?? null
}

const telegramConfigSchema = z.object({
  botToken: z.string().min(1),
  chatId: z.string().min(1),
  isActive: z.boolean().optional(),
  alertOnCritical: z.boolean().optional(),
})

const testSchema = z.object({
  action: z.literal("test"),
  botToken: z.string().min(1),
  chatId: z.string().min(1),
})

export async function GET() {
  try {
    const tenantId = await getTenantId()
    if (!tenantId) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 })
    }

    const config = await db.telegramConfig.findUnique({
      where: { tenantId },
    })

    return NextResponse.json({ config })
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch telegram config" },
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

    // Handle test action
    const testResult = testSchema.safeParse(body)
    if (testResult.success) {
      const { botToken, chatId } = testResult.data
      const ok = await sendTelegramMessage(
        botToken,
        chatId,
        "Smart Analyze: тестовое сообщение. Бот подключён!",
      )
      if (ok) {
        return NextResponse.json({ success: true })
      }
      return NextResponse.json(
        { error: "Не удалось отправить сообщение. Проверьте токен и Chat ID." },
        { status: 400 },
      )
    }

    // Handle save config
    const result = telegramConfigSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0].message },
        { status: 400 },
      )
    }

    const { botToken, chatId, isActive, alertOnCritical } = result.data

    const config = await db.telegramConfig.upsert({
      where: { tenantId },
      update: {
        botToken,
        chatId,
        isActive: isActive ?? true,
        alertOnCritical: alertOnCritical ?? true,
      },
      create: {
        tenantId,
        botToken,
        chatId,
        isActive: isActive ?? true,
        alertOnCritical: alertOnCritical ?? true,
      },
    })

    return NextResponse.json({ config })
  } catch {
    return NextResponse.json(
      { error: "Failed to save telegram config" },
      { status: 500 },
    )
  }
}
