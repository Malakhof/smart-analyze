import type { ReactNode } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { CallDetail, CallType } from "@/lib/queries/call-detail-gc"

const MOSCOW_FMT = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

function fmtMsk(d: Date | null): string {
  if (!d) return "—"
  return MOSCOW_FMT.format(d)
}

function fmtSeconds(secs: number | null | undefined): string {
  if (secs === null || secs === undefined) return "—"
  const s = Math.round(secs)
  const m = Math.floor(s / 60)
  const ss = s % 60
  return `${m}:${ss.toString().padStart(2, "0")}`
}

interface PsychPositive {
  time?: string
  приём?: string
  technique?: string
  эффект?: string
  effect?: string
  quote_manager?: string
}
interface PsychMissed {
  time?: string
  trigger?: string
  quote_client?: string
  что_должна_была?: string
  why_missed?: string
  what_to_do?: string
}

function asObject<T extends Record<string, unknown>>(v: unknown): T | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as T) : null
}

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

/**
 * Some enriched fields store literal `\n` (backslash+n) instead of real
 * newline characters — Master Enrich writes JSON-encoded strings via Prisma.
 * Convert literal escapes back to real whitespace so <pre> + whitespace-pre-wrap
 * lay them out as paragraphs.
 */
function unescapeNewlines(s: string): string {
  return s.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\t/g, "\t")
}

function normalizeCriticalErrors(
  raw: unknown
): Array<{ error: string; evidence?: string; severity?: string }> {
  if (!Array.isArray(raw)) return []
  const out: Array<{ error: string; evidence?: string; severity?: string }> = []
  for (const item of raw) {
    if (typeof item === "string") out.push({ error: item })
    else if (item && typeof item === "object" && "error" in item) {
      const o = item as Record<string, unknown>
      if (typeof o.error === "string") {
        out.push({
          error: o.error,
          evidence: typeof o.evidence === "string" ? o.evidence : undefined,
          severity: typeof o.severity === "string" ? o.severity : undefined,
        })
      }
    }
  }
  return out
}

const SCRIPT_STAGE_LABELS: Record<string, string> = {
  "1_приветствие": "1. Приветствие",
  "2_причина": "2. Причина звонка",
  "2_причина_звонка": "2. Причина звонка",
  "3_программирование": "3. Программирование",
  "4_квалификация": "4. Квалификация",
  "5_крюк": "5. Вбивание крюка / выявление",
  "5_выявление_потребностей": "5. Выявление потребностей",
  "6_презентация": "6. Презентация",
  "7_возражения": "7. Работа с возражениями",
  "8_закрытие": "8. Закрытие сделки",
  "9_следующий_шаг": "9. Следующий шаг",
  "10_ответы": "10. Ответы на вопросы",
  "10_ответы_на_вопросы": "10. Ответы на вопросы",
  "11_прощание": "11. Прощание",
}

const CRITICAL_ERROR_LABELS: Record<string, string> = {
  interrupted_client: "1. Перебивание клиента",
  no_needs_discovery: "2. Отсутствие выявления потребностей",
  no_pain_discovery: "2. Отсутствие выявления боли",
  no_objection_handling: "3. Отсутствие отработки возражений",
  no_close_attempt: "4. Отсутствие попытки сделки",
  no_next_step: "5. Не назначен следующий шаг",
  monolog_not_pain_tied: "6. Монолог не привязан к боли",
  no_compliments: "7. Без комплиментов",
}

const PHRASE_TECHNIQUES = [
  "программирование_звонка",
  "искренние_комплименты",
  "эмоциональный_подхват",
  "юмор_забота",
  "крюк_к_боли",
  "презентация_под_боль",
  "попытка_сделки_без_паузы",
  "выбор_без_выбора",
  "бонусы_с_дедлайном",
  "повторная_попытка_после_возражения",
  "маленькая_просьба",
  "следующий_шаг_с_временем",
] as const

interface Props {
  call: CallDetail
  type: CallType
}

export function CallCard({ call, type }: Props) {
  return (
    <div className="space-y-6">
      <Header call={call} type={type} />
      <DevWarnBlock call={call} type={type} />
      <CategoryHero call={call} type={type} />
      <Player call={call} />
      <TypeSpecificContent call={call} type={type} />
    </div>
  )
}

function DevWarnBlock({ call, type }: { call: CallDetail; type: CallType }) {
  if (process.env.NODE_ENV !== "development") return null
  const expected = SHOW_FOR_CATEGORY[type]
  const surprises: string[] = []
  if (!expected.includes("Psych") && (call.psychTriggers || call.clientReaction || call.managerStyle)) surprises.push("psychTriggers/reaction/style")
  if (!expected.includes("Script") && (call.scriptScorePct !== null || call.scriptDetails)) surprises.push("scriptScore/scriptDetails")
  if (!expected.includes("PhraseCompliance") && call.phraseCompliance) surprises.push("phraseCompliance")
  if (!expected.includes("CriticalErrors") && Array.isArray(call.criticalErrors) && (call.criticalErrors as unknown[]).length > 0) surprises.push("criticalErrors")
  if (!expected.includes("CriticalDialogMoments") && Array.isArray(call.criticalDialogMoments) && (call.criticalDialogMoments as unknown[]).length > 0) surprises.push("criticalDialogMoments")
  if (!expected.includes("RopInsight") && call.ropInsight) surprises.push("ropInsight")
  if (!expected.includes("NextStep") && call.nextStepRecommendation) surprises.push("nextStepRecommendation")
  if (!expected.includes("Commitments") && Array.isArray(call.extractedCommitments) && (call.extractedCommitments as unknown[]).length > 0) surprises.push("extractedCommitments")
  if (!surprises.length) return null
  return (
    <div className="rounded-md border border-status-amber-border bg-status-amber-dim p-2 text-xs text-status-amber">
      ⚠️ DEV: HIDE-категория {type} получила данные: {surprises.join(", ")}
    </div>
  )
}

// ─── Header ─────────────────────────────────────────────────────────────────

function Header({ call, type }: { call: CallDetail; type: CallType }) {
  const subdomain = call.subdomain
  const callLink =
    subdomain && call.gcCallId
      ? `https://${subdomain}/user/control/contact/update/id/${call.gcCallId}`
      : null
  const clientLink =
    subdomain && call.gcContactId
      ? `https://${subdomain}/user/control/user/update/id/${call.gcContactId}`
      : null
  const dealLink =
    subdomain && call.dealCrmId
      ? `https://${subdomain}/sales/control/deal/update/id/${call.dealCrmId}`
      : null

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-text-primary">
          📋 Звонок {call.pbxUuid?.slice(0, 8) ?? "—"}
        </h1>
        <p className="mt-1 text-[13px] text-text-tertiary">
          {call.managerName ?? "—"} → {call.clientName || (call.clientPhone ? `тел. ${call.clientPhone.slice(-4)}` : "клиент")}
          {" · "}
          {fmtMsk(call.startStamp ?? call.createdAt)} МСК
          {" · "}
          <TypeBadge type={type} />
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {call.enrichmentStatus && (
          <span className="inline-block rounded px-2 py-0.5 text-[11px] bg-surface-3 text-text-secondary">
            {call.enrichmentStatus}
          </span>
        )}
        {call.possibleDuplicate && (
          <span className="inline-block rounded px-2 py-0.5 text-[11px] bg-status-amber-dim text-status-amber">
            ⚠️ возможный дубль
          </span>
        )}
      </div>

      <Card>
        <CardContent className="grid grid-cols-1 gap-3 py-2 sm:grid-cols-2 lg:grid-cols-3">
          <MetaRow label="📼 Длительность записи" value={fmtSeconds(call.duration)} />
          <MetaRow
            label="🗣 Длительность разговора"
            value={fmtSeconds(call.talkDuration ?? call.userTalkTime)}
            hint={
              call.talkDuration === null && call.userTalkTime !== null
                ? "(fallback userTalkTime)"
                : undefined
            }
          />
          {call.scriptScorePct !== null && (
            <MetaRow
              label="📊 Script score"
              value={`${Math.round((call.scriptScorePct ?? 0) * 100)}%`}
            />
          )}
          {call.callType && <MetaRow label="🎯 callType" value={call.callType} />}
          {call.callOutcome && (
            <MetaRow label="📞 callOutcome" value={call.callOutcome} />
          )}
          {call.outcome && <MetaRow label="📈 outcome" value={call.outcome} />}
          {call.purchaseProbability !== null && (
            <MetaRow
              label="💰 purchaseProbability"
              value={`${call.purchaseProbability}%`}
            />
          )}
          {call.stageName && (
            <MetaRow label="🪜 Этап сделки" value={call.stageName} />
          )}
          {!call.stageName && call.currentStageCrmId && (
            <MetaRow
              label="🪜 Этап сделки"
              value={`Этап #${call.currentStageCrmId}`}
            />
          )}
          {call.gcCallId && (
            <MetaRow label="🆔 gcCallId" value={call.gcCallId} />
          )}
          {call.gcContactId && (
            <MetaRow label="🆔 gcContactId" value={call.gcContactId} />
          )}
        </CardContent>
      </Card>

      <StatsPanel call={call} />

      <div className="flex flex-wrap gap-2">
        {callLink && (
          <DeepLink href={callLink} icon="🎵" label="Карточка звонка в GC" />
        )}
        {clientLink && (
          <DeepLink href={clientLink} icon="👤" label="Клиент в GC" />
        )}
        {dealLink && <DeepLink href={dealLink} icon="💼" label="Сделка в GC" />}
      </div>
    </div>
  )
}

function StatsPanel({ call }: { call: CallDetail }) {
  if (
    call.talkRatio === null &&
    call.longestMonologSec === null &&
    call.interactivityScore === null
  ) {
    return null
  }
  return (
    <Card>
      <CardContent className="grid grid-cols-3 gap-3 py-2 text-sm">
        <div>
          <div className="text-xs text-text-tertiary">Talk ratio</div>
          <div className="font-medium tabular-nums">
            {call.talkRatio !== null
              ? `${Math.round(call.talkRatio * 100)}%`
              : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs text-text-tertiary">
            Самый длинный монолог
          </div>
          <div className="font-medium tabular-nums">
            {call.longestMonologSec !== null
              ? `${Math.floor(call.longestMonologSec / 60)}:${String(
                  call.longestMonologSec % 60
                ).padStart(2, "0")}`
              : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs text-text-tertiary">Интерактивность</div>
          <div className="font-medium tabular-nums">
            {call.interactivityScore !== null
              ? `${call.interactivityScore.toFixed(1)} обм/мин`
              : "—"}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function MetaRow({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="text-sm">
      <span className="text-text-tertiary">{label}: </span>
      <span className="font-medium tabular-nums">{value}</span>
      {hint && <span className="ml-1 text-[11px] text-text-muted">{hint}</span>}
    </div>
  )
}

function DeepLink({
  href,
  icon,
  label,
}: {
  href: string
  icon: string
  label: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md border border-border-default bg-surface-1 px-3 py-1.5 text-[12px] text-text-secondary transition-colors hover:border-border-hover hover:text-text-primary"
    >
      <span>{icon}</span>
      <span>{label}</span>
      <span className="text-text-tertiary">↗</span>
    </a>
  )
}

function TypeBadge({ type }: { type: CallType }) {
  const styles: Record<CallType, { bg: string; fg: string; label: string }> = {
    NORMAL: { bg: "bg-status-green-dim", fg: "text-status-green", label: "real_conversation" },
    SHORT_RESCHEDULE: { bg: "bg-surface-3", fg: "text-text-secondary", label: "короткий перенос" },
    VOICEMAIL_IVR: { bg: "bg-surface-3", fg: "text-text-secondary", label: "🎙 voicemail/IVR" },
    NO_SPEECH: { bg: "bg-surface-3", fg: "text-text-secondary", label: "🤐 без речи" },
    HUNG_UP: { bg: "bg-status-amber-dim", fg: "text-status-amber", label: "☎️ НДЗ" },
    TECHNICAL_ISSUE: { bg: "bg-status-red-dim", fg: "text-status-red", label: "🚨 тех. проблема" },
    PIPELINE_GAP: { bg: "bg-status-red-dim", fg: "text-status-red", label: "🛠 нет аудио" },
  }
  const s = styles[type]
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-[11px] ${s.bg} ${s.fg}`}>
      {s.label}
    </span>
  )
}

function CategoryHero({ call, type }: { call: CallDetail; type: CallType }) {
  const messages: Record<CallType, string> = {
    NO_SPEECH: "🤐 Whisper не нашёл речь — звонок не оценивается. При сомнении послушать вручную.",
    VOICEMAIL_IVR: "🎙 Автоответчик/IVR — НДЗ. Контролируй частоту повторных попыток.",
    HUNG_UP: "☎️ Клиент сбросил/не ответил. НДЗ. Если повторяется в одно время — оптимизируй расписание.",
    TECHNICAL_ISSUE: "🚨 Тех. сбой — алерт тех. отделу. Не оценка МОПа. >3/неделя — гарнитура.",
    SHORT_RESCHEDULE: call.nextStepRecommendation
      ? "🕐 Короткий перенос. Callback назначен."
      : "🕐 Короткий перенос. Callback не назначен — проверь.",
    NORMAL: call.managerWeakSpot
      ? `Главный инсайт: ${call.managerWeakSpot}`
      : (call.outcome ?? "Полный AI-разбор ниже."),
    PIPELINE_GAP: "🛠 Pipeline gap: транскрипт/аудио ещё не получены. Это инфра, не МОП.",
  }
  return (
    <div className="rounded-md border border-border-default bg-surface-2 p-3 text-sm text-text-secondary">
      {messages[type]}
    </div>
  )
}

// ─── Player ─────────────────────────────────────────────────────────────────

function Player({ call }: { call: CallDetail }) {
  if (!call.audioUrl) {
    return (
      <Card>
        <CardContent className="py-3">
          <p className="text-sm text-text-tertiary">
            🎵 Аудио недоступно — звонок не состоялся как разговор или ещё не
            подтянулся из GC.
          </p>
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardContent className="py-3">
        <audio
          controls
          preload="metadata"
          src={call.audioUrl}
          className="w-full"
        >
          Ваш браузер не поддерживает audio.
        </audio>
        <p className="mt-2 text-[11px] text-text-muted">
          🎵 Прямой URL fileservice.getcourse.ru — играть не качая в нашу инфру.
        </p>
      </CardContent>
    </Card>
  )
}

// ─── Block registry (Task 11: prep for whitelist; not wired yet) ───────────

type BlockId =
  | "Transcript"
  | "Summary"
  | "Psych"
  | "Script"
  | "PhraseCompliance"
  | "CriticalErrors"
  | "CriticalDialogMoments"
  | "RopInsight"
  | "NextStep"
  | "Commitments"
  | "Category"
  | "Tags"
  | "Diagnostic"

const BLOCK_REGISTRY: Record<BlockId, (p: { call: CallDetail }) => ReactNode> = {
  Transcript: TranscriptBlock,
  Summary: SummaryBlock,
  Psych: PsychBlock,
  Script: ScriptBlock,
  PhraseCompliance: PhraseComplianceBlock,
  CriticalErrors: CriticalErrorsBlock,
  CriticalDialogMoments: CriticalDialogMomentsBlock,
  RopInsight: RopInsightBlock,
  NextStep: NextStepBlock,
  Commitments: CommitmentsBlock,
  Category: CategoryBlock,
  Tags: TagsBlock,
  Diagnostic: DiagnosticBlock,
}

const SHOW_FOR_CATEGORY: Record<CallType, BlockId[]> = {
  NORMAL: [
    "Transcript", "Summary", "Psych", "Script", "PhraseCompliance",
    "CriticalErrors", "CriticalDialogMoments", "RopInsight",
    "NextStep", "Commitments", "Category", "Tags",
  ],
  SHORT_RESCHEDULE: [
    "Transcript", "Summary", "Script", "RopInsight",
    "NextStep", "Commitments", "Category", "Tags",
  ],
  VOICEMAIL_IVR: ["Transcript", "RopInsight", "Commitments", "Category", "Tags"],
  HUNG_UP: ["Transcript", "RopInsight", "Category", "Tags"],
  NO_SPEECH: ["Transcript", "Category"],
  TECHNICAL_ISSUE: ["Transcript", "RopInsight", "Category"],
  PIPELINE_GAP: ["Diagnostic", "Category"],
}

// ─── Type-specific render ──────────────────────────────────────────────────

function TypeSpecificContent({ call, type }: { call: CallDetail; type: CallType }) {
  const blocksToShow = SHOW_FOR_CATEGORY[type] ?? []
  return (
    <>
      {blocksToShow.map(blockId => {
        const Block = BLOCK_REGISTRY[blockId]
        return <Block key={blockId} call={call} />
      })}
    </>
  )
}

// ─── Section helpers ───────────────────────────────────────────────────────

function NullBadge({ what }: { what: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border-default bg-surface-2 px-2 py-0.5 text-[11px] text-text-tertiary">
      ⏳ {what} обогащается
    </span>
  )
}

function TranscriptBlock({ call }: { call: CallDetail }) {
  const tr = call.cleanedTranscript ?? call.transcriptRepaired ?? call.transcript
  if (!tr) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>🧼 Очищенный транскрипт</CardTitle>
          <CardDescription>
            <NullBadge what="cleanedTranscript" />
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }
  const cleanupNotes = asObject<Record<string, unknown>>(call.cleanupNotes)
  return (
    <Card>
      <CardHeader>
        <CardTitle>🧼 Очищенный транскрипт</CardTitle>
        <CardDescription>
          {call.cleanedTranscript
            ? "cleanup эхо/Whisper-галлюцинаций, восстановление порядка"
            : call.transcriptRepaired
              ? "(fallback transcriptRepaired — cleanedTranscript ещё не готов)"
              : "(fallback raw transcript)"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <pre className="max-h-[600px] overflow-y-auto whitespace-pre-wrap rounded-md bg-surface-2 p-3 text-[12px] leading-relaxed">
          {unescapeNewlines(tr)}
        </pre>
        {cleanupNotes && (
          <details className="mt-2 text-[11px] text-text-tertiary">
            <summary className="cursor-pointer">cleanup notes</summary>
            <pre className="mt-1 whitespace-pre-wrap">
              {JSON.stringify(cleanupNotes, null, 2)}
            </pre>
          </details>
        )}
      </CardContent>
    </Card>
  )
}

function SummaryBlock({ call }: { call: CallDetail }) {
  if (!call.callSummary) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>📝 Резюме звонка</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">
          {unescapeNewlines(call.callSummary)}
        </p>
        {call.managerWeakSpot && (
          <p className="mt-3 text-[13px] text-status-amber">
            ⚠️ <strong>Слабое место МОПа:</strong> «{call.managerWeakSpot}»
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function PsychBlock({ call }: { call: CallDetail }) {
  const psych = asObject<{ positive?: PsychPositive[]; missed?: PsychMissed[] }>(
    call.psychTriggers
  )
  if (!psych && !call.clientReaction && !call.managerStyle) return null
  const positive = psych?.positive ?? []
  const missed = psych?.missed ?? []
  const peaks = asArray<Record<string, unknown>>(call.clientEmotionPeaks)
  const phrases = asArray<unknown>(call.keyClientPhrases)

  return (
    <Card>
      <CardHeader>
        <CardTitle>🧠 Психология и нейропродажи</CardTitle>
        <CardDescription>
          Стиль МОПа, реакция клиента, удачные приёмы и упущенные триггеры.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {(call.clientReaction || call.managerStyle) && (
          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            {call.managerStyle && (
              <div>
                <span className="text-text-tertiary">👤 Стиль МОПа: </span>
                <span className="font-medium">{call.managerStyle}</span>
              </div>
            )}
            {call.clientReaction && (
              <div>
                <span className="text-text-tertiary">🙋 Реакция клиента: </span>
                <span className="font-medium">{call.clientReaction}</span>
              </div>
            )}
          </div>
        )}

        {positive.length > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-medium">✅ Удачные приёмы</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Время</TableHead>
                  <TableHead>Приём</TableHead>
                  <TableHead>Эффект</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positive.map((p, i) => (
                  <TableRow key={`pos-${i}`}>
                    <TableCell className="tabular-nums text-text-tertiary">
                      {p.time ?? "—"}
                    </TableCell>
                    <TableCell className="font-medium">
                      {p.приём ?? p.technique ?? "—"}
                      {p.quote_manager && (
                        <p className="mt-1 text-[11px] text-text-tertiary">
                          «{p.quote_manager}»
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {p.эффект ?? p.effect ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {missed.length > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-medium">❌ Упущенные триггеры</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Время</TableHead>
                  <TableHead>Триггер / цитата клиента</TableHead>
                  <TableHead>Что должна была сказать</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {missed.map((m, i) => (
                  <TableRow key={`miss-${i}`}>
                    <TableCell className="tabular-nums text-text-tertiary">
                      {m.time ?? "—"}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{m.trigger ?? "—"}</span>
                      {m.quote_client && (
                        <p className="mt-1 text-[11px] text-text-tertiary">
                          «{m.quote_client}»
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-status-amber">
                      {m.что_должна_была ?? m.what_to_do ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {phrases.length > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-medium">🔥 Ключевые цитаты клиента</h4>
            <ul className="space-y-1 text-sm text-text-secondary">
              {phrases.map((p, i) => (
                <li key={`ph-${i}`} className="line-clamp-2">
                  «{typeof p === "string" ? p : JSON.stringify(p)}»
                </li>
              ))}
            </ul>
          </div>
        )}

        {peaks.length > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-medium">📈 Эмоциональные пики</h4>
            <ul className="space-y-1 text-[12px] text-text-tertiary">
              {peaks.map((p, i) => {
                const time = typeof p.time === "string" ? p.time : ""
                const emotion =
                  typeof p.emotion === "string"
                    ? p.emotion
                    : typeof p.peak === "string"
                      ? p.peak
                      : JSON.stringify(p)
                return (
                  <li key={`peak-${i}`}>
                    {time && <span className="tabular-nums mr-2">{time}</span>}
                    {emotion}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ScriptBlock({ call }: { call: CallDetail }) {
  const details = asObject<
    Record<string, { score?: number | null; comment?: string; na?: boolean }>
  >(call.scriptDetails)
  if (!details && call.scriptScorePct === null) return null

  // Always sort stages by numeric prefix (1..11) — jsonb key order is not
  // guaranteed when Postgres reads the field, so different cards rendered
  // stages in random order.
  const sortedKeys = details
    ? Object.keys(details).sort((a, b) => {
        const na = parseInt(a.match(/^\d+/)?.[0] ?? "0", 10)
        const nb = parseInt(b.match(/^\d+/)?.[0] ?? "0", 10)
        return na - nb
      })
    : []

  // Denominator = ALWAYS 11 for diva (даже если в jsonb меньше ключей —
  // отсутствующие считаются как "не выполнено"). Числитель = score > 0.
  // N/A строки попадают в total как 0 — РОП видит правду 6/11 — 55%.
  const SCRIPT_TOTAL = 11
  let scored = 0
  if (details) {
    for (const k of sortedKeys) {
      const v = details[k] ?? {}
      if (typeof v.score === "number" && v.score > 0) scored++
    }
  }
  const total = SCRIPT_TOTAL
  const pct = Math.round((scored / total) * 100)
  const callTypeLabel = call.callType ?? "—"
  const outcomeLabel = call.outcome ?? call.callOutcome ?? "—"

  return (
    <Card>
      <CardHeader>
        <CardTitle title={`${scored} из ${total} этапов выполнены`}>
          📊 Скрипт-скоринг{" "}
          <span className="text-text-secondary">
            ({scored}/{total} — {pct}%)
          </span>
        </CardTitle>
        <CardDescription>
          11 этапов скрипта diva. N/A строки — легитимные пропуски (не
          применимы для этого типа звонка), но в общий процент они входят
          как «не выполнено» — так РОП видит реальную картину.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {details ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Этап</TableHead>
                <TableHead className="w-32 text-right">Балл</TableHead>
                <TableHead>Комментарий</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedKeys.map((key) => {
                const v = details[key] ?? {}
                const isNA =
                  v.na === true || v.score === null || v.score === undefined
                const score = typeof v.score === "number" ? v.score : null

                if (isNA) {
                  const tooltip = `Этот этап не применим к данному типу звонка (тип: ${callTypeLabel}, outcome: ${outcomeLabel})`
                  return (
                    <TableRow key={key} className="text-text-tertiary">
                      <TableCell className="font-medium">
                        {SCRIPT_STAGE_LABELS[key] ?? key}
                      </TableCell>
                      <TableCell
                        className="text-right tabular-nums text-text-muted"
                        title={tooltip}
                      >
                        ◯ Не применимо
                      </TableCell>
                      <TableCell
                        className="text-text-tertiary"
                        title={tooltip}
                      >
                        {v.comment ?? "—"}
                      </TableCell>
                    </TableRow>
                  )
                }

                const icon =
                  score === 1 ? "✅" : score === 0.5 ? "⚠️" : score === 0 ? "❌" : "—"
                const cls =
                  score === 1
                    ? "text-status-green"
                    : score === 0.5
                      ? "text-status-amber"
                      : score === 0
                        ? "text-status-red"
                        : ""
                return (
                  <TableRow key={key}>
                    <TableCell className="font-medium">
                      {SCRIPT_STAGE_LABELS[key] ?? key}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${cls}`}>
                      {icon} {score !== null ? `${score}/1` : ""}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {v.comment ?? "—"}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        ) : (
          <NullBadge what="scriptDetails" />
        )}
      </CardContent>
    </Card>
  )
}

function PhraseComplianceBlock({ call }: { call: CallDetail }) {
  const pc = asObject<
    Record<
      string,
      {
        used?: boolean
        evidence?: string
        missed?: string
        examples?: unknown
        actual_count?: number | string
        expected_count?: string
        note?: string
      }
    >
  >(call.phraseCompliance)
  if (!pc) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>🆕 phraseCompliance — 12 техник</CardTitle>
          <CardDescription>
            <NullBadge what="phraseCompliance" />
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }
  const usedCount = PHRASE_TECHNIQUES.filter((t) => pc[t]?.used === true).length

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          🆕 phraseCompliance — 12 техник{" "}
          <span className="text-text-secondary">
            ({usedCount}/{PHRASE_TECHNIQUES.length} used:true)
          </span>
        </CardTitle>
        <CardDescription>
          Используемые техники из скрипта diva и упущенные.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Техника</TableHead>
              <TableHead className="w-20 text-right">Статус</TableHead>
              <TableHead>Evidence / Missed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {PHRASE_TECHNIQUES.map((tech) => {
              const v = pc[tech]
              if (!v) {
                return (
                  <TableRow key={tech}>
                    <TableCell className="font-medium text-text-tertiary">
                      {tech.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell className="text-right text-text-muted">—</TableCell>
                    <TableCell className="text-text-muted">не оценено</TableCell>
                  </TableRow>
                )
              }
              const used = v.used === true
              return (
                <TableRow key={tech}>
                  <TableCell className="font-medium">
                    {tech.replace(/_/g, " ")}
                  </TableCell>
                  <TableCell
                    className={`text-right ${used ? "text-status-green" : "text-status-red"}`}
                  >
                    {used ? "✅ used" : "❌ missed"}
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {used ? (v.evidence ?? v.note ?? "—") : (v.missed ?? v.note ?? "—")}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function CriticalErrorsBlock({ call }: { call: CallDetail }) {
  const errs = normalizeCriticalErrors(call.criticalErrors)
  return (
    <Card>
      <CardHeader>
        <CardTitle>🚨 Критические ошибки</CardTitle>
        <CardDescription>6 enum diva — каждая отдельная проверка.</CardDescription>
      </CardHeader>
      <CardContent>
        {errs.length === 0 ? (
          <p className="text-sm text-status-green">
            ✅ Критических ошибок не найдено.
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {errs.map((e, i) => (
              <li
                key={`err-${i}`}
                className="rounded-md border border-status-red-border bg-status-red-dim p-2"
              >
                <span className="font-medium text-status-red">
                  {CRITICAL_ERROR_LABELS[e.error] ?? e.error}
                </span>
                {e.evidence && (
                  <p className="mt-1 text-[12px] text-text-secondary">
                    «{e.evidence}»
                  </p>
                )}
                {e.severity && (
                  <span className="mt-1 inline-block text-[11px] text-text-tertiary">
                    severity: {e.severity}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function CriticalDialogMomentsBlock({ call }: { call: CallDetail }) {
  const moments = asArray<Record<string, unknown>>(call.criticalDialogMoments)
  if (moments.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>⚠️ Критические моменты диалога</CardTitle>
        <CardDescription>
          Где разговор пошёл не так / упущенные пики готовности клиента.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm">
          {moments.map((m, i) => {
            const time = typeof m.time_range === "string" ? m.time_range : (m.time as string | undefined)
            const what = typeof m.what_happened === "string" ? m.what_happened : ""
            const should =
              typeof m.what_should_be === "string" ? m.what_should_be : ""
            return (
              <li
                key={`mom-${i}`}
                className="rounded-md border border-border-default p-2"
              >
                {time && (
                  <span className="tabular-nums mr-2 text-[11px] text-text-tertiary">
                    {time}
                  </span>
                )}
                <span className="text-text-primary">{what}</span>
                {should && (
                  <p className="mt-1 text-[12px] text-status-amber">
                    → должна была: {should}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

function RopInsightBlock({ call }: { call: CallDetail }) {
  if (!call.ropInsight) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>💡 Инсайт для РОПа</CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">
          {unescapeNewlines(call.ropInsight)}
        </pre>
      </CardContent>
    </Card>
  )
}

function NextStepBlock({ call }: { call: CallDetail }) {
  if (!call.nextStepRecommendation) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>🛠️ Что МОП должна сделать до следующего контакта</CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">
          {unescapeNewlines(call.nextStepRecommendation)}
        </pre>
      </CardContent>
    </Card>
  )
}

function CommitmentsBlock({ call }: { call: CallDetail }) {
  const commitments = asArray<Record<string, unknown>>(call.extractedCommitments)
  if (commitments.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          📋 Block 7 — Extracted Commitments{" "}
          <span className="text-text-secondary">({commitments.length} шт)</span>
        </CardTitle>
        <CardDescription>
          Обещания МОПа и клиента из звонка для tracking в CRM.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Speaker</TableHead>
              <TableHead>Время</TableHead>
              <TableHead>Цитата</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Deadline</TableHead>
              <TableHead>Target</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {commitments.map((c, i) => (
              <TableRow key={`c-${i}`}>
                <TableCell className="tabular-nums">{i + 1}</TableCell>
                <TableCell className="text-text-secondary">
                  {String(c.speaker ?? "—")}
                </TableCell>
                <TableCell className="tabular-nums text-text-tertiary">
                  {String(c.timestamp ?? c.time ?? "—")}
                </TableCell>
                <TableCell className="max-w-[260px]">
                  <span className="line-clamp-2 text-[12px]">
                    «{String(c.quote ?? "—")}»
                  </span>
                </TableCell>
                <TableCell className="text-text-secondary">
                  {String(c.action ?? "—")}
                </TableCell>
                <TableCell className="text-text-secondary">
                  {String(c.deadline ?? "—")}
                </TableCell>
                <TableCell className="max-w-[200px] text-text-secondary">
                  <span className="line-clamp-2 text-[12px]">
                    {String(c.target ?? "—")}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="mt-2 text-[11px] text-text-muted">
          commitmentsTracked={String(call.commitmentsTracked)} — статус
          выполнения требует интеграции с CRM tasks.
        </p>
      </CardContent>
    </Card>
  )
}

function CategoryBlock({ call }: { call: CallDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>🎯 Категория и исход</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableBody>
            <KvRow label="callType" value={call.callType} />
            <KvRow label="callOutcome" value={call.callOutcome} />
            <KvRow
              label="hadRealConversation"
              value={call.hadRealConversation === null ? null : String(call.hadRealConversation)}
            />
            <KvRow label="outcome" value={call.outcome} />
            <KvRow
              label="isCurator"
              value={call.isCurator === null ? null : String(call.isCurator)}
            />
            <KvRow
              label="isFirstLine"
              value={call.isFirstLine === null ? null : String(call.isFirstLine)}
            />
            <KvRow
              label="possibleDuplicate"
              value={call.possibleDuplicate === null ? null : String(call.possibleDuplicate)}
            />
            <KvRow
              label="purchaseProbability"
              value={
                call.purchaseProbability === null
                  ? null
                  : `${call.purchaseProbability}%`
              }
            />
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function KvRow({ label, value }: { label: string; value: string | null }) {
  if (value === null || value === "" || value === "—") return null
  return (
    <TableRow>
      <TableCell className="w-1/3 text-text-tertiary">{label}</TableCell>
      <TableCell className="font-medium">{value}</TableCell>
    </TableRow>
  )
}

function DiagnosticBlock({ call }: { call: CallDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>🛠 Диагностика</CardTitle>
        <CardDescription>
          transcript: {call.transcript === null ? "NULL" : `${call.transcript.length} chars`} ·
          {" "}audioUrl: {call.audioUrl === null ? "NULL" : "present"} ·
          {" "}enrichmentStatus: {call.enrichmentStatus ?? "—"} ·
          {" "}createdAt: {fmtMsk(call.createdAt)}
        </CardDescription>
      </CardHeader>
    </Card>
  )
}

function TagsBlock({ call }: { call: CallDetail }) {
  const tags = asArray<unknown>(call.enrichedTags)
  if (tags.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>🏷️ Теги</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t, i) => (
            <span
              key={`tag-${i}`}
              className="inline-block rounded-md bg-surface-3 px-2 py-1 text-[11px] text-text-secondary"
            >
              {typeof t === "string" ? t : JSON.stringify(t)}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
