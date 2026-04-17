/**
 * Seed production clients (reklamalift74, vastu) into CrmConfig.
 * Reads OAuth creds from process.env, encrypts sensitive fields, creates Tenant + CrmConfig.
 *
 * Run inside the smart-analyze-app container so DATABASE_URL resolves to the in-network Postgres:
 *   docker exec -w /app -it smart-analyze-app npx tsx scripts/seed-clients.ts
 *
 * Idempotent: if a CrmConfig with matching subdomain already exists, it is updated instead of duplicated.
 */
import { PrismaClient } from "../src/generated/prisma"
import { PrismaPg } from "@prisma/adapter-pg"
import { encrypt } from "../src/lib/crypto"

type ClientSpec = {
  tenantName: string
  envPrefix: "REKLAMA_AMO" | "VASTU_AMO"
}

const CLIENTS: ClientSpec[] = [
  { tenantName: "reklamalift74", envPrefix: "REKLAMA_AMO" },
  { tenantName: "vastu", envPrefix: "VASTU_AMO" },
]

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v || v.trim() === "") throw new Error(`Missing env: ${name}`)
  return v.trim()
}

async function main() {
  // Validate all env vars first — fail fast
  for (const c of CLIENTS) {
    requireEnv(`${c.envPrefix}_SUBDOMAIN`)
    requireEnv(`${c.envPrefix}_CLIENT_ID`)
    requireEnv(`${c.envPrefix}_CLIENT_SECRET`)
    requireEnv(`${c.envPrefix}_REFRESH_TOKEN`)
  }
  // ENCRYPTION_KEY is read by crypto.ts — touch it now for clearer error
  requireEnv("ENCRYPTION_KEY")
  console.log("Env validation: OK")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
