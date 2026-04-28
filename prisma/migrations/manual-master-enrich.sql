ALTER TABLE "CallRecord"
  ADD COLUMN IF NOT EXISTS "enrichmentStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "enrichedAt" TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "enrichedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "callOutcome" TEXT,
  ADD COLUMN IF NOT EXISTS "hadRealConversation" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "outcome" TEXT,
  ADD COLUMN IF NOT EXISTS "isCurator" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "isFirstLine" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "possibleDuplicate" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "scriptScorePct" REAL,
  ADD COLUMN IF NOT EXISTS "criticalErrors" JSONB,
  ADD COLUMN IF NOT EXISTS "psychTriggers" JSONB,
  ADD COLUMN IF NOT EXISTS "clientReaction" TEXT,
  ADD COLUMN IF NOT EXISTS "managerStyle" TEXT,
  ADD COLUMN IF NOT EXISTS "clientEmotionPeaks" JSONB,
  ADD COLUMN IF NOT EXISTS "keyClientPhrases" JSONB,
  ADD COLUMN IF NOT EXISTS "cleanedTranscript" TEXT,
  ADD COLUMN IF NOT EXISTS "cleanupNotes" JSONB,
  ADD COLUMN IF NOT EXISTS "managerWeakSpot" TEXT,
  ADD COLUMN IF NOT EXISTS "criticalDialogMoments" JSONB,
  ADD COLUMN IF NOT EXISTS "ropInsight" TEXT,
  ADD COLUMN IF NOT EXISTS "enrichedTags" JSONB,
  ADD COLUMN IF NOT EXISTS "nextStepRecommendation" TEXT,
  ADD COLUMN IF NOT EXISTS "purchaseProbability" INTEGER,
  ADD COLUMN IF NOT EXISTS "gcCallCardUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "gcDeepLinkType" TEXT;

CREATE INDEX IF NOT EXISTS "CallRecord_enrichmentStatus_idx" ON "CallRecord"("enrichmentStatus");
CREATE INDEX IF NOT EXISTS "CallRecord_callOutcome_idx" ON "CallRecord"("callOutcome");
CREATE INDEX IF NOT EXISTS "CallRecord_outcome_idx" ON "CallRecord"("outcome");
