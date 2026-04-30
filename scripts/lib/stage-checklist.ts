/**
 * stage-checklist.ts — formal definition of every stage in cron-master-pipeline
 * + the metrics each emits for success/failure tracking.
 *
 * This is the source-of-truth for daily-health-check.ts to aggregate
 *   "% cycles passed all 11 stages"  +  "which stage fails most often"
 * over a rolling window.
 *
 * Two-tier model:
 *  - cron stages 0..11 fire every 15 min
 *  - master_enrich is OUT of cron (manual /loop /enrich-calls), tracked separately
 */

export interface StageMetric {
  name: string                                // metric key in events.jsonl
  type: "count" | "duration_ms" | "pct" | "bool" | "string" | "list"
  required: boolean                            // must be present in 'done' event for stage to count as success
  description: string
}

export interface StageDef {
  id: string                                   // matches StageLogger.start/done first arg
  index: number                                // 0..11 ordering
  name: string
  goal: string
  required: boolean                            // cycle fails if this stage fails (vs optional like stage-10 alert)
  metrics: StageMetric[]
}

export const CRON_STAGES: StageDef[] = [
  {
    id: "preflight",
    index: 0,
    name: "Preflight",
    goal: "kill switch + lockfile + disk cleanup + cookie health",
    required: true,
    metrics: [
      { name: "lockAcquired",       type: "bool",     required: true,  description: "Lockfile pidfile written" },
      { name: "diskFreePctBefore",  type: "pct",      required: true,  description: "/tmp free space before cleanup" },
      { name: "diskFreePctAfter",   type: "pct",      required: true,  description: "/tmp free space after cleanup" },
      { name: "cleanupDeleted",     type: "count",    required: true,  description: "Files removed by cleanup" },
      { name: "gcCookieAlive",      type: "bool",     required: false, description: "GC cookie probe ok" },
      { name: "gcCookieAgeHrs",     type: "duration_ms", required: false, description: "Hours since gcCookieAt" },
    ],
  },
  {
    id: "stage-1-pbx-delta",
    index: 1,
    name: "PBX delta fetch",
    goal: "fetch new UUIDs from onPBX since LastSync, UPSERT CallRecord",
    required: true,
    metrics: [
      { name: "lastSyncTimestamp",  type: "string",   required: true,  description: "Watermark window start" },
      { name: "fetched",            type: "count",    required: true,  description: "PBX rows returned" },
      { name: "inserted",           type: "count",    required: true,  description: "New CallRecord rows" },
      { name: "updated",            type: "count",    required: true,  description: "Existing rows refreshed" },
      { name: "unmatchedExt",       type: "list",     required: false, description: "Manager extensions with no Manager row" },
      { name: "pbxApiAvgMs",        type: "duration_ms", required: false, description: "Avg onPBX response time" },
      { name: "pbxRateLimitHits",   type: "count",    required: false, description: "429/503 count" },
    ],
  },
  {
    id: "stage-2-download",
    index: 2,
    name: "Smart-download MP3",
    goal: "fetch /root/diva-audio/{uuid}.mp3 with 1-IP rate limit + atomic write",
    required: true,
    metrics: [
      { name: "downloadedCount",    type: "count",    required: true,  description: "New MP3 files written" },
      { name: "skippedExisting",    type: "count",    required: true,  description: "Already on disk" },
      { name: "failedCount",        type: "count",    required: true,  description: "Permanent failures (5 retries exhausted)" },
      { name: "retryCount",         type: "count",    required: false, description: "Total retries on 503/429" },
      { name: "avgSleepMs",         type: "duration_ms", required: false, description: "Should be ≥3000ms (rate limit)" },
    ],
  },
  {
    id: "stage-3-bin-pack",
    index: 3,
    name: "Bin-packing FFD",
    goal: "split files into ≤30-min bins for GPU load balance",
    required: true,
    metrics: [
      { name: "binsCount",          type: "count",    required: true,  description: "Number of bins produced" },
      { name: "avgBinMinutes",      type: "duration_ms", required: false, description: "Avg bin total duration" },
      { name: "maxBinMinutes",      type: "duration_ms", required: false, description: "Largest bin (must ≤30)" },
      { name: "capMinutes",         type: "count",    required: true,  description: "Cap threshold (30)" },
    ],
  },
  {
    id: "stage-4-gpu-start",
    index: 4,
    name: "GPU auto-start",
    goal: "start Intelion pod under daily cost cap, arm watchdog + 2h kill timer",
    required: false,                                                   // skipped when no work / cap hit
    metrics: [
      { name: "todaySpentUsd",      type: "duration_ms", required: true,  description: "Spend so far today" },
      { name: "capUsd",             type: "duration_ms", required: true,  description: "Tenant.dailyGpuCapUsd" },
      { name: "podId",              type: "string",   required: false, description: "Intelion pod ID started" },
      { name: "watchdogStarted",    type: "bool",     required: false, description: "25-min keepalive armed" },
      { name: "maxRuntimeArmedSec", type: "duration_ms", required: false, description: "2h safety kill timer" },
    ],
  },
  {
    id: "stage-5-whisper",
    index: 5,
    name: "Whisper v2.13 transcribe",
    goal: "per-channel transcribe + channel-first merge with hotwords + resume tracking",
    required: false,                                                   // skipped if Stage 4 did not start
    metrics: [
      { name: "paramsConfirmed",    type: "bool",     required: true,  description: "PROB=0.20, GAP=3.0, VAD=off, word_timestamps=true" },
      { name: "hotwordsCount",      type: "count",    required: true,  description: "Names loaded for hotwords param" },
      { name: "inFlightMarked",     type: "count",    required: true,  description: "Rows transitioned to in_flight" },
      { name: "transcribedOk",      type: "count",    required: true,  description: "Successful transcripts" },
      { name: "transcribedFailed",  type: "count",    required: true,  description: "Whisper exceptions" },
      { name: "mp3SuffixCheck",     type: "count",    required: true,  description: "Files with .mp3.mp3 (must be 0)" },
      { name: "sshExitCodes",       type: "list",     required: false, description: "Non-255 codes flagged" },
    ],
  },
  {
    id: "stage-6-gpu-stop",
    index: 6,
    name: "GPU auto-stop",
    goal: "stop pod when idle/done; record actualCost",
    required: false,
    metrics: [
      { name: "stopReason",         type: "string",   required: true,  description: "idle_timeout | job_complete | cost_cap | watchdog_kill | error" },
      { name: "totalRuntimeMin",    type: "duration_ms", required: true,  description: "Pod wall-clock minutes" },
      { name: "actualCostUsd",      type: "duration_ms", required: true,  description: "ratePerHour * runtime" },
    ],
  },
  {
    id: "stage-7-deepseek",
    index: 7,
    name: "DeepSeek downstream",
    goal: "detect-call-type + repair (хвост-strip!) + script-score + analyze-bundle",
    required: true,
    metrics: [
      { name: "detectCallTypeCount",       type: "count",    required: true,  description: "Rows classified" },
      { name: "detectCallTypeDurationMs",  type: "duration_ms", required: false, description: "Sub-step wall-clock" },
      { name: "repairCount",               type: "count",    required: true,  description: "transcriptRepaired written" },
      { name: "repairDurationMs",          type: "duration_ms", required: false, description: "" },
      { name: "hallucinationsStripped",    type: "count",    required: true,  description: "Whisper «хвост творцов» removed in repair" },
      { name: "scoreCount",                type: "count",    required: true,  description: "scriptScore written" },
      { name: "scoreDurationMs",           type: "duration_ms", required: false, description: "" },
      { name: "insightsCount",             type: "count",    required: true,  description: "summary/sentiment/objections written" },
      { name: "insightsDurationMs",        type: "duration_ms", required: false, description: "" },
      { name: "failedStepsIsolated",       type: "count",    required: true,  description: "Sub-step exceptions caught (per-row try/catch)" },
    ],
  },
  {
    id: "stage-7.5-phone-resolve",
    index: 8,
    name: "Phone resolve + Deal link (GC)",
    goal: "resolve clientPhone → gcContactId → JOIN Deal",
    required: false,                                                   // skipped for non-GC tenants
    metrics: [
      { name: "resolvedGcContactId", type: "count",   required: true,  description: "Phones with new gcContactId" },
      { name: "nullResolved",        type: "count",   required: true,  description: "Phones with no GC match" },
      { name: "dealsLinked",         type: "count",   required: true,  description: "CallRecord.dealId populated via JOIN" },
      { name: "dataUserIdParsed",    type: "bool",    required: true,  description: "Parser used data-user-id (NOT data-key)" },
      { name: "cookieExpiredAlerts", type: "count",   required: false, description: "302 → /login redirects" },
      { name: "gcRateLimitHits",     type: "count",   required: false, description: "429/throttle hits" },
    ],
  },
  {
    id: "stage-7.5b-pbx-gc-link",
    index: 9,                                                          // logical slot 7.5b but runs after 7.5 and before 8
    name: "PBX↔GC link via pbxUuid (audioUrl, talkDuration, gcCallId)",
    goal: "fill audioUrl/talkDuration/gcCallId by walking GC contacts grid",
    required: false,                                                   // skipped for non-GC tenants
    metrics: [
      { name: "matched",             type: "count",   required: true,  description: "Rows matched by pbxUuid" },
      { name: "unmatched",           type: "count",   required: true,  description: "GC card had no PBX-side row" },
      { name: "audioUrlFilled",      type: "count",   required: true,  description: "audioUrl populated" },
      { name: "talkDurationFilled",  type: "count",   required: true,  description: "talkDuration populated" },
      { name: "gcCallIdFilled",      type: "count",   required: true,  description: "gcCallId populated" },
      { name: "managerCrossOk",      type: "count",   required: false, description: "Manager.gcUserId == parsed.managerGcUserId" },
      { name: "managerCrossMismatch",type: "count",   required: false, description: "Attribution mismatch (PBX vs GC)" },
      { name: "unmatchedSampleUuids",type: "list",    required: false, description: "Up to 5 unmatched UUIDs for debugging" },
    ],
  },
  {
    id: "stage-8-upsert",
    index: 10,                                                         // upsert is folded into Stage 1 in current orchestrator
    name: "Upsert CallRecord (canon #8)",
    goal: "all required fields written in single transaction; onPBX URL audioUrl validated",
    required: true,
    metrics: [
      { name: "upsertedCount",                type: "count", required: true,  description: "Rows upserted" },
      { name: "audioUrlFromGc",               type: "count", required: true,  description: "audioUrl LIKE %fileservice% (valid GC URL)" },
      { name: "phoneResolvedBeforeUpsert",    type: "bool",  required: true,  description: "Stage 7.5 ran before this stage" },
      { name: "mandatoryFieldsNonNullCount",  type: "count", required: true,  description: "Rows where 16 canon-#8 fields are all non-null" },
    ],
  },
  {
    id: "stage-9-reconcile",
    index: 11,
    name: "Reconciliation 3-way (canon #38)",
    goal: "PBX vs DB vs CRM diff → ReconciliationCheck row",
    required: true,
    metrics: [
      { name: "pbxCount",            type: "count",   required: true,  description: "Calls onPBX reports for window" },
      { name: "dbCount",             type: "count",   required: true,  description: "Local CallRecord count" },
      { name: "crmCount",            type: "count",   required: false, description: "GC contacts count (null if cookie expired)" },
      { name: "missingInDb",         type: "list",    required: true,  description: "PBX UUIDs absent in DB (top 5)" },
      { name: "missingInCrm",        type: "list",    required: false, description: "PBX UUIDs absent in GC (top 5)" },
      { name: "duplicates",          type: "list",    required: true,  description: "Rows with count > 1 (top 5)" },
      { name: "discrepancyPct",      type: "pct",     required: true,  description: "|PBX-DB|/PBX" },
    ],
  },
  {
    id: "stage-10-alert",
    index: 12,
    name: "Telegram alert (if discrepancy > 0.05)",
    goal: "notify on quality regression",
    required: false,                                                   // optional: not always fires
    metrics: [
      { name: "alertSent",           type: "bool",    required: true,  description: "True if discrepancy > threshold" },
      { name: "alertText",           type: "string",  required: false, description: "Message body sent" },
      { name: "threshold",           type: "pct",     required: true,  description: "ALERT_THRESHOLD (default 0.05)" },
    ],
  },
  {
    id: "stage-11-last-sync",
    index: 13,
    name: "UPDATE LastSync (only after stages 9+10 OK)",
    goal: "advance watermark so next cycle continues from here",
    required: true,
    metrics: [
      { name: "newTimestamp",        type: "string",  required: true,  description: "windowEnd ISO" },
      { name: "txCommitted",         type: "bool",    required: true,  description: "Conditional on prior stages success" },
    ],
  },
]

export const POST_CRON_METRICS: StageMetric[] = [
  { name: "totalDurationMs",    type: "duration_ms", required: true, description: "Wall-clock for the whole cycle" },
  { name: "lockReleased",       type: "bool",        required: true, description: "Lockfile cleanly removed" },
  { name: "exitCode",           type: "count",       required: true, description: "0 = success, 1 = stage_failure" },
  { name: "nextScheduledAt",    type: "string",      required: false, description: "Next */15 boundary computed" },
]

/** Master Enrich (Opus via /loop) — separate from cron. Tracked for backfill quality. */
export interface MasterEnrichSession {
  opusSessionId: string
  startedAt: string
  finishedAt?: string
  callsProcessed: number
  avgCompressionRatio: number             // ≥0.85 expected
  phraseComplianceUsedAvg: number         // out of 12 техник
  block7CommitmentsAvg: number
  failedAssertions: number                // self-check failures
}

export const MASTER_ENRICH_METRICS: StageMetric[] = [
  { name: "opusSessionId",            type: "string",   required: true,  description: "Unique Opus session uuid" },
  { name: "callsProcessed",           type: "count",    required: true,  description: "Cards enriched in session" },
  { name: "avgCompressionRatio",      type: "pct",      required: true,  description: "cleanedTranscript / raw — must ≥0.85" },
  { name: "phraseComplianceUsedAvg",  type: "count",    required: true,  description: "Avg used:true count out of 12 техник diva" },
  { name: "block7CommitmentsAvg",     type: "count",    required: false, description: "Avg extractedCommitments per card" },
  { name: "failedAssertions",         type: "count",    required: true,  description: "Self-check failures (skill v9.4 atomicity)" },
]

/** Used by daily-health-check.ts to compute success rate. */
export function isStageSuccess(stage: StageDef, doneEvent: { status: string; meta?: Record<string, unknown> }): boolean {
  if (doneEvent.status === "skip" && !stage.required) return true
  if (doneEvent.status !== "done") return false
  for (const m of stage.metrics.filter((mm) => mm.required)) {
    if (!doneEvent.meta || !(m.name in doneEvent.meta)) return false
  }
  return true
}
