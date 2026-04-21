import Link from "next/link"
import { fmtMoney, fmtPercent, fmtDays } from "@/lib/format"
import type { RetroManagerPortrait } from "@/lib/queries/retro"

interface RetroManagerPortraitsProps {
  managers: RetroManagerPortrait[]
}

const BUCKET_LABEL: Record<RetroManagerPortrait["bucket"], string> = {
  best: "🏆 Лидеры",
  middle: "Середняки",
  worst: "⚠️ Нужна помощь",
}

const BUCKET_BORDER: Record<RetroManagerPortrait["bucket"], string> = {
  best: "border-t-status-green",
  middle: "border-t-status-amber",
  worst: "border-t-status-red",
}

const BUCKET_LABEL_COLOR: Record<RetroManagerPortrait["bucket"], string> = {
  best: "text-status-green",
  middle: "text-status-amber",
  worst: "text-status-red",
}

const STATUS_BADGE: Record<
  string,
  { label: string; bg: string; text: string }
> = {
  EXCELLENT: {
    label: "ЛИДЕР",
    bg: "bg-status-green-dim",
    text: "text-status-green",
  },
  WATCH: {
    label: "СТАБИЛЬНО",
    bg: "bg-status-amber-dim",
    text: "text-status-amber",
  },
  CRITICAL: {
    label: "НУЖНА ПОМОЩЬ",
    bg: "bg-status-red-dim",
    text: "text-status-red",
  },
}

/** Map bucket to status — guarantees consistency with the bucket badge above. */
const BUCKET_TO_STATUS: Record<RetroManagerPortrait["bucket"], string> = {
  best: "EXCELLENT",
  middle: "WATCH",
  worst: "CRITICAL",
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

export function RetroManagerPortraits({
  managers,
}: RetroManagerPortraitsProps) {
  if (managers.length === 0) {
    return (
      <div className="rounded-[10px] border border-border-default bg-surface-1 p-6 text-[13px] text-text-tertiary">
        Пока нет менеджеров с заполненными метриками.
      </div>
    )
  }

  // Group portraits in render order: best → middle → worst, with a small bucket
  // banner before each cluster.
  const buckets: Array<{
    bucket: RetroManagerPortrait["bucket"]
    items: RetroManagerPortrait[]
  }> = []
  for (const m of managers) {
    const last = buckets[buckets.length - 1]
    if (last && last.bucket === m.bucket) {
      last.items.push(m)
    } else {
      buckets.push({ bucket: m.bucket, items: [m] })
    }
  }

  return (
    <div className="space-y-8">
      {buckets.map((b) => (
        <div key={b.bucket}>
          <div
            className={`mb-3 text-[12px] font-bold uppercase tracking-[0.08em] ${BUCKET_LABEL_COLOR[b.bucket]}`}
          >
            {BUCKET_LABEL[b.bucket]}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {b.items.map((m) => (
              <PortraitCard key={m.id} m={m} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function PortraitCard({ m }: { m: RetroManagerPortrait }) {
  // Always derive status from bucket — ignore stale m.status to avoid
  // contradictions like "CRITICAL in 🏆 Лидеры" or "NO STATUS" gaps.
  const status = STATUS_BADGE[BUCKET_TO_STATUS[m.bucket]]
  const conv = m.conversionRate ?? 0
  const total = m.totalDeals ?? 0
  const success = m.successDeals ?? 0
  const avgVal = m.avgDealValue ?? 0
  const avgTime = m.avgDealTime ?? 0

  return (
    <div
      className={`rounded-[10px] border border-border-default border-t-2 ${BUCKET_BORDER[m.bucket]} bg-surface-1 p-5 shadow-[var(--card-shadow)]`}
    >
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-ai-1 to-ai-2 text-[14px] font-bold text-white">
          {getInitials(m.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="truncate text-[15px] font-semibold text-text-primary">
              {m.name}
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] ${status.bg} ${status.text}`}
            >
              {status.label}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-text-tertiary">Менеджер</div>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2">
        <Metric label="Конверсия" value={fmtPercent(conv)} accent />
        <Metric label="Сделок" value={String(total)} />
        <Metric label="Ср. чек" value={fmtMoney(avgVal)} />
      </div>

      <p className="text-[12.5px] leading-[1.6] text-text-secondary">
        {m.reason}
      </p>

      <Link
        href={`/managers/${m.id}`}
        className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-status-purple hover:underline"
      >
        Открыть полный портрет →
      </Link>
    </div>
  )
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div className="rounded-[8px] bg-surface-2 px-3 py-2">
      <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
        {label}
      </div>
      <div
        className={`text-[14px] font-bold leading-none ${accent ? "text-text-primary" : "text-text-secondary"}`}
      >
        {value}
      </div>
    </div>
  )
}
