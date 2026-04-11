// GET /api/audio?url=http://80.76.60.130:8089/recordings/xxx.wav
// Proxies the audio file from internal URL to the browser
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const audioUrl = searchParams.get("url")
  if (!audioUrl) return new Response("Missing url param", { status: 400 })

  try {
    const res = await fetch(audioUrl)
    if (!res.ok) return new Response("Audio not found", { status: 404 })
    const body = res.body
    return new Response(body, {
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "audio/wav",
        "Content-Length": res.headers.get("Content-Length") || "",
      },
    })
  } catch {
    return new Response("Failed to fetch audio", { status: 500 })
  }
}
