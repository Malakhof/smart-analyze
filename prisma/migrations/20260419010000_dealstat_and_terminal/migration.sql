-- Wave 1 final integration: dealstat snapshot + funnel-stage terminal kind

-- 1) FunnelStage: add `terminalKind` for WON/LOST markers (GC system field maps here)
ALTER TABLE "FunnelStage" ADD COLUMN "terminalKind" TEXT;

-- 2) DealStatSnapshot: store pre-aggregated CRM stats (e.g. GC dealstat/chartdata)
CREATE TABLE "DealStatSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "scopeJson" JSONB,
    "ordersCreatedCount" INTEGER,
    "ordersCreatedAmount" DOUBLE PRECISION,
    "ordersPaidCount" INTEGER,
    "ordersPaidAmount" DOUBLE PRECISION,
    "buyersCount" INTEGER,
    "prepaymentsCount" INTEGER,
    "prepaymentsAmount" DOUBLE PRECISION,
    "taxAmount" DOUBLE PRECISION,
    "commissionAmount" DOUBLE PRECISION,
    "earnedAmount" DOUBLE PRECISION,
    "seriesJson" JSONB,
    "rawJson" JSONB,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealStatSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DealStatSnapshot_tenantId_source_capturedAt_idx"
  ON "DealStatSnapshot"("tenantId", "source", "capturedAt");

ALTER TABLE "DealStatSnapshot"
  ADD CONSTRAINT "DealStatSnapshot_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
