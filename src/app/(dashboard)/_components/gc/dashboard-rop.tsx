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
import type {
  CriticalErrorAgg,
  DailyActivityRow,
  DepartmentPattern,
  FunnelStageCount,
  HeatmapCell,
  MissingPhrase,
  UnfulfilledCommitment,
  WorstCall,
} from "@/lib/queries/dashboard-gc"

const MOSCOW_FMT = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
})

function fmtMsk(d: Date): string {
  return MOSCOW_FMT.format(d)
}

function fmtSeconds(secs: number | null | undefined): string {
  if (!secs && secs !== 0) return "—"
  const s = Math.round(secs)
  const m = Math.floor(s / 60)
  const ss = s % 60
  return `${m}:${ss.toString().padStart(2, "0")}`
}

function fmtAgo(d: Date): string {
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000)
  if (diffMin < 1) return "только что"
  if (diffMin < 60) return `${diffMin} мин назад`
  const h = Math.floor(diffMin / 60)
  if (h < 24) return `${h} ч назад`
  return `${Math.floor(h / 24)} дн назад`
}

function scoreColorClass(pct: number | null): string {
  if (pct === null) return "text-text-tertiary"
  if (pct >= 0.7) return "text-status-green"
  if (pct >= 0.5) return "text-status-amber"
  return "text-status-red"
}

/**
 * criticalErrors is a jsonb array where items may be either bare strings
 * (legacy) or objects {error, evidence, severity} (v9+). Normalize to a list
 * of strings for badge rendering.
 */
function normalizeCriticalErrors(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    if (typeof item === "string") {
      out.push(item)
    } else if (item && typeof item === "object" && "error" in item) {
      const e = (item as { error: unknown }).error
      if (typeof e === "string") out.push(e)
    }
  }
  return out
}

const DOW_LABELS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"]

interface Props {
  daily: DailyActivityRow[]
  worstCalls: WorstCall[]
  missingPhrases: MissingPhrase[]
  topWeakSpots: DepartmentPattern[]
  topCriticalErrors: CriticalErrorAgg[]
  unfulfilledCommitments: UnfulfilledCommitment[]
  heatmap: HeatmapCell[]
  funnelStages: FunnelStageCount[]
  lastSync: Date | null
  pipelineGap: {
    total: number
    gap: number
    pct: number
    pendingEnrich: number
    pendingPct: number
  }
  wonCount: number
}

export function DashboardRop(props: Props) {
  const {
    daily,
    worstCalls,
    missingPhrases,
    topWeakSpots,
    topCriticalErrors,
    unfulfilledCommitments,
    heatmap,
    funnelStages,
    lastSync,
    pipelineGap,
    wonCount,
  } = props

  return (
    <div className="space-y-6">
      <Block1DailyActivity rows={daily} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Block2QualityScore rows={daily} />
        <Block4MissingPhrases rows={missingPhrases} />
      </div>
      <Block3WorstCalls calls={worstCalls} />
      <Block4bDepartmentPatterns
        weakSpots={topWeakSpots}
        criticalErrors={topCriticalErrors}
      />
      <Block5UnfulfilledCommitments items={unfulfilledCommitments} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Block6Heatmap cells={heatmap} />
        <Block7FunnelStages stages={funnelStages} />
      </div>
      <FooterStatus
        lastSync={lastSync}
        pipelineGap={pipelineGap}
        wonCount={wonCount}
      />
    </div>
  )
}

// ─── Block 1 ────────────────────────────────────────────────────────────────

function Block1DailyActivity({ rows }: { rows: DailyActivityRow[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Активность за период</CardTitle>
          <CardDescription>Нет звонков за выбранный период</CardDescription>
        </CardHeader>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Активность за период</CardTitle>
        <CardDescription>
          Наборы / дозвоны / НДЗ / автоответчики / минут разговора (talkDuration) /
          без аудио. Click МОПа → drill-down.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>МОП</TableHead>
              <TableHead className="text-right">Наборы</TableHead>
              <TableHead className="text-right">Дозвоны</TableHead>
              <TableHead className="text-right">НДЗ</TableHead>
              <TableHead className="text-right">АО</TableHead>
              <TableHead className="text-right">Минут разговора</TableHead>
              <TableHead className="text-right">Без аудио</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const gapPct = r.dialed > 0 ? r.pipelineGap / r.dialed : 0
              return (
                <TableRow
                  key={r.managerId}
                  className="cursor-pointer hover:bg-surface-2"
                >
                  <TableCell className="font-medium">
                    <Link
                      href={`/managers/${r.managerId}`}
                      className="hover:underline"
                    >
                      {r.managerName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.dialed}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.real}</TableCell>
                  <TableCell className="text-right tabular-nums text-text-tertiary">
                    {r.ndz}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-text-tertiary">
                    {r.voicemail}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.talkMinutes ? `${r.talkMinutes} мин` : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.pipelineGap > 0 ? (
                      <span
                        className={
                          gapPct > 0.1 ? "text-status-red" : "text-status-amber"
                        }
                      >
                        {r.pipelineGap} ⚠️
                      </span>
                    ) : (
                      <span className="text-text-muted">0</span>
                    )}
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

// ─── Block 2 ────────────────────────────────────────────────────────────────

function Block2QualityScore({ rows }: { rows: DailyActivityRow[] }) {
  const valid = rows.filter((r) => r.scriptScorePctAvg !== null)
  if (valid.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Оценка скрипта</CardTitle>
          <CardDescription>
            Нет звонков с оценкой за период (нужны real_conversation ≥ 60s).
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }
  const sorted = [...valid].sort(
    (a, b) => (b.scriptScorePctAvg ?? 0) - (a.scriptScorePctAvg ?? 0)
  )
  const max = sorted[0]?.scriptScorePctAvg ?? 1
  return (
    <Card>
      <CardHeader>
        <CardTitle>Оценка скрипта</CardTitle>
        <CardDescription>
          AVG `scriptScorePct` среди real_conversation ≥ 60s. Зелёный = top 30%,
          красный = bottom 30%.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {sorted.map((r) => {
          const pct = r.scriptScorePctAvg ?? 0
          const w = max > 0 ? Math.max(2, (pct / max) * 100) : 0
          const cls = scoreColorClass(pct)
          return (
            <div key={r.managerId} className="text-sm">
              <div className="flex items-center justify-between">
                <Link
                  href={`/managers/${r.managerId}`}
                  className="font-medium hover:underline"
                >
                  {r.managerName}
                </Link>
                <span className={`tabular-nums ${cls}`}>
                  {Math.round(pct * 100)}%
                </span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className={`h-full rounded-full ${
                    pct >= 0.7
                      ? "bg-status-green"
                      : pct >= 0.5
                        ? "bg-status-amber"
                        : "bg-status-red"
                  }`}
                  style={{ width: `${w}%` }}
                />
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

// ─── Block 3 ────────────────────────────────────────────────────────────────

function Block3WorstCalls({ calls }: { calls: WorstCall[] }) {
  if (calls.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Топ-10 проблемных звонков</CardTitle>
          <CardDescription>Нет проблемных звонков за период.</CardDescription>
        </CardHeader>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Топ-10 проблемных звонков</CardTitle>
        <CardDescription>
          Сортировка по `scriptScorePct ASC` среди real_conversation ≥ 60s.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {calls.map((c) => {
          const pct = c.scriptScorePct ?? 0
          const errors = normalizeCriticalErrors(c.criticalErrors).slice(0, 2)
          return (
            <Link
              key={c.id}
              href={c.pbxUuid ? `/calls/${c.pbxUuid}` : "#"}
              className="block rounded-md border border-border-default p-3 transition-colors hover:bg-surface-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className={`font-medium ${scoreColorClass(pct)}`}>
                      {Math.round(pct * 100)}%
                    </span>
                    <span className="text-text-secondary">
                      {c.managerName ?? "—"} → {c.clientName ?? "—"}
                    </span>
                    <span className="text-text-tertiary">
                      {fmtMsk(c.createdAt)}
                    </span>
                    <span className="text-text-tertiary">
                      {fmtSeconds(c.talkDuration ?? c.userTalkTime)}
                    </span>
                  </div>
                  {c.managerWeakSpot && (
                    <p className="mt-1 line-clamp-1 text-sm text-text-secondary">
                      «{c.managerWeakSpot}»
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {errors.map((e, i) => (
                      <span
                        key={`${c.id}-err-${i}`}
                        className="rounded-md bg-status-red-dim px-2 py-0.5 text-[11px] text-status-red"
                      >
                        {e}
                      </span>
                    ))}
                    {c.callType && (
                      <span className="rounded-md bg-surface-3 px-2 py-0.5 text-[11px] text-text-tertiary">
                        {c.callType}
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-text-tertiary">→</span>
              </div>
            </Link>
          )
        })}
      </CardContent>
    </Card>
  )
}

// ─── Block 4 ────────────────────────────────────────────────────────────────

const PHRASE_HINTS: Record<string, string> = {
  программирование_звонка: "«Я задам вопросы, потом расскажу как помочь, хорошо?»",
  искренние_комплименты: "Минимум 2-3 за разговор: про осознанность, энергию, рациональность.",
  эмоциональный_подхват: "«Угу», «Поняла», подхват эмоций клиента.",
  юмор_забота: "Уместный юмор + забота где это снимет напряжение.",
  крюк_к_боли: "Связать боль клиента с причиной → продукт.",
  презентация_под_боль: "Не пересказ курса — выделить главное под боли.",
  попытка_сделки_без_паузы: "Сразу после презентации: «удобнее полностью или в рассрочку?»",
  выбор_без_выбора: "«Внести оплату до конца дня или завтра?»",
  бонусы_с_дедлайном: "«Если до завтра — открою бонусы (массаж/тейп/комплекс)»",
  повторная_попытка_после_возражения: "После закрытого возражения — снова закрытие.",
  маленькая_просьба: "«Пришлите скрин оплаты» — commitment loop.",
  следующий_шаг_с_временем: "Конкретная дата/время следующего шага.",
}

function Block4MissingPhrases({ rows }: { rows: MissingPhrase[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Упущенные техники</CardTitle>
          <CardDescription>
            Нет данных по `phraseCompliance` за период.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Упущенные техники</CardTitle>
        <CardDescription>
          Топ-3 фразы из 12 техник скрипта diva, которые МОПы НЕ используют.
          Агрегат `phraseCompliance.used=false`.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((p) => (
          <div
            key={p.technique}
            className="rounded-md border border-border-default p-3"
          >
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{p.technique.replace(/_/g, " ")}</span>
              <span className="tabular-nums text-status-red">
                {Math.round(p.pct * 100)}% ({p.missingCount}/{p.totalCount})
              </span>
            </div>
            <p className="mt-1 text-[12px] text-text-tertiary">
              {PHRASE_HINTS[p.technique] ?? ""}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

// ─── Block 4b ───────────────────────────────────────────────────────────────

function Block4bDepartmentPatterns({
  weakSpots,
  criticalErrors,
}: {
  weakSpots: DepartmentPattern[]
  criticalErrors: CriticalErrorAgg[]
}) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Системные паттерны отдела — Топ-5 weakSpot</CardTitle>
          <CardDescription>
            Что системно повторяется среди МОПов (managerWeakSpot agg).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {weakSpots.length === 0 ? (
            <p className="text-sm text-text-tertiary">Нет данных за период.</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {weakSpots.map((w, i) => (
                <li
                  key={`${w.weakSpot}-${i}`}
                  className="flex items-start justify-between gap-3"
                >
                  <span className="line-clamp-2">«{w.weakSpot}»</span>
                  <span className="shrink-0 tabular-nums text-text-tertiary">
                    {w.occurrences} раз / {w.managers} МОПов
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Системные паттерны отдела — Топ-5 ошибок</CardTitle>
          <CardDescription>
            Какая критическая ошибка чаще всего у отдела (criticalErrors agg).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {criticalErrors.length === 0 ? (
            <p className="text-sm text-text-tertiary">Нет данных за период.</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {criticalErrors.map((e, i) => (
                <li
                  key={`${e.error}-${i}`}
                  className="flex items-center justify-between gap-3"
                >
                  <span>{e.error}</span>
                  <span className="shrink-0 tabular-nums text-status-red">
                    {Math.round(e.pct * 100)}% ({e.count})
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Block 5 ────────────────────────────────────────────────────────────────

function Block5UnfulfilledCommitments({
  items,
}: {
  items: UnfulfilledCommitment[]
}) {
  if (items.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Обещания требующие follow-up</CardTitle>
          <CardDescription>Нет открытых обещаний за период.</CardDescription>
        </CardHeader>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Обещания требующие follow-up</CardTitle>
        <CardDescription>
          extractedCommitments из звонков старше 24ч. Статус «выполнено/нет»
          доступен после интеграции с CRM tasks — пока показываем сами обещания
          для ручного follow-up'а.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((it) => (
          <Link
            key={it.callId}
            href={it.pbxUuid ? `/calls/${it.pbxUuid}` : "#"}
            className="block rounded-md border border-border-default p-3 transition-colors hover:bg-surface-2"
          >
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-text-secondary">
                ⏰ {fmtAgo(it.createdAt)} — {it.managerName ?? "—"} →{" "}
                {it.clientName ?? "—"}
              </span>
              <span className="text-text-tertiary">
                {it.commitments.length} обещание(й)
              </span>
            </div>
            <ul className="mt-2 space-y-1 text-[12px] text-text-tertiary">
              {it.commitments.map((c, i) => (
                <li key={`${it.callId}-c-${i}`} className="line-clamp-1">
                  «{c.quote ?? c.target ?? c.action}»{" "}
                  {c.timestamp && (
                    <span className="text-text-muted">{c.timestamp}</span>
                  )}
                  {c.action && (
                    <span className="ml-1 text-text-muted">[{c.action}]</span>
                  )}
                </li>
              ))}
            </ul>
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}

// ─── Block 6 ────────────────────────────────────────────────────────────────

function Block6Heatmap({ cells }: { cells: HeatmapCell[] }) {
  // Build 7×24 grid (Mon..Sun for visual; DOW: 0=Sun..6=Sat in pg)
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
  // Reorder rows: Mon, Tue, Wed, Thu, Fri, Sat, Sun
  const rowOrder = [1, 2, 3, 4, 5, 6, 0]
  return (
    <Card>
      <CardHeader>
        <CardTitle>Когда лучше звонить</CardTitle>
        <CardDescription>
          Тепловая карта 7 дней × 24 часа МСК. Цвет = success rate
          (real_conversation %) за последние 30 дней.
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
      </CardContent>
    </Card>
  )
}

// ─── Block 7 ────────────────────────────────────────────────────────────────

function Block7FunnelStages({ stages }: { stages: FunnelStageCount[] }) {
  if (stages.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Куда движутся клиенты после наших звонков</CardTitle>
          <CardDescription>
            Нет сделок со звонками за период.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }
  const max = stages[0]?.count ?? 1
  return (
    <Card>
      <CardHeader>
        <CardTitle>Куда движутся клиенты после наших звонков</CardTitle>
        <CardDescription>
          Сделки у которых был хотя бы один звонок за период, сгруппированные
          по текущему этапу воронки. Без % конверсий между стадиями — только
          распределение «где они сейчас».
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {stages.map((s, i) => {
          const w = (s.count / max) * 100
          return (
            <div key={`${s.stageCrmId ?? "none"}-${i}`} className="text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{
                      background:
                        "linear-gradient(135deg, var(--ai-1), var(--ai-2))",
                    }}
                  />
                  <span>{s.stageName}</span>
                </span>
                <span className="shrink-0 tabular-nums text-text-secondary">
                  {s.count}
                  <span className="ml-2 text-text-tertiary">
                    {Math.round(s.pct * 100)}%
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

// ─── Footer status ──────────────────────────────────────────────────────────

function FooterStatus({
  lastSync,
  pipelineGap,
  wonCount,
}: {
  lastSync: Date | null
  pipelineGap: {
    total: number
    gap: number
    pct: number
    pendingEnrich: number
    pendingPct: number
  }
  wonCount: number
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-default pt-3 text-[11px] text-text-muted">
      <span>
        Последняя синхронизация:{" "}
        {lastSync ? `${fmtAgo(lastSync)} (${fmtMsk(lastSync)} МСК)` : "—"}
      </span>
      <div className="flex flex-wrap gap-3">
        <span className="text-status-green">
          🏆 WON за период: {wonCount}
        </span>
        <span>
          pipeline_gap: {pipelineGap.gap}/{pipelineGap.total}
          {pipelineGap.pct > 0 && ` (${Math.round(pipelineGap.pct * 100)}%)`}
          {pipelineGap.pct > 0.1 && (
            <span className="ml-1 text-status-red">⚠️ проверить тех. отдел</span>
          )}
        </span>
        {pipelineGap.pendingEnrich > 0 && (
          <span className="text-status-amber">
            ⏳ ожидают Master Enrich: {pipelineGap.pendingEnrich} (
            {Math.round(pipelineGap.pendingPct * 100)}%)
          </span>
        )}
      </div>
    </div>
  )
}
