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
import { scoreColor } from "@/lib/utils"

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

// Traffic-light thresholds 70/50 — see scoreColor in @/lib/utils (Task 39).
const scoreColorClass = scoreColor

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
  avgScriptScore: number | null
  hero: {
    totalCalls: number
    realConvCount: number
    avgScript: number
    redZoneManagers: number
    won: number
  }
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
    avgScriptScore,
    hero,
  } = props

  return (
    <div className="space-y-8">
      <HeroCard hero={hero} />
      <section className="space-y-6">
        <h2 className="mb-3 bg-[linear-gradient(135deg,_var(--ai-1),_var(--ai-2))] bg-clip-text text-lg font-semibold text-transparent">
          Сегодня — кто работает
        </h2>
        <Block1DailyActivity rows={daily} />
      </section>
      <section className="space-y-6">
        <h2 className="mb-3 bg-[linear-gradient(135deg,_var(--ai-1),_var(--ai-2))] bg-clip-text text-lg font-semibold text-transparent">
          Качество отдела
        </h2>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Block2QualityScore rows={daily} />
          <Block4MissingPhrases rows={missingPhrases} />
        </div>
        <Block3WorstCalls calls={worstCalls} />
        <details open>
          <summary className="cursor-pointer text-sm text-text-secondary hover:text-text-primary">
            Системные паттерны отдела (weakSpot + критические ошибки)
          </summary>
          <div className="mt-2">
            <Block4bDepartmentPatterns
              weakSpots={topWeakSpots}
              criticalErrors={topCriticalErrors}
            />
          </div>
        </details>
        <Block5UnfulfilledCommitments items={unfulfilledCommitments} />
      </section>
      <section className="space-y-6">
        <h2 className="mb-3 bg-[linear-gradient(135deg,_var(--ai-1),_var(--ai-2))] bg-clip-text text-lg font-semibold text-transparent">
          Тренды и контекст
        </h2>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <details open>
            <summary className="cursor-pointer text-sm text-text-secondary hover:text-text-primary">
              Когда лучше звонить (тепловая карта)
            </summary>
            <div className="mt-2">
              <Block6Heatmap cells={heatmap} />
            </div>
          </details>
          <Block7FunnelStages stages={funnelStages} />
        </div>
      </section>
      <FooterStatus
        lastSync={lastSync}
        pipelineGap={pipelineGap}
        wonCount={wonCount}
        avgScriptScore={avgScriptScore}
      />
    </div>
  )
}

// ─── Hero ───────────────────────────────────────────────────────────────────

/**
 * Compact above-the-fold summary (Q5 Option C). 5 stats — duplicates info
 * already shown in FooterStatus chips (WON, avg script). That's intentional:
 * Hero is at-a-glance on first paint; footer is sticky-while-scrolling.
 */
function HeroCard({
  hero,
}: {
  hero: {
    totalCalls: number
    realConvCount: number
    avgScript: number
    redZoneManagers: number
    won: number
  }
}) {
  return (
    <Card className="mb-4">
      <CardContent className="grid grid-cols-2 gap-3 py-3 sm:grid-cols-5">
        <Stat label="Наборов" value={hero.totalCalls} />
        <Stat label="Разговоров" value={hero.realConvCount} />
        <Stat
          label="Средний скрипт"
          value={`${Math.round(hero.avgScript * 100)}%`}
        />
        <Stat label="МОПов в красной зоне" value={hero.redZoneManagers} />
        <Stat label="WON" value={hero.won} />
      </CardContent>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs text-text-tertiary">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
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
          Наборы / дозвоны / НДЗ / автоответчики / минут разговора (talkDuration) /{" "}
          <span title="Звонок попал в pipeline gap — onPBX ещё не отдал аудио или был sync issue. Это не оценка МОПа.">
            не дотянулось
          </span>
          . Click МОПа → drill-down.
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
              <TableHead className="text-right">
                <span title="Звонок попал в pipeline gap — onPBX ещё не отдал аудио или был sync issue. Это не оценка МОПа.">
                  Не дотянулось
                </span>
              </TableHead>
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

/**
 * Cleveland dotplot: a single dot on a horizontal track at x = score%.
 * Replaces hand-rolled progress bars (Tufte: less ink, more signal).
 * Dot color follows traffic-light thresholds (70/50) consistent with the
 * percent label next to it.
 */
function DotPlot({
  value,
  fillVar,
}: {
  value: number // 0..100
  fillVar: string // CSS color value (e.g. "var(--ai-1)") or status class color
}) {
  const trackHeight = 16
  const r = 4
  const cx = Math.max(r, Math.min(100 - r, value))
  return (
    <svg
      width="100%"
      height={trackHeight}
      viewBox={`0 0 100 ${trackHeight}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <line
        x1="0"
        y1={trackHeight / 2}
        x2="100"
        y2={trackHeight / 2}
        stroke="var(--surface-3)"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={cx} cy={trackHeight / 2} r={r} fill={fillVar} />
    </svg>
  )
}

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
          const cls = scoreColorClass(pct)
          // Match traffic-light fill to status colors (70/50 thresholds)
          const fillVar =
            pct >= 0.7
              ? "var(--status-green)"
              : pct >= 0.5
                ? "var(--status-amber)"
                : "var(--status-red)"
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
              <div className="mt-1">
                <DotPlot value={pct * 100} fillVar={fillVar} />
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

// Tufte: only label meaningful tick positions (start/quarter/mid/three-quarter/end)
const HEATMAP_TICK_HOURS = [0, 6, 12, 18, 23]

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
          <table
            className="text-[10px]"
            style={{ borderCollapse: "separate", borderSpacing: "1px" }}
          >
            <thead>
              <tr>
                <th />
                {Array.from({ length: 24 }, (_, h) => (
                  <th
                    key={h}
                    className="w-4 px-px text-center font-normal text-text-muted"
                  >
                    {HEATMAP_TICK_HOURS.includes(h) ? h : ""}
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
                    const isEmpty = cell.total === 0
                    const isWorkingHour = h >= 9 && h <= 21
                    // Working-hours band: subtle tint layered over base bg.
                    // Stripes for empty cells: semantically "no data" ≠ "low success".
                    const bandLayer = isWorkingHour
                      ? "linear-gradient(rgba(120,120,120,0.06), rgba(120,120,120,0.06))"
                      : ""
                    const stripeLayer = isEmpty
                      ? "repeating-linear-gradient(45deg, rgba(120,120,120,0.10) 0 2px, transparent 2px 4px)"
                      : ""
                    const layers = [stripeLayer, bandLayer]
                      .filter(Boolean)
                      .join(", ")
                    const baseColor = isEmpty
                      ? "transparent"
                      : `rgba(52, 211, 153, ${0.1 + intensity * 0.7})`
                    return (
                      <td
                        key={h}
                        title={
                          isEmpty
                            ? `${DOW_LABELS[dow]} ${h}:00 — нет звонков`
                            : `${DOW_LABELS[dow]} ${h}:00 — ${cell.total} звонков, ${Math.round(intensity * 100)}% success`
                        }
                        className="h-4 w-4"
                        style={{
                          backgroundColor: baseColor,
                          backgroundImage: layers || undefined,
                        }}
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

// Funnel mental model: РОП reads top-to-bottom from «Новый» to «Закрыта».
// Defensive matcher — actual stage names from CRM may vary slightly.
function stageOrder(name: string | null): number {
  const n = (name ?? "").toLowerCase()
  if (n.includes("новый") || n.startsWith("1") || n.includes("заявка"))
    return 0
  if (n.includes("квалиф")) return 1
  if (n.includes("презент")) return 2
  if (n.includes("оплат")) return 3
  if (n.includes("выигран")) return 4
  if (n.includes("проигран")) return 5
  return 99 // unknown stages at end
}

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
  const sortedStages = [...stages].sort(
    (a, b) => stageOrder(a.stageName) - stageOrder(b.stageName)
  )
  const max = sortedStages.reduce((m, s) => (s.count > m ? s.count : m), 1)
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
        {sortedStages.map((s, i) => {
          const w = (s.count / max) * 100
          const nameLower = (s.stageName ?? "").toLowerCase()
          const isWon = nameLower.includes("выигран")
          const isLost = nameLower.includes("проигран")
          const fillClass = isWon
            ? "bg-status-green"
            : isLost
              ? "bg-status-red"
              : "bg-surface-3"
          return (
            <div key={`${s.stageCrmId ?? "none"}-${i}`} className="text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${fillClass}`} />
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
                  className={`h-full rounded-full ${fillClass}`}
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

// ─── Footer status ──────────────────────────────────────────────────────────

function FooterStatus({
  lastSync,
  pipelineGap,
  wonCount,
  avgScriptScore,
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
  avgScriptScore: number | null
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
        {avgScriptScore !== null && (
          <span className="text-text-secondary">
            📊 Средний скрипт отдела: {Math.round(avgScriptScore * 100)}%
          </span>
        )}
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
