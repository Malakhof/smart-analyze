/**
 * Smoke-test: fetch fresh access_token via getAmoCrmAccessToken for the first new client.
 * Prints the CrmConfig state after the call. Does NOT touch the sync engine.
 *
 * Run:
 *   docker run --rm --network smart-analyze_default \
 *     -v /root/smart-analyze:/app -w /app node:22-slim \
 *     sh -c "set -a && . /app/.env && set +a && ./node_modules/.bin/tsx scripts/smoke-amocrm-refresh.ts <tenantName>"
 */
// tsx Node resolver can't do directory imports from "../src/generated/prisma";
// use the explicit /client entry, same as scripts/seed-clients.ts.
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { getAmoCrmAccessToken } from "../src/lib/crm/amocrm-oauth"

const tenantName = process.argv[2]
if (!tenantName) {
  console.error("Usage: tsx scripts/smoke-amocrm-refresh.ts <tenantName>")
  process.exit(1)
}

if (!process.env.DATABASE_URL) {
  console.error("Missing env: DATABASE_URL")
  process.exit(1)
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { name: tenantName } })
  if (!tenant) throw new Error(`Tenant not found: ${tenantName}`)

  const cfg = await prisma.crmConfig.findFirst({
    where: { tenantId: tenant.id, provider: "AMOCRM" },
  })
  if (!cfg) throw new Error(`CrmConfig not found for tenant ${tenantName}`)

  console.log(`Before: apiKey=${cfg.apiKey ? "<present>" : "null"}, expiresAt=${cfg.tokenExpiresAt}`)
  const token = await getAmoCrmAccessToken(cfg.id)
  console.log(`Got access_token (len=${token.length}, prefix=${token.slice(0, 16)}...)`)

  const after = await prisma.crmConfig.findUnique({ where: { id: cfg.id } })
  console.log(`After:  apiKey=${after?.apiKey ? "<stored>" : "null"}, expiresAt=${after?.tokenExpiresAt}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
