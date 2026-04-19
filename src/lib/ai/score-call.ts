import { ai, AI_MODEL } from "@/lib/ai/client"
import { CALL_SCORING_PROMPT } from "@/lib/ai/prompts"
import { db } from "@/lib/db"
import { sendCriticalAlert } from "@/lib/telegram/bot"

interface ScoringItem {
  scriptItemId: string
  isDone: boolean
  comment: string
}

interface ScoringResult {
  items: ScoringItem[]
  overallComment: string
  category?: string
  tags?: string[]
}

export async function scoreCall(callRecordId: string) {
  // 1. Fetch call record with transcript
  const callRecord = await db.callRecord.findUnique({
    where: { id: callRecordId },
    include: {
      manager: true,
    },
  })

  if (!callRecord) {
    throw new Error("Call record not found")
  }

  if (!callRecord.transcript) {
    throw new Error("Call record has no transcript")
  }

  // 2. Fetch active script for tenant (with items)
  const script = await db.script.findFirst({
    where: {
      tenantId: callRecord.tenantId,
      isActive: true,
      ...(callRecord.category ? { category: callRecord.category } : {}),
    },
    include: {
      items: {
        orderBy: { order: "asc" },
      },
    },
  })

  if (!script || script.items.length === 0) {
    throw new Error("No active script found for tenant")
  }

  // 3. Build prompt
  const itemsList = script.items
    .map(
      (item, i) =>
        `${i + 1}. [ID: ${item.id}] ${item.text} (вес: ${item.weight}${item.isCritical ? ", КРИТИЧНО" : ""})`,
    )
    .join("\n")

  const userPrompt = `## Транскрипт звонка:\n${callRecord.transcript}\n\n## Пункты скрипта для проверки:\n${itemsList}`

  // 4. Call AI with JSON mode
  const response = await ai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      { role: "system", content: CALL_SCORING_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
  })

  const content = response.choices[0]?.message?.content
  if (!content) {
    throw new Error("Empty AI response")
  }

  const result: ScoringResult = JSON.parse(content)

  // 5. Calculate totalScore based on weights
  let totalWeightedScore = 0
  let totalWeight = 0

  for (const scoredItem of result.items) {
    const scriptItem = script.items.find(
      (si) => si.id === scoredItem.scriptItemId,
    )
    if (scriptItem) {
      totalWeight += scriptItem.weight
      if (scoredItem.isDone) {
        totalWeightedScore += scriptItem.weight
      }
    }
  }

  const totalScore = totalWeight > 0 ? (totalWeightedScore / totalWeight) * 100 : 0

  // 6. Upsert CallScore + CallScoreItems
  // Delete existing score if any
  const existingScore = await db.callScore.findUnique({
    where: { callRecordId },
  })

  if (existingScore) {
    await db.callScore.delete({ where: { id: existingScore.id } })
  }

  const callScore = await db.callScore.create({
    data: {
      callRecordId,
      scriptId: script.id,
      totalScore,
      items: {
        create: result.items
          .filter((item) =>
            script.items.some((si) => si.id === item.scriptItemId),
          )
          .map((item) => ({
            scriptItemId: item.scriptItemId,
            isDone: item.isDone,
            aiComment: item.comment || null,
          })),
      },
    },
    include: {
      items: {
        include: {
          scriptItem: true,
        },
      },
    },
  })

  // 6b. Update CallRecord.category + CallTag rows
  if (result.category) {
    await db.callRecord.update({
      where: { id: callRecordId },
      data: { category: result.category },
    })
  }
  if (result.tags && result.tags.length > 0) {
    // Replace existing tags atomically
    await db.callTag.deleteMany({ where: { callRecordId } })
    await db.callTag.createMany({
      data: result.tags
        .filter((t) => typeof t === "string" && t.trim().length > 0)
        .slice(0, 5)
        .map((t) => ({ callRecordId, tag: t.trim().toLowerCase() })),
    })
  }

  // 7. Check for critical items missed -> send alerts
  const missedCritical = result.items.filter((item) => {
    if (item.isDone) return false
    const scriptItem = script.items.find(
      (si) => si.id === item.scriptItemId,
    )
    return scriptItem?.isCritical === true
  })

  if (missedCritical.length > 0) {
    const managerName = callRecord.manager?.name ?? "Неизвестный"
    for (const missed of missedCritical) {
      const scriptItem = script.items.find(
        (si) => si.id === missed.scriptItemId,
      )
      if (scriptItem) {
        await sendCriticalAlert(
          callRecord.tenantId,
          managerName,
          scriptItem.text,
          callRecord.id,
          totalScore,
          callRecord.clientName ?? undefined,
        )
      }
    }
  }

  // 8. Return score
  return callScore
}

export async function scoreUnprocessedCalls(
  tenantId: string,
): Promise<number> {
  // Find all CallRecords without a CallScore and with transcript
  const unscored = await db.callRecord.findMany({
    where: {
      tenantId,
      transcript: { not: null },
      score: null,
    },
    select: { id: true },
  })

  let count = 0
  for (const record of unscored) {
    try {
      await scoreCall(record.id)
      count++
    } catch {
      // Skip failed scoring, continue with next
    }
  }

  return count
}
