export const dynamic = "force-dynamic"

import Link from "next/link"
import { notFound } from "next/navigation"
import { getCallDetail } from "@/lib/queries/quality"
import { ScriptChecklist } from "../../_components/script-checklist"
import { AudioPlayer } from "../../_components/audio-player"
import { QcTranscriptToggle } from "../../_components/qc-transcript-toggle"
import { QcScriptScoreBadge } from "../../_components/qc-script-score-badge"

function scoreColor(score: number): string {
  if (score >= 80) return "text-status-green"
  if (score >= 50) return "text-status-amber"
  return "text-status-red"
}

function scoreBg(score: number): string {
  if (score >= 80) return "bg-status-green-dim"
  if (score >= 50) return "bg-status-amber-dim"
  return "bg-status-red-dim"
}

function fmtDuration(seconds: number | null): string {
  if (!seconds) return "--:--"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

function fmtDate(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date))
}

export default async function CallDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const call = await getCallDetail(id)

  if (!call) notFound()

  const backHref = call.managerId
    ? `/quality/manager/${call.managerId}`
    : "/quality"

  return (
    <>
      {/* Back link */}
      <Link
        href={backHref}
        className="mb-5 inline-flex items-center gap-1 text-[13px] text-text-secondary transition-colors hover:text-text-primary"
      >
        &larr; Назад
      </Link>

      {/* 2-column layout */}
      <div className="grid grid-cols-[1fr_320px] gap-6">
        {/* LEFT COLUMN */}
        <div className="min-w-0 space-y-5">
          {/* Call header card */}
          <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
              <span className="font-semibold text-text-primary">
                {call.managerName ?? "Менеджер не указан"}
              </span>
              <span className="text-text-tertiary">|</span>
              <span className="text-text-secondary">
                {call.clientName ?? "Клиент не указан"}
              </span>
              <span className="text-text-tertiary">|</span>
              <span className="text-text-secondary">
                {call.direction === "INCOMING" ? "Входящий" : "Исходящий"}
              </span>
              <span className="text-text-tertiary">|</span>
              <span className="text-text-secondary">
                {fmtDuration(call.duration)}
              </span>
              <span className="text-text-tertiary">|</span>
              <span className="text-text-secondary">
                {fmtDate(call.createdAt)}
              </span>
              {call.crmUrl && (
                <>
                  <span className="text-text-tertiary">|</span>
                  <a
                    href={call.crmUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ai-1 hover:underline"
                  >
                    Открыть в CRM &rarr;
                  </a>
                </>
              )}
            </div>
          </div>

          {/* Audio player */}
          <AudioPlayer audioUrl={call.audioUrl} />

          {/* Transcript — switchable between original Whisper output and the
              AI-repaired version. Component handles defaulting and disabling
              the toggle when only one variant exists. */}
          <QcTranscriptToggle
            transcript={call.transcript}
            transcriptRepaired={call.transcriptRepaired}
          />

          {/* Script checklist */}
          <ScriptChecklist
            items={call.scoreItems}
            totalScore={call.totalScore}
          />
        </div>

        {/* RIGHT COLUMN (sidebar) */}
        <div className="space-y-5">
          <div className="sticky top-20 space-y-5">
            {/* Score card */}
            <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 text-center shadow-[var(--card-shadow)]">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
                Оценка
              </div>
              {call.totalScore != null ? (
                <div
                  className={`text-[42px] font-extrabold leading-none tracking-[-0.04em] ${scoreColor(call.totalScore)}`}
                >
                  {Math.round(call.totalScore)}%
                </div>
              ) : (
                <div className="text-[42px] font-extrabold leading-none tracking-[-0.04em] text-text-tertiary">
                  --
                </div>
              )}
              {call.totalScore != null && (
                <div
                  className={`mt-2 inline-block rounded-full px-3 py-0.5 text-[11px] font-semibold ${scoreBg(call.totalScore)} ${scoreColor(call.totalScore)}`}
                >
                  {call.totalScore >= 80
                    ? "Хорошо"
                    : call.totalScore >= 50
                      ? "Требует внимания"
                      : "Плохо"}
                </div>
              )}
            </div>

            {/* Stats */}
            <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)]">
              <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
                Детали
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between text-[13px]">
                  <span className="text-text-secondary">Длительность</span>
                  <span className="font-medium text-text-primary">
                    {fmtDuration(call.duration)}
                  </span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="text-text-secondary">Направление</span>
                  <span className="font-medium text-text-primary">
                    {call.direction === "INCOMING"
                      ? "Входящий"
                      : "Исходящий"}
                  </span>
                </div>
                {call.category && (
                  <div className="flex justify-between text-[13px]">
                    <span className="text-text-secondary">Категория</span>
                    <span className="font-medium text-text-primary">
                      {call.category}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-[13px]">
                  <span className="text-text-secondary">Пунктов скрипта</span>
                  <span className="font-medium text-text-primary">
                    {call.scoreItems.length}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-text-secondary">Балл скрипта</span>
                  <QcScriptScoreBadge
                    score={call.scriptScore}
                    details={call.scriptDetails}
                  />
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="text-text-secondary">Выполнено</span>
                  <span className="font-medium text-status-green">
                    {call.scoreItems.filter((i) => i.isDone).length}
                  </span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="text-text-secondary">Пропущено</span>
                  <span className="font-medium text-status-red">
                    {call.scoreItems.filter((i) => !i.isDone).length}
                  </span>
                </div>
              </div>
            </div>

            {/* Tags */}
            {call.tags.length > 0 && (
              <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)]">
                <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
                  Теги
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {call.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-ai-glow px-2.5 py-0.5 text-[11px] font-medium text-ai-1"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
