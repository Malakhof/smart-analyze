// GET /api/audio?url=http://80.76.60.130:8089/recordings/xxx.wav
// Proxies audio with Range support (required for Safari <audio>)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const audioUrl = searchParams.get("url")
  if (!audioUrl) return new Response("Missing url param", { status: 400 })

  // SSRF protection: only allow known audio sources
  const allowedPrefixes = [
    "http://80.76.60.130:8089/recordings/",
    "https://",
  ]
  const isAllowed = allowedPrefixes.some(prefix => audioUrl.startsWith(prefix))
  if (!isAllowed) {
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
