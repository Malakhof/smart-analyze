import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { encrypt } from "@/lib/crypto"
import { requireTenantId } from "@/lib/auth"

interface AmoTokenResponse {
  token_type: string
  expires_in: number
  access_token: string
  refresh_token: string
}

export async function POST(request: Request) {
  try {
    const tenantId = await requireTenantId()
    const body = await request.json()
    const { clientId, clientSecret, code, redirectUri, subdomain } = body

    if (!clientId || !clientSecret || !code || !redirectUri || !subdomain) {
      return NextResponse.json(
        { error: "Missing required fields: clientId, clientSecret, code, redirectUri, subdomain" },
        { status: 400 }
      )
    }

    const tokenUrl = `https://${subdomain}.amocrm.ru/oauth2/access_token`
    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(15000),
    })

    if (!tokenResponse.ok) {
      const error = await tokenResponse.json().catch(() => ({}))
      return NextResponse.json(
        { error: "amoCRM OAuth failed", details: error },
        { status: 400 }
      )
    }

    const tokens: AmoTokenResponse = await tokenResponse.json()

    const existing = await db.crmConfig.findFirst({
      where: { tenantId, provider: "AMOCRM" },
    })

    const data = {
      provider: "AMOCRM" as const,
      subdomain,
      apiKey: encrypt(tokens.access_token),
      clientId,
      clientSecret: encrypt(clientSecret),
      refreshToken: encrypt(tokens.refresh_token),
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      isActive: true,
    }

    if (existing) {
      await db.crmConfig.update({ where: { id: existing.id }, data })
    } else {
      await db.crmConfig.create({ data: { ...data, tenantId } })
    }

    return NextResponse.json({
      success: true,
      subdomain,
      expiresIn: tokens.expires_in,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    if (msg.includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    console.error("[AMOCRM_OAUTH]", error)
    return NextResponse.json({ error: "OAuth exchange failed" }, { status: 500 })
  }
}
