-- Manual migration: cron auto-update pipeline state tables
--
-- Adds operational tables that the master cron-pipeline relies on:
--
--   LastSync             — per-tenant per-provider sync watermark
--   ReconciliationCheck  — 3-way diff (PBX vs DB vs CRM) per cycle (canon #38)
--   GpuRun               — Intelion pod billing/audit (canon-gpu-cost-cap)
--   HealthCheckRun       — daily health-check log (canon-daily-health-check)
--
-- Plus per-tenant PBX credential storage and CallRecord operational fields
-- (transcriptionStatus / retryCount) needed for whisper-resume canon.
--
-- ON_PBX KEY_ID/KEY for diva (and Sipuni/MegaPBX for the other tenants) move
-- from hardcoded scripts (/root/onpbx-smart-download.py) into Tenant.pbxConfig
-- as encrypted JSON. Format:
--   { "provider": "ONPBX",  "domain": "pbx1720.onpbx.ru",
--     "keyId": "<encrypted>", "key": "<encrypted>" }
--   { "provider": "SIPUNI", "user": "...", "secret": "<encrypted>" }
-- Encryption: src/lib/crypto.ts (aes-256-gcm).

-- ============================================================
-- Tenant: PBX provider config + GPU cost cap + Intelion token
-- ============================================================
ALTER TABLE "Tenant"
  ADD COLUMN IF NOT EXISTS "pbxProvider"     TEXT,         -- 'ONPBX' | 'SIPUNI' | 'MEGAPBX'
  ADD COLUMN IF NOT EXISTS "pbxConfig"       JSONB,        -- encrypted credentials per provider
  ADD COLUMN IF NOT EXISTS "dailyGpuCapUsd"  DOUBLE PRECISION DEFAULT 20.0,
  ADD COLUMN IF NOT EXISTS "intelionToken"   TEXT;         -- encrypted, may be shared across tenants

-- ============================================================
-- LastSync — cron watermark
-- ============================================================
CREATE TABLE IF NOT EXISTS "LastSync" (
  "id"            TEXT        PRIMARY KEY,
  "tenantId"      TEXT        NOT NULL,
  "provider"      TEXT        NOT NULL,            -- 'PBX_ONPBX' | 'PBX_SIPUNI' | 'PBX_MEGAPBX' | 'CRM_GETCOURSE' | 'CRM_AMOCRM'
  "lastTimestamp" TIMESTAMPTZ NOT NULL,
  "lastUuid"      TEXT,                             -- last processed call UUID (tie-break for same-second batches)
  "lastError"     TEXT,
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "LastSync_tenant_provider_idx"
  ON "LastSync" ("tenantId", "provider");

-- ============================================================
-- ReconciliationCheck — 3-way diff log (canon #38)
-- ============================================================
CREATE TABLE IF NOT EXISTS "ReconciliationCheck" (
  "id"             TEXT        PRIMARY KEY,
  "tenantId"       TEXT        NOT NULL,
  "checkedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "windowStart"    TIMESTAMPTZ NOT NULL,
  "windowEnd"      TIMESTAMPTZ NOT NULL,
  "pbxCount"       INTEGER     NOT NULL,
  "dbCount"        INTEGER     NOT NULL,
  "crmCount"       INTEGER,                          -- nullable when CRM source unavailable (cookie expired)
  "missingInDb"    JSONB,                            -- [uuid, ...]
  "missingInCrm"   JSONB,
  "duplicates"     JSONB,
  "discrepancyPct" DOUBLE PRECISION NOT NULL,        -- formula: |PBX-DB|/PBX
  "alertSent"      BOOLEAN     NOT NULL DEFAULT FALSE,
  "notes"          TEXT
);
CREATE INDEX IF NOT EXISTS "ReconciliationCheck_tenant_checkedAt_idx"
  ON "ReconciliationCheck" ("tenantId", "checkedAt" DESC);

-- ============================================================
-- GpuRun — Intelion pod billing trail (canon-gpu-cost-cap)
-- ============================================================
CREATE TABLE IF NOT EXISTS "GpuRun" (
  "id"           TEXT        PRIMARY KEY,
  "tenantId"     TEXT        NOT NULL,
  "podId"        TEXT        NOT NULL,
  "startedAt"    TIMESTAMPTZ NOT NULL,
  "stoppedAt"    TIMESTAMPTZ,
  "ratePerHour"  DOUBLE PRECISION NOT NULL,
  "filesQueued"  INTEGER     NOT NULL DEFAULT 0,
  "filesDone"    INTEGER     NOT NULL DEFAULT 0,
  "actualCost"   DOUBLE PRECISION,                   -- computed when stoppedAt set
  "outcome"      TEXT        NOT NULL DEFAULT 'running',  -- 'running' | 'completed' | 'capped' | 'killed' | 'silent_stop'
  "notes"        TEXT
);
CREATE INDEX IF NOT EXISTS "GpuRun_tenant_startedAt_idx"
  ON "GpuRun" ("tenantId", "startedAt" DESC);

-- ============================================================
-- HealthCheckRun — daily health log (canon-daily-health-check)
-- ============================================================
CREATE TABLE IF NOT EXISTS "HealthCheckRun" (
  "id"          TEXT        PRIMARY KEY,
  "checkedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "tenantId"    TEXT,                                -- nullable when global check
  "ok"          BOOLEAN     NOT NULL,
  "summary"     TEXT,
  "details"     JSONB                                -- {diskFreePct, lastSyncAge, gpuSpend, cookieAgeHrs, ...}
);
CREATE INDEX IF NOT EXISTS "HealthCheckRun_checkedAt_idx"
  ON "HealthCheckRun" ("checkedAt" DESC);

-- ============================================================
-- CallRecord: transcription state (whisper-resume canon)
-- ============================================================
ALTER TABLE "CallRecord"
  ADD COLUMN IF NOT EXISTS "transcriptionStatus" TEXT,        -- 'pending' | 'in_flight' | 'transcribed' | 'failed' | 'pipeline_gap'
  ADD COLUMN IF NOT EXISTS "transcriptionPodId"  TEXT,        -- which GpuRun.podId picked it up
  ADD COLUMN IF NOT EXISTS "transcriptionAt"     TIMESTAMPTZ, -- last state change
  ADD COLUMN IF NOT EXISTS "retryCount"          INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastSyncError"       TEXT;

CREATE INDEX IF NOT EXISTS "CallRecord_transcriptionStatus_idx"
  ON "CallRecord" ("transcriptionStatus");
CREATE INDEX IF NOT EXISTS "CallRecord_pbxUuid_idx"
  ON "CallRecord" ("pbxUuid");
CREATE INDEX IF NOT EXISTS "CallRecord_tenantId_startStamp_idx"
  ON "CallRecord" ("tenantId", "startStamp" DESC);
