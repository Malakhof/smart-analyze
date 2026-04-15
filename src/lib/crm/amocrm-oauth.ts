import { db } from "@/lib/db"
import { encrypt, decrypt } from "@/lib/crypto"

interface AmoRefreshResponse {
  token_type: string
  expires_in: number
  access_token: string
  refresh_token: string
}

/**
 * Refresh amoCRM access token if expired or about to expire (5 min buffer).
 * Returns decrypted access_token ready to use.
 */
export async function getAmoCrmAccessToken(crmConfigId: string): Promise<string> {
  const config = await db.crmConfig.findUniqueOrThrow({
    where: { id: crmConfigId },
  })

  if (!config.apiKey) throw new Error("No access token stored")

  // Check if token is still valid (with 5 min buffer)
  const now = new Date()
  const buffer = 5 * 60 * 1000
  const isExpired = config.tokenExpiresAt && config.tokenExpiresAt.getTime() - buffer < now.getTime()

  if (!isExpired) {
    // Token still valid — decrypt and return
    try {
      return decrypt(config.apiKey)
    } catch {
      // Not encrypted (legacy) — return as-is
      return config.apiKey
    }
  }

  // Token expired — refresh
  if (!config.refreshToken || !config.clientId || !config.clientSecret || !config.subdomain) {
    throw new Error("Missing OAuth credentials for token refresh")
  }

  const refreshToken = decrypt(config.refreshToken)
  const clientSecret = decrypt(config.clientSecret)

  const tokenUrl = `https://${config.subdomain}.amocrm.ru/oauth2/access_token`
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      redirect_uri: "https://sa.qupai.ru/api/auth/amocrm/callback",
    }),
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    console.error("[AMOCRM_REFRESH] Failed:", error)
    throw new Error("amoCRM token refresh failed")
  }

  const tokens: AmoRefreshResponse = await response.json()

  // Update stored tokens
  await db.crmConfig.update({
    where: { id: crmConfigId },
    data: {
      apiKey: encrypt(tokens.access_token),
      refreshToken: encrypt(tokens.refresh_token),
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    },
  })

  return tokens.access_token
}
