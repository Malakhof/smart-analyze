ALTER TABLE "CallRecord"
  ADD COLUMN IF NOT EXISTS "extractedCommitments" JSONB,
  ADD COLUMN IF NOT EXISTS "commitmentsCount" INTEGER,
  ADD COLUMN IF NOT EXISTS "commitmentsTracked" BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS "CallRecord_commitmentsTracked_idx" ON "CallRecord"("commitmentsTracked") WHERE "commitmentsTracked" = FALSE;
