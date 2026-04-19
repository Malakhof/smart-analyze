export const dynamic = "force-dynamic"

import Link from "next/link"
import { notFound } from "next/navigation"
import { getDealDetail } from "@/lib/queries/deal-detail"
import { DealHeader } from "./_components/deal-header"
import { DealAiAnalysis } from "./_components/deal-ai-analysis"
import { DealAudio } from "./_components/deal-audio"
import { DealMetrics } from "./_components/deal-metrics"
import { StageTree } from "./_components/stage-tree"
import { DealStatsSidebar } from "./_components/deal-stats-sidebar"
import { FunnelTimeline } from "./_components/funnel-timeline"

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const deal = await getDealDetail(id)

  if (!deal) notFound()

  const backHref = deal.manager ? `/managers/${deal.manager.id}` : "/managers"

  return (
    <>
      {/* Back link */}
      <Link
        href={backHref}
        className="mb-5 inline-flex items-center gap-1 text-[13px] text-text-secondary transition-colors hover:text-text-primary"
      >
        &larr; Назад
      </Link>

      {/* Deal title */}
      <h2 className="mb-2 text-[22px] font-bold tracking-[-0.04em]">
        {deal.title}
      </h2>

      {/* Deal header row */}
      <DealHeader
        managerName={deal.manager?.name ?? null}
        managerId={deal.manager?.id ?? null}
        amount={deal.amount}
        createdAt={deal.createdAt}
        duration={deal.duration}
        stageCount={deal.stageHistory.length}
        messageCount={
          deal.messages.filter((m) => m.sender !== "SYSTEM").length
        }
      />

      {/* 2-column layout */}
      <div className="grid grid-cols-[1fr_320px] gap-6">
        {/* LEFT COLUMN */}
        <div className="min-w-0 space-y-5">
          {/* AI Analysis */}
          {deal.analysis && (
            <DealAiAnalysis summary={deal.analysis.summary} />
          )}

          {/* Metric cards */}
          <DealMetrics
            talkRatio={deal.analysis?.talkRatio ?? null}
            avgResponseTime={deal.analysis?.avgResponseTime ?? null}
            messages={deal.messages}
          />

          {/* Audio calls — show if (a) recent enough to likely play OR (b) has transcript */}
          {(() => {
            // Sipuni retains audio ~4 months; older recordings won't play.
            // Show them ONLY if we have a transcript (then audio not needed anyway).
            const PLAYABLE_AGE_MS = 4 * 30 * 24 * 60 * 60 * 1000
            const now = Date.now()
            const audios = deal.messages
              .filter(
                (m) =>
                  m.isAudio &&
                  m.audioUrl &&
                  ((m.duration ?? 0) >= 60 ||
                    (m.content?.trim().length ?? 0) > 0)
              )
              .filter(
                (m, i, arr) =>
                  arr.findIndex((x) => x.audioUrl === m.audioUrl) === i
              )
              .map((m) => ({
                m,
                age: now - new Date(m.timestamp).getTime(),
                hasTranscript: (m.content?.trim().length ?? 0) > 50,
              }))
              .sort((a, b) => a.age - b.age) // newest first
            // Keep only: (recent enough to play) OR (has transcript)
            const visible = audios.filter(
              (x) => x.age < PLAYABLE_AGE_MS || x.hasTranscript
            )
            const hidden = audios.length - visible.length
            return (
              <>
                {visible.map(({ m }) => (
                  <DealAudio
                    key={m.id}
                    audioUrl={m.audioUrl!}
                    transcript={m.content || undefined}
                    duration={m.duration ?? undefined}
                    recordedAt={new Date(m.timestamp)}
                  />
                ))}
                {hidden > 0 && (
                  <div className="rounded-[10px] border border-border-default bg-surface-1 p-3 text-center text-[11px] text-text-tertiary">
                    Скрыто {hidden} ст{hidden === 1 ? "арая" : "арых"}{" "}
                    {hidden === 1
                      ? "запись"
                      : hidden < 5
                        ? "записи"
                        : "записей"}{" "}
                    без транскрипта — аудио истекло у провайдера. После
                    транскрибации появятся в контроле качества.
                  </div>
                )}
              </>
            )
          })()}

          {/* Funnel timeline — full funnel structure + per-stage messages */}
          {deal.funnel ? (
            <FunnelTimeline
              funnel={deal.funnel}
              stageHistory={deal.stageHistory}
              messages={deal.messages}
              dealCreatedAt={deal.createdAt}
              dealClosedAt={deal.closedAt ?? null}
            />
          ) : (
            <StageTree
              stages={deal.stageHistory}
              messages={deal.messages}
            />
          )}
        </div>

        {/* RIGHT COLUMN (sidebar) */}
        <div className="space-y-5">
          <div className="sticky top-20 space-y-5">
            <DealStatsSidebar
              messages={deal.messages}
              avgResponseTime={deal.analysis?.avgResponseTime ?? null}
              stages={deal.stageHistory}
            />
          </div>
        </div>
      </div>
    </>
  )
}
