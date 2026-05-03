/**
 * check-api-balances.ts — fires Telegram alert when DeepSeek or Intelion
 * balance falls below configured threshold.
 *
 * Cron: 0 *\/6 * * *  (every 6h).
 * No blocking — work continues; user decides when to top up.
 *
 * Endpoints:
 *   DeepSeek: GET /user/balance         → balance_infos[0].total_balance (USD string)
 *   Intelion: GET /api/v2/users/        → results[0].current_balance_rub_cents (int)
 *
 * Thresholds (override via env):
 *   DEEPSEEK_BALANCE_WARN_USD    default 5
 *   INTELION_BALANCE_WARN_RUB    default 500
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { alertTenant } from "./lib/telegram-alert"

const DEEPSEEK_THRESHOLD = Number(process.env.DEEPSEEK_BALANCE_WARN_USD ?? "5")
const INTELION_THRESHOLD = Number(process.env.INTELION_BALANCE_WARN_RUB ?? "500")

interface BalanceSnapshot {
  deepseekUsd: number | null
  intelionRub: number | null
  errors: string[]
}

export async function fetchBalances(): Promise<BalanceSnapshot> {
  const errors: string[] = []
  let deepseekUsd: number | null = null
  let intelionRub: number | null = null

  try {
    const r = await fetch("https://api.deepseek.com/user/balance", {
      headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j = await r.json() as { balance_infos?: { currency: string; total_balance: string }[] }
    const usd = j.balance_infos?.find((b) => b.currency === "USD")
    if (usd) deepseekUsd = Number(usd.total_balance)
  } catch (e) { errors.push(`deepseek: ${(e as Error).message}`) }

  try {
    const r = await fetch("https://intelion.cloud/api/v2/users/", {
      headers: { Authorization: `Token ${process.env.INTELION_API_TOKEN}` },
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j = await r.json() as { results?: { current_balance_rub_cents: number }[] }
    const cents = j.results?.[0]?.current_balance_rub_cents
    if (typeof cents === "number") intelionRub = cents / 100
  } catch (e) { errors.push(`intelion: ${(e as Error).message}`) }

  return { deepseekUsd, intelionRub, errors }
}

export function formatBalances(s: BalanceSnapshot): string {
  const ds = s.deepseekUsd != null ? `DS $${s.deepseekUsd.toFixed(2)}` : "DS ?"
  const it = s.intelionRub != null ? `Intelion ${s.intelionRub.toFixed(0)}₽` : "Intelion ?"
  return `${ds}, ${it}`
}

async function main() {
  const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter: adapterPg })

  const snap = await fetchBalances()
  const summary = formatBalances(snap)
  console.log(`[balances] ${summary}${snap.errors.length ? ` errors=${snap.errors.join("|")}` : ""}`)

  // Alert tenant 'diva-school' for now (only one in production). When other
  // tenants come online, loop them — each gets ITS OWN balance alert routing
  // via per-tenant TelegramConfig + admin env (see telegram-alert.ts).
  const tenants = await db.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM "Tenant" WHERE name = 'diva-school'`,
  )
  const tenantId = tenants[0]?.id
  if (!tenantId) { console.error("diva-school tenant not found"); await db.$disconnect(); return }

  const warnings: string[] = []
  if (snap.deepseekUsd != null && snap.deepseekUsd < DEEPSEEK_THRESHOLD) {
    warnings.push(`DeepSeek $${snap.deepseekUsd.toFixed(2)} < $${DEEPSEEK_THRESHOLD} — пополни`)
  }
  if (snap.intelionRub != null && snap.intelionRub < INTELION_THRESHOLD) {
    warnings.push(`Intelion ${snap.intelionRub.toFixed(0)}₽ < ${INTELION_THRESHOLD}₽ — пополни`)
  }

  if (warnings.length > 0) {
    await alertTenant(db, tenantId, `💰 ${warnings.join("\n💰 ")}`)
  }

  await db.$disconnect()
}

// Only run main() when invoked directly (not when imported by daily-health-check).
const invokedDirectly = process.argv[1]?.endsWith("check-api-balances.ts")
if (invokedDirectly) {
  main().catch((e) => { console.error("FATAL:", e); process.exit(1) })
}
