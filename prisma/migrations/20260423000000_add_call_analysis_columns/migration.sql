-- Add call analysis columns to CallRecord:
--   callType            — REAL/VOICEMAIL/IVR/SECRETARY/HUNG_UP/NO_ANSWER (scripts/detect-call-type.ts)
--   transcriptRepaired  — LLM-corrected transcript (scripts/repair-transcripts.ts)
--   scriptScore         — 0-22 sales-script compliance (scripts/score-diva-script-compliance.ts)
--   scriptDetails       — per-stage breakdown JSON

ALTER TABLE "CallRecord" ADD COLUMN "callType" TEXT;
ALTER TABLE "CallRecord" ADD COLUMN "transcriptRepaired" TEXT;
ALTER TABLE "CallRecord" ADD COLUMN "scriptScore" INTEGER;
ALTER TABLE "CallRecord" ADD COLUMN "scriptDetails" JSONB;
