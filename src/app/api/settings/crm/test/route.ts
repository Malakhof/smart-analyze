import { NextResponse } from "next/server"
import { z } from "zod"
import { AmoCrmAdapter } from "@/lib/crm/amocrm"
import { requireAuth } from "@/lib/auth"

const testSchema = z.object({
  provider: z.enum(["BITRIX24", "AMOCRM", "GETCOURSE"]),
  webhookUrl: z.string().url().optional(),
  subdomain: z.string().optional(),
  apiKey: z.string().optional(),
})

export async function POST(request: Request) {
  try {
    await requireAuth()
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const result = testSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0].message },
        { status: 400 },
      )
    }

    const data = result.data

    if (data.provider === "BITRIX24") {
      if (!data.webhookUrl) {
        return NextResponse.json(
          { error: "Webhook URL is required" },
          { status: 400 },
        )
      }

      // Test Bitrix24 connection by calling profile endpoint
      try {
        const testUrl = data.webhookUrl.replace(/\/$/, "") + "/profile.json"
        const response = await fetch(testUrl, {
          method: "GET",
          signal: AbortSignal.timeout(10000),
        })

        if (!response.ok) {
          return NextResponse.json(
            { success: false, error: "Bitrix24 returned an error. Check your webhook URL." },
            { status: 200 },
          )
        }

        const profileData = await response.json()
        return NextResponse.json({
          success: true,
          company: profileData.result?.LAST_NAME
            ? `${profileData.result.LAST_NAME} ${profileData.result.NAME}`
            : "Connected",
        })
      } catch {
        return NextResponse.json(
          { success: false, error: "Could not reach Bitrix24. Check your webhook URL." },
          { status: 200 },
        )
      }
    }

    if (data.provider === "AMOCRM") {
      if (!data.subdomain || !data.apiKey) {
        return NextResponse.json(
          { error: "Subdomain and API key are required" },
          { status: 400 },
        )
      }

      try {
        const amoAdapter = new AmoCrmAdapter(data.subdomain, data.apiKey)
        const amoOk = await amoAdapter.testConnection()
        return NextResponse.json({ success: amoOk })
      } catch {
        return NextResponse.json(
          { success: false, error: "Could not reach amoCRM. Check your subdomain and API key." },
          { status: 200 },
        )
      }
    }

    if (data.provider === "GETCOURSE") {
      if (!data.subdomain) {
        return NextResponse.json(
          { error: "Account name is required" },
          { status: 400 },
        )
      }

      try {
        const testUrl = `https://${data.subdomain}.getcourse.ru/cms/system/login`
        const response = await fetch(testUrl, {
          method: "GET",
          signal: AbortSignal.timeout(10000),
        })
        return NextResponse.json({ success: response.ok })
      } catch {
        return NextResponse.json(
          { success: false, error: "Could not reach GetCourse. Check your account name." },
          { status: 200 },
        )
      }
    }

    return NextResponse.json({ error: "Unknown provider" }, { status: 400 })
  } catch {
    return NextResponse.json(
      { error: "Connection test failed" },
      { status: 500 },
    )
  }
}
