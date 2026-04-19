/**
 * Seed universal sales script per tenant — 7 items aligned to standard B2B sales call.
 * Idempotent: skips if "Универсальный sales-скрипт" already exists.
 *
 * Usage:
 *   docker run --rm --network smart-analyze_default -v /root/smart-analyze:/app -w /app \
 *     node:22-slim sh -c 'set -a && . /app/.env && set +a && \
 *       ./node_modules/.bin/tsx scripts/seed-universal-scripts.ts'
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const SCRIPT_NAME = "Универсальный sales-скрипт"

const ITEMS = [
  {
    text: "Менеджер представился по имени, назвал компанию",
    weight: 1.0,
    isCritical: false,
    order: 1,
  },
  {
    text: "Менеджер выявил потребность клиента уточняющими вопросами (бюджет, сроки, объём, цель)",
    weight: 2.0,
    isCritical: true,
    order: 2,
  },
  {
    text: "Менеджер сделал конкретное предложение с цифрами (цена, варианты, сроки)",
    weight: 2.0,
    isCritical: false,
    order: 3,
  },
  {
    text: "Менеджер отработал возражения клиента (цена, сомнения, альтернативы)",
    weight: 2.0,
    isCritical: true,
    order: 4,
  },
  {
    text: "Менеджер договорился о следующем шаге (звонок, встреча, оплата, документы)",
    weight: 2.0,
    isCritical: true,
    order: 5,
  },
  {
    text: "Менеджер вёл диалог вежливо и активно (без долгих пауз, не перебивал)",
    weight: 1.0,
    isCritical: false,
    order: 6,
  },
  {
    text: "Менеджер закрыл звонок чётким резюме договорённостей",
    weight: 1.0,
    isCritical: false,
    order: 7,
  },
]

async function main() {
  const adapterPg = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter: adapterPg })

  const tenants = await db.tenant.findMany({
    select: { id: true, name: true },
  })

  for (const tenant of tenants) {
    const existing = await db.script.findFirst({
      where: { tenantId: tenant.id, name: SCRIPT_NAME },
    })
    if (existing) {
      console.log(`  ${tenant.name}: script already exists (id=${existing.id})`)
      continue
    }
    const created = await db.script.create({
      data: {
        tenantId: tenant.id,
        name: SCRIPT_NAME,
        isActive: true,
        items: {
          create: ITEMS,
        },
      },
      include: { items: true },
    })
    console.log(
      `  ${tenant.name}: created script ${created.id} with ${created.items.length} items`
    )
  }

  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
