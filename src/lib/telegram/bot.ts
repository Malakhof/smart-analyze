import { db } from "@/lib/db"

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<boolean> {
  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    },
  )
  return res.ok
}

export async function sendCriticalAlert(
  tenantId: string,
  managerName: string,
  missedItem: string,
  callId: string,
  totalScore?: number,
  clientName?: string,
) {
  const config = await db.telegramConfig.findUnique({
    where: { tenantId },
  })

  if (!config || !config.isActive || !config.alertOnCritical) {
    return
  }

  const clientPart = clientName ? `\nКлиент: ${clientName}` : ""
  const scorePart =
    totalScore !== undefined ? `\nБалл: ${Math.round(totalScore)}%` : ""

  const message = [
    `<b>⚠ Критичный пропуск</b>`,
    ``,
    `Менеджер: <b>${managerName}</b>`,
    `Не выполнил: <b>${missedItem}</b>${clientPart}`,
    `Звонок: ${callId}${scorePart}`,
  ].join("\n")

  await sendTelegramMessage(config.botToken, config.chatId, message)
}
