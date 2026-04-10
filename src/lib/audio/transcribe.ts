import OpenAI from "openai"
import { db } from "@/lib/db"

function getWhisperClient(): OpenAI {
  const apiKey = process.env.WHISPER_API_KEY
  const baseURL = process.env.WHISPER_API_URL || "https://api.openai.com/v1"

  if (!apiKey) {
    throw new Error("WHISPER_API_KEY is not configured")
  }

  return new OpenAI({ apiKey, baseURL })
}

const WHISPER_MODEL = process.env.WHISPER_MODEL || "whisper-1"

export async function transcribeAudio(audioUrl: string): Promise<string> {
  // 1. Download audio from URL to buffer
  const response = await fetch(audioUrl)
  if (!response.ok) {
    throw new Error(
      `Failed to download audio: ${response.status} ${response.statusText}`,
    )
  }

  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // Determine filename from URL for content-type hint
  const urlPath = new URL(audioUrl).pathname
  const extension = urlPath.split(".").pop() || "mp3"
  const filename = `audio.${extension}`

  // 2. Create a File object for the OpenAI API
  const file = new File([buffer], filename, {
    type: `audio/${extension}`,
  })

  // 3. Send to transcription API (OpenAI-compatible endpoint)
  const client = getWhisperClient()
  const transcription = await client.audio.transcriptions.create({
    model: WHISPER_MODEL,
    file,
    language: "ru",
  })

  return transcription.text
}

export async function transcribeUnprocessedMessages(
  tenantId: string,
): Promise<number> {
  // Find all Messages with isAudio=true and empty content for this tenant's deals
  const messages = await db.message.findMany({
    where: {
      deal: { tenantId },
      isAudio: true,
      audioUrl: { not: null },
      content: "",
    },
    select: { id: true, audioUrl: true },
  })

  let transcribedCount = 0

  for (const msg of messages) {
    if (!msg.audioUrl) continue

    try {
      const text = await transcribeAudio(msg.audioUrl)
      await db.message.update({
        where: { id: msg.id },
        data: { content: text },
      })
      transcribedCount++
    } catch (error) {
      console.error(`Failed to transcribe message ${msg.id}:`, error)
      // Continue with next message
    }
  }

  return transcribedCount
}

export async function transcribeSingleMessage(
  messageId: string,
): Promise<string> {
  const message = await db.message.findUniqueOrThrow({
    where: { id: messageId },
    select: { id: true, audioUrl: true, isAudio: true },
  })

  if (!message.isAudio || !message.audioUrl) {
    throw new Error("Message is not an audio message or has no audio URL")
  }

  const text = await transcribeAudio(message.audioUrl)

  await db.message.update({
    where: { id: messageId },
    data: { content: text },
  })

  return text
}
