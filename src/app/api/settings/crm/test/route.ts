import { NextResponse } from "next/server"
import { z } from "zod"

const testSchema = z.object({
  provider: z.enum(["BITRIX24", "AMOCRM"]),
  webhookUrl: z.string().url().optional(),
  subdomain: z.string().optional(),
  apiKey: z.string().optional(),
})

export async function POST(request: Request) {
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

      // For now, just validate format
      return NextResponse.json({
        success: true,
        company: data.subdomain,
      })
    }

    return NextResponse.json({ error: "Unknown provider" }, { status: 400 })
  } catch {
    return NextResponse.json(
      { error: "Connection test failed" },
      { status: 500 },
    )
  }
}
