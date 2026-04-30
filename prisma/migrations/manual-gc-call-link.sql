-- Manual migration: PBX↔GC call linking
-- Adds gcCallId (key for GC call card URL), talkDuration (only conversation seconds),
-- gcOutcomeLabel/gcEndCause (GC's own classification), and Manager.gcUserId (cross-check).
--
-- Discovered 2026-04-29 during diva backfill: GC stores pbxUuid in plain text on
-- call detail page ("Уникальный идентификатор звонка: <uuid>"). This is the only
-- reliable PBX↔GC matching key (phone+date is ambiguous, duration differs by 2x
-- between PBX recording and GC talk-only counter).
--
-- gcCallId is the GC entity ID for the call card (e.g. 208612058), used to build
-- URL https://{subdomain}/user/control/contact/update/id/{gcCallId} which is the
-- correct deep-link to that specific call's recording + metadata.
--
-- talkDuration ⭐ — newly observed field in GC ("Продолжительность разговора:")
-- which gives ground truth for "real conversation" metric (anketa diva п.9.4).
-- Currently we approximate via transcript content; talkDuration > 0 is exact.

ALTER TABLE "CallRecord"
  ADD COLUMN IF NOT EXISTS "gcCallId" TEXT,
  ADD COLUMN IF NOT EXISTS "talkDuration" INTEGER,
  ADD COLUMN IF NOT EXISTS "gcOutcomeLabel" TEXT,
  ADD COLUMN IF NOT EXISTS "gcEndCause" TEXT;

CREATE INDEX IF NOT EXISTS "CallRecord_gcCallId_idx" ON "CallRecord" ("gcCallId");
CREATE INDEX IF NOT EXISTS "CallRecord_talkDuration_idx" ON "CallRecord" ("talkDuration");

ALTER TABLE "Manager"
  ADD COLUMN IF NOT EXISTS "gcUserId" TEXT;

CREATE INDEX IF NOT EXISTS "Manager_gcUserId_idx" ON "Manager" ("gcUserId");
