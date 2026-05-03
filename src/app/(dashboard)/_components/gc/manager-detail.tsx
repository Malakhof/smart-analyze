import Link from "next/link"
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
import type { ManagerDetail } from "@/lib/queries/managers-gc"
import type { HeatmapCell } from "@/lib/queries/dashboard-gc"

const MOSCOW_FMT = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
})

function fmtMsk(d: Date | null | undefined): string {
  if (!d) return "—"
  return MOSCOW_FMT.format(d)
}

function pct(v: number | null): string {
  if (v === null) return "—"
  return `${Math.round(v * 100)}%`
}

function deltaArrow(value: number | null, baseline: number | null): string {
  if (value === null || baseline === null) return ""
  if (value > baseline + 0.5) return "↑"
  if (value < baseline - 0.5) return "↓"
  return "="
}

const DOW_LABELS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"]

export function ManagerDetailGc({
  detail,
  heatmap,
}: {
  detail: ManagerDetail
  heatmap: HeatmapCell[]
}) {
  return (
    <div className="space-y-6">
      <Counters detail={detail} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DistributionBlock
          title="Распределение по callType"
          rows={detail.callTypeDistribution}
        />
        <DistributionBlock
          title="Распределение по managerStyle"
          rows={detail.managerStyleDistribution}
        />
      </div>
      <PatternsBlock detail={detail} />
      <HeatmapBlock cells={heatmap} />
      <ClientsBlock detail={detail} />
    </div>
  )
}

function Counters({ detail }: { detail: ManagerDetail }) {
  const c = detail.counters
  return (
    <Card>
      <CardHeader>
        <CardTitle>Активность за период</CardTitle>
        <CardDescription>
          6 счётчиков из анкеты diva (9.1-9.5) + pipeline_gap.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Counter label="Наборы" value={c.dialed} />
          <Counter
            label="Дозвоны"
            value={c.real}
            sub={
              c.dialed > 0 ? `${Math.round((c.real / c.dialed) * 100)}%` : ""
            }
          />
          <Counter
            label="НДЗ"
            value={c.ndz}
            sub={
              c.dialed > 0 ? `${Math.round((c.ndz / c.dialed) * 100)}%` : ""
            }
            hint="text-text-tertiary"
          />
          <Counter
            label="Автоответчики"
            value={c.voicemail}
            sub={
              c.dialed > 0
                ? `${Math.round((c.voicemail / c.dialed) * 100)}%`
                : ""
            }
            hint="text-text-tertiary"
          />
          <Counter
            label="Минут разговора"
            value={c.talkMinutes}
            sub="talkDuration"
          />
          <Counter
            label="Не дотянулось"
            tooltip="Звонок попал в pipeline gap — onPBX ещё не отдал аудио или был sync issue. Это не оценка МОПа."
            value={c.pipelineGap}
            sub={
              c.pipelineGap > 0 ? `${Math.round(c.pipelineGapPct * 100)}%` : "—"
            }
            hint={c.pipelineGapPct > 0.1 ? "text-status-red" : "text-text-tertiary"}
          />
        </div>
        {detail.scriptScorePctAvg !== null && (
          <p className="mt-4 text-sm text-text-secondary">
            📊 AVG script score:{" "}
            <span className="font-medium text-text-primary">
              {Math.round(detail.scriptScorePctAvg * 100)}%
            </span>{" "}
            (среди real_conversation ≥ 60s)
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function Counter({
  label,
  value,
  sub,
  hint,
  tooltip,
}: {
  label: string
  value: number | string
  sub?: string
  hint?: string
  tooltip?: string
}) {
  return (
    <div className="rounded-md border border-border-default bg-surface-1 p-3">
      <p className="text-[11px] text-text-tertiary" title={tooltip}>{label}</p>
      <p className="mt-1 text-[20px] font-semibold tabular-nums">{value}</p>
      {sub && (
        <p
          className={`mt-0.5 text-[11px] tabular-nums ${hint ?? "text-text-tertiary"}`}
        >
          {sub}
        </p>
      )}
    </div>
  )
}

function DistributionBlock({
  title,
  rows,
}: {
  title: string
  rows: Array<{ key: string; count: number; pct: number }>
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>Нет данных за период.</CardDescription>
        </CardHeader>
      </Card>
    )
  }
  const max = rows[0]?.count ?? 1
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {rows.map((r) => {
          const w = (r.count / max) * 100
          return (
            <div key={r.key}>
              <div className="flex items-center justify-between gap-3">
                <span>{r.key}</span>
                <span className="shrink-0 tabular-nums text-text-secondary">
                  {r.count}
                  <span className="ml-2 text-text-tertiary">
                    {Math.round(r.pct * 100)}%
                  </span>
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${w}%`,
                    background:
                      "linear-gradient(135deg, var(--ai-1), var(--ai-2))",
                  }}
                />
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function PatternsBlock({ detail }: { detail: ManagerDetail }) {
  const phrase = detail.phraseStats
  return (
    <Card>
      <CardHeader>
        <CardTitle>Паттерны МОПа</CardTitle>
        <CardDescription>
          Системные ошибки, упущенные техники, сравнение с отделом.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h4 className="mb-2 text-sm font-medium">Топ-3 weakSpot</h4>
          {detail.weakSpots.length === 0 ? (
            <p className="text-sm text-text-tertiary">Нет данных.</p>
          ) : (
            <ol className="space-y-1.5 text-sm">
              {detail.weakSpots.map((w, i) => (
                <li key={`ws-${i}`} className="flex items-start justify-between gap-3">
                  <span className="line-clamp-2">«{w.spot}»</span>
                  <span className="shrink-0 tabular-nums text-text-tertiary">
                    {w.count}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div>
          <h4 className="mb-2 text-sm font-medium">Топ-3 critical errors</h4>
          {detail.topCriticalErrors.length === 0 ? (
            <p className="text-sm text-text-tertiary">Нет данных.</p>
          ) : (
            <ol className="space-y-1.5 text-sm">
              {detail.topCriticalErrors.slice(0, 3).map((e, i) => (
                <li key={`ce-${i}`} className="flex items-center justify-between gap-3">
                  <span>{e.error}</span>
                  <span className="shrink-0 tabular-nums text-status-red">
                    {pct(e.pct)} ({e.count})
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="lg:col-span-2 border-t border-border-default pt-4">
          <h4 className="mb-2 text-sm font-medium">phraseCompliance — 12 техник</h4>
          {phrase.usedAvg === null ? (
            <p className="text-sm text-text-tertiary">
              Нет звонков с phraseCompliance.
            </p>
          ) : (
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-text-tertiary">У этого МОПа: </span>
                <span className="font-medium text-text-primary">
                  {phrase.usedAvg.toFixed(1)} / 12 used:true
                </span>
                {phrase.deptAvg !== null && (
                  <>
                    <span className="ml-3 text-text-tertiary">
                      vs средний по отделу:{" "}
                    </span>
                    <span className="font-medium">
                      {phrase.deptAvg.toFixed(1)} / 12
                    </span>
                    <span className="ml-2 text-text-secondary">
                      {deltaArrow(phrase.usedAvg, phrase.deptAvg)}
                    </span>
                  </>
                )}
              </div>
              {phrase.topMissing.length > 0 && (
                <div>
                  <p className="mb-1 text-text-tertiary">
                    Топ-3 missing техник:
                  </p>
                  <ul className="space-y-1">
                    {phrase.topMissing.map((m, i) => (
                      <li
                        key={`m-${i}`}
                        className="flex items-center justify-between gap-3"
                      >
                        <span>{m.technique.replace(/_/g, " ")}</span>
                        <span className="shrink-0 tabular-nums text-status-amber">
                          {pct(m.missingPct)} звонков
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function HeatmapBlock({ cells }: { cells: HeatmapCell[] }) {
  if (cells.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Когда МОП эффективнее</CardTitle>
          <CardDescription>Нет данных за 30 дней.</CardDescription>
        </CardHeader>
      </Card>
    )
  }
  const grid: HeatmapCell[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({
      dow: 0,
      hour: 0,
      total: 0,
      successRate: 0,
    }))
  )
  for (const c of cells) {
    if (c.dow >= 0 && c.dow <= 6 && c.hour >= 0 && c.hour <= 23) {
      grid[c.dow][c.hour] = c
    }
  }
  const rowOrder = [1, 2, 3, 4, 5, 6, 0]
  // Insight: best/worst hour
  const valid = cells.filter((c) => c.total >= 3)
  const best = [...valid].sort((a, b) => b.successRate - a.successRate)[0]
  const worst = [...valid].sort((a, b) => a.successRate - b.successRate)[0]
  return (
    <Card>
      <CardHeader>
        <CardTitle>Когда МОП эффективнее</CardTitle>
        <CardDescription>
          Тепловая карта 7×24 МСК за 30 дней. Цвет = success rate.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="text-[10px]">
            <thead>
              <tr>
                <th />
                {Array.from({ length: 24 }, (_, h) => (
                  <th
                    key={h}
                    className="w-4 px-px text-center font-normal text-text-muted"
                  >
                    {h % 3 === 0 ? h : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowOrder.map((dow) => (
                <tr key={dow}>
                  <td className="pr-2 text-text-tertiary">{DOW_LABELS[dow]}</td>
                  {grid[dow].map((cell, h) => {
                    const intensity = cell.total === 0 ? 0 : cell.successRate
                    const bg =
                      cell.total === 0
                        ? "rgba(120,120,120,0.04)"
                        : `rgba(52, 211, 153, ${0.1 + intensity * 0.7})`
                    return (
                      <td
                        key={h}
                        title={
                          cell.total === 0
                            ? `${DOW_LABELS[dow]} ${h}:00 — нет звонков`
                            : `${DOW_LABELS[dow]} ${h}:00 — ${cell.total} звонков, ${Math.round(intensity * 100)}% success`
                        }
                        className="h-4 w-4 border border-surface-1"
                        style={{ backgroundColor: bg }}
                      />
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {best && worst && (
          <p className="mt-3 text-[12px] text-text-secondary">
            Лучшее окно: <strong>{DOW_LABELS[best.dow]} {best.hour}:00</strong>{" "}
            ({Math.round(best.successRate * 100)}% success, {best.total} звонков).
            Худшее: <strong>{DOW_LABELS[worst.dow]} {worst.hour}:00</strong>{" "}
            ({Math.round(worst.successRate * 100)}%).
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function ClientsBlock({ detail }: { detail: ManagerDetail }) {
  if (detail.clients.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Клиенты</CardTitle>
          <CardDescription>Нет клиентов с звонками за период.</CardDescription>
        </CardHeader>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Клиенты ({detail.clients.length})</CardTitle>
        <CardDescription>
          Уникальные gcContactId — click → история звонков клиента.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Клиент</TableHead>
              <TableHead className="text-right">Звонков</TableHead>
              <TableHead className="text-right">Avg score</TableHead>
              <TableHead className="text-right">Последний</TableHead>
              <TableHead>gcContactId</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.clients.map((c) => {
              const phoneTail = c.clientPhone
                ? `тел. ***${c.clientPhone.slice(-4)}`
                : "—"
              return (
                <TableRow key={c.gcContactId}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/managers/${detail.managerId}/clients/${c.gcContactId}`}
                      className="hover:underline"
                    >
                      {c.clientName || phoneTail}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.callsCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.avgScorePct !== null
                      ? `${Math.round(c.avgScorePct * 100)}%`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-text-tertiary">
                    {fmtMsk(c.lastCallAt)}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-text-tertiary">
                    {c.gcContactId}
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
