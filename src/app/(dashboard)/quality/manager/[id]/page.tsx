export const dynamic = "force-dynamic"

import Link from "next/link"
import { notFound } from "next/navigation"
import { getManagerQuality } from "@/lib/queries/quality"
import { QcRecentCalls } from "../../_components/qc-recent-calls"

const AVATAR_CLASSES = [
  "bg-gradient-to-br from-ai-1 to-ai-2",
  "bg-gradient-to-br from-[#EC4899] to-ai-1",
  "bg-gradient-to-br from-status-amber to-[#EF4444]",
]

function getInitials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

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

export default async function QcManagerPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const manager = await getManagerQuality(id)

  if (!manager) notFound()

  const avatarIdx =
    manager.name.split("").reduce((s, c) => s + c.charCodeAt(0), 0) %
    AVATAR_CLASSES.length

  const stats = [
    { label: "Всего звонков", value: String(manager.totalCalls) },
    {
      label: "Средний балл",
      value: `${Math.round(manager.avgScore)}%`,
      color: scoreColor(manager.avgScore),
    },
    {
      label: "Лучший",
      value: `${Math.round(manager.bestScore)}%`,
      color: "text-status-green",
    },
    {
      label: "Худший",
      value: `${Math.round(manager.worstScore)}%`,
      color: "text-status-red",
    },
  ]

  // Map calls to the format QcRecentCalls expects
  const callRows = manager.calls.map((c) => ({
    id: c.id,
    crmId: null as string | null,
    managerName: manager.name,
    clientName: c.clientName,
    direction: c.direction,
    duration: c.duration,
    totalScore: c.totalScore,
    category: null as string | null,
    tags: c.tags,
    recommendation: null as string | null,
    audioUrl: null as string | null,
    createdAt: c.createdAt,
  }))

  return (
    <>
      {/* Back link */}
      <Link
        href="/quality"
        className="mb-5 inline-flex items-center gap-1 text-[13px] text-text-secondary transition-colors hover:text-text-primary"
      >
        &larr; Контроль качества
      </Link>

      {/* Manager header */}
      <div className="mb-6 flex items-center gap-4">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold text-white ${AVATAR_CLASSES[avatarIdx]}`}
        >
          {getInitials(manager.name)}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[22px] font-bold tracking-[-0.04em]">
            {manager.name}
          </h2>
          <div className="text-[13px] text-text-tertiary">
            Контроль качества
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-3.5 py-1 text-[13px] font-bold ${scoreBg(manager.avgScore)} ${scoreColor(manager.avgScore)}`}
        >
          {Math.round(manager.avgScore)}%
        </span>
      </div>

      {/* Stats cards */}
      <div className="mb-6 grid grid-cols-4 gap-2.5">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]"
          >
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
              {s.label}
            </div>
            <div
              className={`text-[26px] font-extrabold leading-none tracking-[-0.04em] ${s.color ?? ""}`}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Calls table */}
      <section>
        <h3 className="mb-4 text-[16px] font-bold">Все звонки</h3>
        <QcRecentCalls calls={callRows} />
      </section>
    </>
  )
}
