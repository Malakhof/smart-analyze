/**
 * telegram-alert.ts — cron-pipeline alert helper.
 *
 * Resolution order (first match wins):
 *   1. Per-tenant TelegramConfig (multi-tenant: each tenant can have its own
 *      bot/chat — e.g. РОП группы клиента).
 *   2. Global env TELEGRAM_BOT_TOKEN + TELEGRAM_ADMIN_CHAT_ID — admin alerts
 *      (cron infrastructure, GPU cap, cookie auth fail). Always reach the
 *      smart-analyze owner regardless of tenant config.
 *   3. console.warn — last-resort fallback ONLY when neither is set.
 */
import type { PrismaClient } from "../../src/generated/prisma/client"
import { sendTelegramMessage } from "../../src/lib/telegram/bot"

interface TenantTelegramRow {
  isActive: boolean
  botToken: string | null
  chatId: string | null
}

export async function alertTenant(
  db: PrismaClient,
  tenantId: string,
  text: string,
): Promise<void> {
  // 1. Try per-tenant config first (raw query — TelegramConfig may not be in
  //    Prisma client when models drift; safer than db.telegramConfig.findUnique).
  let perTenantSent = false
  let perTenantChatId: string | null = null
  try {
    const rows = await db.$queryRawUnsafe<TenantTelegramRow[]>(
      `SELECT "isActive", "botToken", "chatId" FROM "TelegramConfig"
       WHERE "tenantId" = $1 LIMIT 1`,
      tenantId,
    )
    const cfg = rows[0]
    if (cfg?.isActive && cfg.botToken && cfg.chatId) {
      await sendTelegramMessage(cfg.botToken, cfg.chatId, text)
      perTenantSent = true
      perTenantChatId = cfg.chatId
    }
  } catch (e) {
    console.warn(`[telegram-tenant-cfg-fail ${tenantId}] ${(e as Error).message}`)
  }

  // 2. ALWAYS also send to admin (env-based) — operator wants visibility on
  //    every tenant alert. Skips silently when env vars absent OR when the
  //    admin chat is identical to the tenant chat we just sent to (avoids
  //    duplicate notification for solo-tenant setups like diva).
  const adminToken = process.env.TELEGRAM_BOT_TOKEN
  const adminChat = process.env.TELEGRAM_ADMIN_CHAT_ID
  const adminEqualsTenant = perTenantChatId && adminChat === perTenantChatId
  if (adminToken && adminChat && !adminEqualsTenant) {
    try {
      const tenantPrefix = perTenantSent ? `[also→admin tenant=${tenantId}] ` : `[tenant=${tenantId}] `
      await sendTelegramMessage(adminToken, adminChat, tenantPrefix + text)
      return
    } catch (e) {
      console.error(`[telegram-admin-fail] ${(e as Error).message}`)
    }
  }

  // 3. Console fallback only when NOTHING configured.
  if (!perTenantSent && !(adminToken && adminChat)) {
    console.warn(`[telegram-fallback tenant=${tenantId}] ${text}`)
  }
}
