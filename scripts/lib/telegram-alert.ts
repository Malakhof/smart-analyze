/**
 * telegram-alert.ts — cron-pipeline alert helper.
 *
 * Looks up TelegramConfig per tenant. Falls back to console.warn when
 * not configured (so cron stays runnable before the user creates a bot).
 */
import type { PrismaClient } from "../../src/generated/prisma/client"
import { sendTelegramMessage } from "../../src/lib/telegram/bot"

export async function alertTenant(
  db: PrismaClient,
  tenantId: string,
  text: string
): Promise<void> {
  const cfg = await db.telegramConfig.findUnique({ where: { tenantId } })
  if (!cfg?.isActive || !cfg.botToken || !cfg.chatId) {
    console.warn(`[telegram-fallback tenant=${tenantId}] ${text}`)
    return
  }
  try {
    await sendTelegramMessage(cfg.botToken, cfg.chatId, text)
  } catch (e) {
    console.error(`[telegram-fail tenant=${tenantId}]`, (e as Error).message)
  }
}
