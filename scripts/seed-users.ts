/**
 * Seed OWNER user for each client tenant so kirill can log in and see dashboards.
 *
 * Run on server:
 *   docker run --rm --network smart-analyze_default -v /root/smart-analyze:/app -w /app \
 *     node:22-slim sh -c 'set -a && . /app/.env && set +a && \
 *       ./node_modules/.bin/tsx scripts/seed-users.ts'
 *
 * Idempotent: if a User with the same email already exists, password is reset
 * to the value below. Multiple tenants can share an email IF Prisma schema allowed
 * but our schema has User.email @unique — so each tenant gets its OWN email.
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import bcrypt from "bcryptjs"

interface Spec {
  tenantName: string
  email: string
  displayName: string
}

const PASSWORD_PLAIN = process.env.SEED_USER_PASSWORD ?? "demo123"

const SEEDS: Spec[] = [
  { tenantName: "reklamalift74", email: "kirill+reklama@smart-analyze.ru", displayName: "Кирилл (РекламаЛифт)" },
  { tenantName: "vastu",         email: "kirill+vastu@smart-analyze.ru",   displayName: "Кирилл (Васту)" },
  { tenantName: "diva-school",   email: "kirill+diva@smart-analyze.ru",    displayName: "Кирилл (Дива)" },
]

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("Missing env: DATABASE_URL")
  }
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const prisma = new PrismaClient({ adapter })

  try {
    const passwordHash = await bcrypt.hash(PASSWORD_PLAIN, 10)

    for (const s of SEEDS) {
      const tenant = await prisma.tenant.findFirst({ where: { name: s.tenantName } })
      if (!tenant) {
        console.log(`  ⚠ Skip ${s.tenantName}: tenant not found`)
        continue
      }
      const existing = await prisma.user.findUnique({ where: { email: s.email } })
      if (existing) {
        await prisma.user.update({
          where: { id: existing.id },
          data: { password: passwordHash, name: s.displayName, tenantId: tenant.id, role: "OWNER" },
        })
        console.log(`  ✓ User UPDATED: ${s.email} → ${s.tenantName}`)
      } else {
        await prisma.user.create({
          data: {
            email: s.email,
            password: passwordHash,
            name: s.displayName,
            tenantId: tenant.id,
            role: "OWNER",
          },
        })
        console.log(`  ✓ User CREATED: ${s.email} → ${s.tenantName}`)
      }
    }
    console.log(`\nLogin via: ${SEEDS.map((s) => s.email).join(" | ")}`)
    console.log(`Password:  ${PASSWORD_PLAIN}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
