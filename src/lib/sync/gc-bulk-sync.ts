import { db } from "@/lib/db"
import { fetchGcCalls, fetchGcCallDetail } from "@/lib/crm/getcourse-parser"
import { transcribeAudio } from "@/lib/audio/transcribe"

export interface BulkSyncResult {
  totalCalls: number
  newCalls: number
  transcribed: number
  analyzed: number
  errors: number
}

export async function bulkSyncGetCourseCalls(
  tenantId: string,
  accountUrl: string,
  cookie: string,
  onProgress?: (msg: string) => void
): Promise<BulkSyncResult> {
  const result: BulkSyncResult = {
    totalCalls: 0, newCalls: 0, transcribed: 0, analyzed: 0, errors: 0,
  }

  onProgress?.("Получаю список звонков...")
  const calls = await fetchGcCalls(accountUrl, cookie)
  result.totalCalls = calls.length

  for (const call of calls) {
    try {
      const existing = await db.callRecord.findFirst({
        where: { crmId: call.id, tenantId },
      })
      if (existing) continue

      onProgress?.(`Парсинг звонка ${call.id}...`)
      const detail = await fetchGcCallDetail(accountUrl, cookie, call.id)

      const callRecord = await db.callRecord.create({
        data: {
          tenantId,
          crmId: call.id,
          direction: "INCOMING",
          audioUrl: detail.audioUrl,
          transcript: detail.transcription,
          clientPhone: detail.clientPhone,
          createdAt: new Date(detail.date || Date.now()),
        },
      })
      result.newCalls++

      if (detail.audioUrl && !detail.transcription) {
        onProgress?.(`Транскрибация ${call.id}...`)
        try {
          const text = await transcribeAudio(detail.audioUrl)
          await db.callRecord.update({
            where: { id: callRecord.id },
            data: { transcript: text },
          })
          result.transcribed++
        } catch (e) {
          console.error(`Transcription failed for ${call.id}:`, e)
          result.errors++
        }
      }
    } catch (e) {
      console.error(`Failed to process call ${call.id}:`, e)
      result.errors++
    }
  }

  return result
}
