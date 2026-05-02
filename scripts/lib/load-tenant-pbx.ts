/**
 * load-tenant-pbx.ts — read Tenant.pbxConfig (encrypted JSON) → typed config.
 *
 * Per migration manual-cron-pipeline.sql, Tenant.pbxConfig holds:
 *   { provider:"ONPBX", domain, keyId, key }   keyId+key encrypted
 *   { provider:"SIPUNI", user, secret }         secret encrypted
 *   { provider:"MEGAPBX", ... }                 (future)
 */
import type { PrismaClient } from "../../src/generated/prisma/client"
import { decrypt } from "../../src/lib/crypto"
import { OnPbxAdapter, loadOnPbxAuth, type OnPbxConfig } from "../../src/lib/pbx/onpbx-adapter"

export type PbxAdapter = OnPbxAdapter   // union grows when Sipuni/MegaPBX adapters land

export interface LoadedTenant {
  id: string
  name: string
  pbxProvider: string
  adapter: PbxAdapter
  intelionToken: string | null
  dailyGpuCapUsd: number
}

interface TenantRow {
  id: string
  name: string
  pbxProvider: string | null
  pbxConfig: unknown
  intelionToken: string | null
  dailyGpuCapUsd: number | null
}

export async function loadTenantWithPbx(
  db: PrismaClient,
  tenantNameOrId: string
): Promise<LoadedTenant> {
  // Bypass generated Prisma types — Tenant has new columns (pbxConfig,
  // intelionToken, dailyGpuCapUsd, pbxProvider) that the client was generated
  // before. $queryRawUnsafe returns them straight from PG.
  const rows = await db.$queryRawUnsafe<TenantRow[]>(
    `SELECT id, name, "pbxProvider", "pbxConfig", "intelionToken", "dailyGpuCapUsd"
     FROM "Tenant"
     WHERE name = $1 OR id = $1
     LIMIT 1`,
    tenantNameOrId
  )
  const t = rows[0]
  if (!t) throw new Error(`Tenant not found: ${tenantNameOrId}`)

  if (!t.pbxConfig || typeof t.pbxConfig !== "object") {
    throw new Error(`Tenant ${t.name}: pbxConfig is empty — run scripts/setup-tenant-pbx.ts first`)
  }
  if (!t.pbxProvider) throw new Error(`Tenant ${t.name}: pbxProvider not set`)

  let adapter: PbxAdapter
  if (t.pbxProvider === "ONPBX") {
    const auth = loadOnPbxAuth(t.pbxConfig as OnPbxConfig)
    // Pass db + tenantId so adapter can self-heal: refresh KEY_ID:KEY via
    // permanent authKey when /mongo_history returns API_KEY_CHECK_FAILED.
    adapter = new OnPbxAdapter(auth, db, t.id)
  } else {
    throw new Error(`PBX provider ${t.pbxProvider} not implemented yet (only ONPBX for v1)`)
  }

  const intelionToken = t.intelionToken
    ? (/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i.test(t.intelionToken) ? decrypt(t.intelionToken) : t.intelionToken)
    : process.env.INTELION_API_TOKEN ?? null

  return {
    id: t.id,
    name: t.name,
    pbxProvider: t.pbxProvider,
    adapter,
    intelionToken,
    dailyGpuCapUsd: t.dailyGpuCapUsd ?? 20.0,
  }
}
