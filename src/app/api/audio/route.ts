import { requireAuth } from "@/lib/auth"

// GET /api/audio?url=http://80.76.60.130:8089/recordings/xxx.wav
// Proxies audio with Range support (required for Safari <audio>)
export async function GET(request: Request) {
  try { await requireAuth() } catch { return new Response("Unauthorized", { status: 401 }) }
  const { searchParams } = new URL(request.url)
  const audioUrl = searchParams.get("url")
  if (!audioUrl) return new Response("Missing url param", { status: 400 })

  // SSRF protection: only allow known audio sources used by our connected CRMs
  // and call-recording vendors. Patterns include amoCRM tenants, GC fileservers,
  // and the major Russian VOIP recording providers (Sipuni, Gravitel, AICall).
  const allowedPatterns: RegExp[] = [
    /^http:\/\/80\.76\.60\.130:8089\/recordings\//,        // legacy local recordings
    /^https:\/\/dl\.amocrm\.ru\//,
    /^https:\/\/[a-z0-9-]+\.amocrm\.ru\//,                  // any amoCRM tenant
    /^https:\/\/sipuni\.com\//,                             // Sipuni VOIP (reklama)
    /^https:\/\/records\.sipuni\.com\//,
    /^https:\/\/records\.gravitel\.ru\//,                   // Gravitel (vastu)
    /^https:\/\/records\.aicall\.ru\//,                     // AICall
    /^https:\/\/fs\d+\.getcourse\.ru\//,                    // GC file servers (fs01..fs99)
    /^https:\/\/fileservice\.getcourse\.ru\//,
  ]
  const isAllowed = allowedPatterns.some((re) => re.test(audioUrl))
  if (!isAllowed || audioUrl.includes("..")) {
    return new Response("URL not allowed", { status: 403 })
  }

  try {
    const range = request.headers.get("Range")

    // Forward Range header to origin
    const headers: Record<string, string> = {}
    if (range) headers["Range"] = range

    const res = await fetch(audioUrl, { headers })
    if (!res.ok && res.status !== 206)
      return new Response("Audio not found", { status: 404 })

    const contentType = res.headers.get("Content-Type") || "audio/wav"
    // Some providers (Sipuni) return HTTP 200 with text/html for expired/unlicensed
    // recordings (body is "User is not licensed" or "Session expired"). Detect and
    // surface a real 404 so the <audio> element fires onError.
    if (contentType.startsWith("text/")) {
      return new Response("Audio expired or unavailable", { status: 410 })
    }
    const contentLength = res.headers.get("Content-Length") || ""
    const contentRange = res.headers.get("Content-Range") || ""

    const responseHeaders: Record<string, string> = {
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
    }

    if (contentLength) responseHeaders["Content-Length"] = contentLength
    if (contentRange) responseHeaders["Content-Range"] = contentRange

    return new Response(res.body, {
      status: range && res.status === 206 ? 206 : 200,
      headers: responseHeaders,
    })
  } catch {
    return new Response("Failed to fetch audio", { status: 500 })
  }
}
