import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { z } from "zod"
import { authOptions } from "@/lib/auth"
import {
  transcribeUnprocessedMessages,
  transcribeSingleMessage,
} from "@/lib/audio/transcribe"

const batchSchema = z.object({
  tenantId: z.string().min(1),
})

const singleSchema = z.object({
  messageId: z.string().min(1),
})

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()

    // Single message transcription
    if ("messageId" in body) {
      const result = singleSchema.safeParse(body)
      if (!result.success) {
        return NextResponse.json(
          { error: result.error.issues[0].message },
          { status: 400 },
        )
      }

      const text = await transcribeSingleMessage(result.data.messageId)
      return NextResponse.json({ success: true, text })
    }

    // Batch transcription for tenant
    if ("tenantId" in body) {
      const result = batchSchema.safeParse(body)
      if (!result.success) {
        return NextResponse.json(
          { error: result.error.issues[0].message },
          { status: 400 },
        )
      }

      // Ensure user can only transcribe their own tenant's messages
      if (result.data.tenantId !== session.user.tenantId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }

      const count = await transcribeUnprocessedMessages(result.data.tenantId)
      return NextResponse.json({ success: true, transcribedCount: count })
    }

    return NextResponse.json(
      { error: "Request must include messageId or tenantId" },
      { status: 400 },
    )
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Transcription failed"
    console.error("Transcription error:", error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
