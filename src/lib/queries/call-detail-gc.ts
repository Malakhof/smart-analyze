import { db } from "@/lib/db"

export type CallType =
  | "NORMAL"
  | "SHORT_RESCHEDULE"
  | "VOICEMAIL_IVR"
  | "NO_SPEECH"
  | "HUNG_UP"
  | "TECHNICAL_ISSUE"
  | "PIPELINE_GAP"

export interface CallDetail {
  id: string
  pbxUuid: string | null
  managerName: string | null
  clientName: string | null
  clientPhone: string | null
  createdAt: Date
  startStamp: Date | null
  duration: number | null
  talkDuration: number | null
  userTalkTime: number | null
  callType: string | null
  callOutcome: string | null
  hadRealConversation: boolean | null
  outcome: string | null
  isCurator: boolean | null
  isFirstLine: boolean | null
  possibleDuplicate: boolean | null
  purchaseProbability: number | null
  scriptScore: number | null
  scriptScorePct: number | null
  scriptDetails: unknown
  criticalErrors: unknown
  psychTriggers: unknown
  clientReaction: string | null
  managerStyle: string | null
  clientEmotionPeaks: unknown
  keyClientPhrases: unknown
  criticalDialogMoments: unknown
  cleanedTranscript: string | null
  cleanupNotes: unknown
  transcriptRepaired: string | null
  transcript: string | null
  callSummary: string | null
  managerWeakSpot: string | null
  ropInsight: string | null
  nextStepRecommendation: string | null
  enrichedTags: unknown
  extractedCommitments: unknown
  commitmentsCount: number | null
  commitmentsTracked: boolean | null
  phraseCompliance: unknown
  audioUrl: string | null
  gcCallId: string | null
  gcContactId: string | null
  enrichmentStatus: string | null
  enrichmentLockedAt: Date | null
  // Joined
  dealId: string | null
  dealCrmId: string | null
  stageName: string | null
  currentStageCrmId: string | null
  subdomain: string | null
  // Computed talk metrics (Task 37)
  talkRatio: number | null
  longestMonologSec: number | null
  interactivityScore: number | null
}

/**
 * Compute talk metrics from a speaker-labeled transcript.
 *
 * Production format (diva): `[МЕНЕДЖЕР HH:MM] текст` / `[КЛИЕНТ HH:MM] текст`.
 * Also accepts spec aliases: `[МОП]`, `[Manager]`, `[Client]`, and `Manager:`,
 * `Client:` prefixes. Lines tagged `[ОПЕРАТОР …]` (IVR voicemail) are excluded.
 *
 * Some transcripts come with literal `\n` escapes instead of real newlines —
 * we split on both real and escaped newlines.
 *
 * Returns:
 *   talkRatio          — 0..1, manager chars / (manager + client chars)
 *   longestMonologSec  — longest contiguous run of same speaker, ~15 chars/sec
 *   interactivityScore — exchanges (lines) per minute of speech
 */
export function computeTalkMetrics(transcript: string | null): {
  talkRatio: number | null
  longestMonologSec: number | null
  interactivityScore: number | null
} {
  if (!transcript) {
    return { talkRatio: null, longestMonologSec: null, interactivityScore: null }
  }
  const normalized = transcript.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n")
  const lines = normalized.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  let mopChars = 0
  let clientChars = 0
  const monologRuns: number[] = []
  let currentRun = 0
  let lastSpeaker: "mop" | "client" | null = null
  let speakerLineCount = 0
  for (const line of lines) {
    const isMop =
      /^\[(?:МОП|МЕНЕДЖЕР|MANAGER)(?:\s[^\]]*)?\]/i.test(line) ||
      /^(?:МОП|МЕНЕДЖЕР|MANAGER):/i.test(line)
    const isClient =
      /^\[(?:КЛИЕНТ|CLIENT)(?:\s[^\]]*)?\]/i.test(line) ||
      /^(?:КЛИЕНТ|CLIENT):/i.test(line)
    const speaker: "mop" | "client" | null = isMop ? "mop" : isClient ? "client" : null
    if (speaker === null) {
      // Skip IVR/operator/unlabeled lines — they don't count toward either side.
      continue
    }
    speakerLineCount++
    const cleaned = line
      .replace(/^\[(?:МОП|МЕНЕДЖЕР|MANAGER|КЛИЕНТ|CLIENT)(?:\s[^\]]*)?\]:?\s*/i, "")
      .replace(/^(?:МОП|МЕНЕДЖЕР|MANAGER|КЛИЕНТ|CLIENT):\s*/i, "")
      .trim()
    if (speaker === "mop") mopChars += cleaned.length
    else clientChars += cleaned.length
    if (speaker === lastSpeaker) {
      currentRun += cleaned.length
    } else {
      if (lastSpeaker !== null) monologRuns.push(currentRun)
      currentRun = cleaned.length
      lastSpeaker = speaker
    }
  }
  if (lastSpeaker !== null) monologRuns.push(currentRun)

  const totalChars = mopChars + clientChars
  if (totalChars === 0 || speakerLineCount === 0) {
    return { talkRatio: null, longestMonologSec: null, interactivityScore: null }
  }
  const talkRatio = mopChars / totalChars
  // Approx speaking pace: 15 chars/sec.
  const longestMonologSec =
    monologRuns.length > 0 ? Math.round(Math.max(...monologRuns) / 15) : null
  const totalMinutes = totalChars / 15 / 60
  const interactivityScore =
    totalMinutes > 0 && speakerLineCount > 1 ? speakerLineCount / totalMinutes : null
  return { talkRatio, longestMonologSec, interactivityScore }
}

export async function getCallDetailByPbxUuid(
  tenantId: string,
  pbxUuid: string
): Promise<CallDetail | null> {
  const call = await db.callRecord.findFirst({
    where: { tenantId, pbxUuid },
    include: {
      manager: { select: { name: true } },
      deal: {
        select: {
          id: true,
          crmId: true,
          currentStageCrmId: true,
          funnel: { include: { stages: true } },
        },
      },
    },
  })
  if (!call) return null

  const crmConfig = await db.crmConfig.findFirst({
    where: { tenantId, isActive: true },
    select: { subdomain: true },
  })

  let stageName: string | null = null
  if (call.deal?.currentStageCrmId && call.deal.funnel?.stages) {
    const matched = call.deal.funnel.stages.find(
      (s) => s.crmId === call.deal!.currentStageCrmId
    )
    stageName = matched?.name ?? null
  }

  return {
    id: call.id,
    pbxUuid: call.pbxUuid,
    managerName: call.manager?.name ?? null,
    clientName: call.clientName,
    clientPhone: call.clientPhone,
    createdAt: call.createdAt,
    startStamp: call.startStamp,
    duration: call.duration,
    talkDuration: call.talkDuration,
    userTalkTime: call.userTalkTime,
    callType: call.callType,
    callOutcome: call.callOutcome,
    hadRealConversation: call.hadRealConversation,
    outcome: call.outcome,
    isCurator: call.isCurator,
    isFirstLine: call.isFirstLine,
    possibleDuplicate: call.possibleDuplicate,
    purchaseProbability: call.purchaseProbability,
    scriptScore: call.scriptScore,
    scriptScorePct: call.scriptScorePct,
    scriptDetails: call.scriptDetails,
    criticalErrors: call.criticalErrors,
    psychTriggers: call.psychTriggers,
    clientReaction: call.clientReaction,
    managerStyle: call.managerStyle,
    clientEmotionPeaks: call.clientEmotionPeaks,
    keyClientPhrases: call.keyClientPhrases,
    criticalDialogMoments: call.criticalDialogMoments,
    cleanedTranscript: call.cleanedTranscript,
    cleanupNotes: call.cleanupNotes,
    transcriptRepaired: call.transcriptRepaired,
    transcript: call.transcript,
    callSummary: call.callSummary,
    managerWeakSpot: call.managerWeakSpot,
    ropInsight: call.ropInsight,
    nextStepRecommendation: call.nextStepRecommendation,
    enrichedTags: call.enrichedTags,
    extractedCommitments: call.extractedCommitments,
    commitmentsCount: call.commitmentsCount,
    commitmentsTracked: call.commitmentsTracked,
    phraseCompliance: call.phraseCompliance,
    audioUrl: call.audioUrl,
    gcCallId: call.gcCallId,
    gcContactId: call.gcContactId,
    enrichmentStatus: call.enrichmentStatus,
    enrichmentLockedAt: call.enrichmentLockedAt,
    dealId: call.dealId,
    dealCrmId: call.deal?.crmId ?? null,
    stageName,
    currentStageCrmId: call.deal?.currentStageCrmId ?? null,
    subdomain: crmConfig?.subdomain ?? null,
    ...computeTalkMetrics(
      call.cleanedTranscript ?? call.transcriptRepaired ?? call.transcript
    ),
  }
}

/**
 * Classify a CallRecord into one of 7 UI render types (A-G).
 * See data-layer-handoff §Block 2 + cron-resume §Тип звонка G.
 */
export function classifyCallType(c: CallDetail): CallType {
  // G — pipeline_gap: no audio, no transcript (infrastructure issue)
  if (!c.transcript && !c.audioUrl) return "PIPELINE_GAP"

  const outcome = c.callOutcome ?? ""

  if (outcome === "technical_issue") return "TECHNICAL_ISSUE"

  // Whisper-no-speech: very short transcript
  const tr = c.cleanedTranscript ?? c.transcriptRepaired ?? c.transcript ?? ""
  if (outcome === "no_speech_or_silence" || tr.length <= 100) return "NO_SPEECH"

  if (outcome === "voicemail" || outcome === "ivr") return "VOICEMAIL_IVR"

  if (outcome === "hung_up" || outcome === "no_answer") return "HUNG_UP"

  // SHORT_RESCHEDULE: real_conversation but < 60s
  if (outcome === "real_conversation" && (c.duration ?? 0) < 60) {
    return "SHORT_RESCHEDULE"
  }

  return "NORMAL"
}
