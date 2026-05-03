"use client"

import Link from "next/link"
import {
  ReferenceArea,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
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
import type { ClientCallRow, ClientDetail } from "@/lib/queries/client-detail-gc"

const MOSCOW_FMT = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
})

const MOSCOW_FMT_DATE = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
})

function fmtMsk(d: Date | null | undefined): string {
  if (!d) return "—"
  return MOSCOW_FMT.format(d)
}

function fmtMskDate(d: Date | null | undefined): string {
  if (!d) return "—"
  return MOSCOW_FMT_DATE.format(d)
}

function fmtSeconds(s: number | null | undefined): string {
  if (s === null || s === undefined) return "—"
  const m = Math.floor(s / 60)
  const ss = Math.round(s % 60)
  return `${m}:${ss.toString().padStart(2, "0")}`
}

function scoreColor(pct: number | null): string {
  if (pct === null) return "text-text-tertiary"
  if (pct >= 0.7) return "text-status-green"
  if (pct >= 0.5) return "text-status-amber"
  return "text-status-red"
}

export function ClientCard({ detail }: { detail: ClientDetail }) {
  const { subdomain, gcContactId, primaryDealCrmId } = detail
  const clientLink =
    subdomain && gcContactId
      ? `https://${subdomain}/user/control/user/update/id/${gcContactId}`
      : null
  const dealLink =
    subdomain && primaryDealCrmId
      ? `https://${subdomain}/sales/control/deal/update/id/${primaryDealCrmId}`
      : null
  const lastCall = detail.calls[0]
  const callLink =
    subdomain && lastCall?.pbxUuid && detail.calls[0]?.pbxUuid
      ? `/calls/${lastCall.pbxUuid}`
      : null

  // Last call's gcCallId for GC link is at the call level — we use the calls
  // table's pbxUuid for our own deep-link, GC card link uses gcCallId from
  // the most recent call. We don't have it here directly — use the pbxUuid
  // route to navigate inside our app.
  const phoneTail = detail.clientPhone ? `***${detail.clientPhone.slice(-4)}` : "—"

  // Stage column carries no signal when most calls precede the deal
  // (cold-prospecting funnel) — hide it instead of rendering a column of «—».
  const nullDealRatio =
    detail.calls.length > 0
      ? detail.calls.filter((c) => !c.dealId).length / detail.calls.length
      : 0
  const showStageCol = nullDealRatio < 0.5

  // Derive stage order for the Hybrid Timeline. Query doesn't expose
  // FunnelStage[] directly, so use distinct stageName values in chronological
  // order (oldest → newest) — same approach as stageJourney builder server-side.
  const stageOrderList: string[] = []
  const seenStages = new Set<string>()
  for (let i = detail.calls.length - 1; i >= 0; i--) {
    const sn = detail.calls[i]?.stageName
    if (sn && !seenStages.has(sn)) {
      seenStages.add(sn)
      stageOrderList.push(sn)
    }
  }
  const allNoDeal = detail.calls.length > 0 && nullDealRatio === 1

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-text-primary">
          {detail.clientName || `Клиент тел. ${phoneTail}`}
        </h1>
        <p className="mt-1 text-[13px] text-text-tertiary">
          gcContactId: <span className="font-mono">{gcContactId}</span> ·
          МОП: {detail.managerName ?? "—"} ·
          Без личных данных — полный профиль смотри в GC.
        </p>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-3 py-2 sm:grid-cols-4">
          <Counter label="Звонков всего" value={detail.callsCount} />
          <Counter
            label="Дозвоны (real)"
            value={detail.realCallsCount}
            sub={
              detail.callsCount > 0
                ? `${Math.round((detail.realCallsCount / detail.callsCount) * 100)}%`
                : ""
            }
          />
          <Counter
            label="Минут разговора"
            value={detail.totalTalkMinutes}
            sub="talkDuration"
          />
          <Counter
            label="Avg script score"
            value={
              detail.avgScorePct !== null
                ? `${Math.round(detail.avgScorePct * 100)}%`
                : "—"
            }
            sub={
              detail.firstCallAt
                ? `${fmtMskDate(detail.firstCallAt)} – ${fmtMskDate(detail.lastCallAt)}`
                : ""
            }
          />
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {clientLink && (
          <DeepLink href={clientLink} icon="👤" label="Клиент в GC" />
        )}
        {dealLink && <DeepLink href={dealLink} icon="💼" label="Сделка в GC" />}
        {callLink && (
          <DeepLink href={callLink} icon="🎵" label="Последний звонок" internal />
        )}
        {detail.clientPhone && (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border-default bg-surface-1 px-3 py-1.5 text-[12px] text-text-tertiary">
            📞 тел. {phoneTail}
          </span>
        )}
      </div>

      {detail.stageJourney.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Движение клиента по воронке</CardTitle>
            <CardDescription>
              Уникальные этапы которые прошёл клиент по нашим звонкам.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {detail.stageJourney.map((s, i) => (
                <span key={`stage-${i}`} className="flex items-center gap-2">
                  <span className="rounded-md bg-surface-3 px-2 py-1 text-text-secondary">
                    {s.stageName}
                    <span className="ml-1.5 text-[11px] text-text-muted">
                      {fmtMskDate(s.at)}
                    </span>
                  </span>
                  {i < detail.stageJourney.length - 1 && (
                    <span className="text-text-tertiary">→</span>
                  )}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {!allNoDeal && stageOrderList.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>📅 Звонки по этапам сделки</CardTitle>
            <CardDescription>
              Цвет = outcome, форма = callOutcome, размер = talkDuration.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CallsTimeline
              calls={detail.calls}
              stageOrderList={stageOrderList}
            />
            <StageDrillDown
              calls={detail.calls}
              stageOrderList={stageOrderList}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>История звонков ({detail.calls.length})</CardTitle>
          <CardDescription>
            Flat список без вложенности по сделкам. Этап сделки = на момент
            звонка. dealId — badge справа. Click → карточка звонка.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {nullDealRatio === 1 && detail.calls.length > 0 && (
            <div className="mb-3 rounded-md border border-border-default bg-surface-2 p-2 text-[12px] text-text-tertiary">
              Звонки до создания сделки — типично для cold-prospecting воронки.
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата (МСК)</TableHead>
                <TableHead className="text-right">duration</TableHead>
                <TableHead className="text-right">talkDuration</TableHead>
                <TableHead>МОП</TableHead>
                <TableHead>callType</TableHead>
                <TableHead className="text-right">Script score</TableHead>
                <TableHead>Outcome</TableHead>
                {showStageCol && <TableHead>Этап сделки</TableHead>}
                <TableHead className="text-right">dealId</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.calls.map((c) => {
                const stageLabel =
                  c.stageName ??
                  (c.currentStageCrmId ? `Этап #${c.currentStageCrmId}` : "—")
                return (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer hover:bg-surface-2"
                  >
                    <TableCell className="tabular-nums">
                      {c.pbxUuid ? (
                        <Link
                          href={`/calls/${c.pbxUuid}`}
                          className="hover:underline"
                        >
                          {fmtMsk(c.startStamp ?? c.createdAt)}
                        </Link>
                      ) : (
                        fmtMsk(c.startStamp ?? c.createdAt)
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-text-tertiary">
                      {fmtSeconds(c.duration)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtSeconds(c.talkDuration ?? c.userTalkTime)}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {c.managerName ?? "—"}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {c.callType ?? "—"}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${scoreColor(c.scriptScorePct)}`}
                    >
                      {c.scriptScorePct !== null
                        ? `${Math.round(c.scriptScorePct * 100)}%`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {c.outcome ?? c.callOutcome ?? "—"}
                    </TableCell>
                    {showStageCol && (
                      <TableCell className="text-[12px] text-text-secondary">
                        {stageLabel}
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      {c.dealCrmId ? (
                        <span className="inline-block rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-text-tertiary">
                          #{c.dealCrmId}
                        </span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function getMarker(outcome: string | null, callOutcome: string | null) {
  if (callOutcome === "voicemail" || callOutcome === "ivr")
    return {
      fill: "var(--text-muted)",
      stroke: "var(--text-tertiary)",
      strokeWidth: 1,
    }
  if (callOutcome === "hung_up" || callOutcome === "no_answer")
    return {
      fill: "transparent",
      stroke: "var(--text-tertiary)",
      strokeWidth: 2,
    }
  if (outcome === "closed_won")
    return {
      fill: "var(--status-green)",
      stroke: "var(--status-green)",
      strokeWidth: 1,
    }
  if (outcome === "closed_lost")
    return {
      fill: "var(--status-red)",
      stroke: "var(--status-red)",
      strokeWidth: 1,
    }
  if (outcome === "objection_unresolved")
    return {
      fill: "var(--status-amber)",
      stroke: "var(--status-amber)",
      strokeWidth: 1,
    }
  return { fill: "var(--ai-1)", stroke: "var(--ai-1)", strokeWidth: 1 }
}

function CallsTimeline({
  calls,
  stageOrderList,
}: {
  calls: ClientCallRow[]
  stageOrderList: string[]
}) {
  // Graceful degradation: if every call has NULL dealId, the timeline carries
  // no signal — let the existing flat list + Task 27 banner handle it.
  const callsWithDeal = calls.filter((c) => c.dealId)
  const callsNoDeal = calls.filter((c) => !c.dealId)
  const allNoDeal = callsWithDeal.length === 0 && callsNoDeal.length > 0
  if (allNoDeal) return null

  // Mixed case — append a "Без сделки" band at the bottom for null-stage calls.
  const hasNoDealCalls = callsNoDeal.length > 0
  const effectiveStageList = hasNoDealCalls
    ? [...stageOrderList, "Без сделки"]
    : stageOrderList
  const noDealRowIdx = effectiveStageList.indexOf("Без сделки")

  const orderIdx = (call: ClientCallRow) => {
    if (!call.dealId && hasNoDealCalls) return noDealRowIdx
    if (!call.stageName) return effectiveStageList.length
    const i = effectiveStageList.indexOf(call.stageName)
    return i === -1 ? effectiveStageList.length : i
  }

  const data = calls
    .filter((c) => c.startStamp)
    .map((c) => ({
      x: c.startStamp!.getTime(),
      y: orderIdx(c),
      size: Math.sqrt((c.talkDuration ?? 30) + 1) * 4,
      outcome: c.outcome,
      callOutcome: c.callOutcome,
      managerName: c.managerName,
      stageName: c.dealId ? c.stageName ?? "—" : "Без сделки",
      pbxUuid: c.pbxUuid,
    }))

  if (data.length === 0) return null

  // Cluster detection: row (stage) with 3+ "bad" calls
  const badPerStage = new Map<number, number>()
  for (const d of data) {
    if (d.outcome === "objection_unresolved" || d.outcome === "closed_lost") {
      badPerStage.set(d.y, (badPerStage.get(d.y) ?? 0) + 1)
    }
  }
  const clusterRows = Array.from(badPerStage.entries())
    .filter(([, n]) => n >= 3)
    .map(([y]) => y)

  return (
    <ResponsiveContainer
      width="100%"
      height={Math.max(200, effectiveStageList.length * 30 + 100)}
    >
      <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 100 }}>
        {clusterRows.map((y) => (
          <ReferenceArea
            key={`cluster-${y}`}
            y1={y - 0.4}
            y2={y + 0.4}
            fill="var(--status-amber-dim)"
            stroke="none"
          />
        ))}
        <XAxis
          dataKey="x"
          type="number"
          domain={["auto", "auto"]}
          tickFormatter={(t: number) =>
            new Date(t).toLocaleDateString("ru-RU", {
              day: "2-digit",
              month: "2-digit",
            })
          }
        />
        <YAxis
          dataKey="y"
          type="number"
          domain={[-0.5, effectiveStageList.length - 0.5]}
          ticks={effectiveStageList.map((_, i) => i)}
          tickFormatter={(i: number) => effectiveStageList[i] ?? "—"}
          width={100}
        />
        <ZAxis dataKey="size" range={[20, 200]} />
        <Tooltip />
        <Scatter
          data={data}
          fill="var(--ai-1)"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          shape={(props: any) => {
            const m = getMarker(
              props.payload.outcome,
              props.payload.callOutcome
            )
            const r = Math.sqrt((props.size ?? 50) / Math.PI)
            return (
              <circle
                cx={props.cx}
                cy={props.cy}
                r={r}
                fill={m.fill}
                stroke={m.stroke}
                strokeWidth={m.strokeWidth ?? 1}
              />
            )
          }}
        />
      </ScatterChart>
    </ResponsiveContainer>
  )
}

function StageDrillDown({
  calls,
  stageOrderList,
}: {
  calls: ClientCallRow[]
  stageOrderList: string[]
}) {
  const items = stageOrderList
    .map((stageName) => ({
      stageName,
      stageCalls: calls.filter((c) => c.stageName === stageName),
    }))
    .filter((it) => it.stageCalls.length > 0)

  if (items.length === 0) return null

  return (
    <Accordion className="mt-4">
      {items.map(({ stageName, stageCalls }) => (
        <AccordionItem key={stageName} value={stageName}>
          <AccordionTrigger>
            {stageName} ({stageCalls.length}{" "}
            {stageCalls.length === 1 ? "звонок" : "звонков"})
          </AccordionTrigger>
          <AccordionContent>
            <ul className="space-y-1 text-sm">
              {stageCalls.map((c) => (
                <li key={c.id}>
                  {c.startStamp
                    ? new Date(c.startStamp).toLocaleString("ru-RU")
                    : "—"}
                  {" · "}
                  {c.managerName ?? "—"}
                  {" · "}
                  {c.outcome ?? c.callOutcome ?? "—"}
                </li>
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}

function Counter({
  label,
  value,
  sub,
}: {
  label: string
  value: number | string
  sub?: string
}) {
  return (
    <div className="rounded-md border border-border-default bg-surface-1 p-3">
      <p className="text-[11px] text-text-tertiary">{label}</p>
      <p className="mt-1 text-[20px] font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-text-tertiary">{sub}</p>}
    </div>
  )
}

function DeepLink({
  href,
  icon,
  label,
  internal,
}: {
  href: string
  icon: string
  label: string
  internal?: boolean
}) {
  if (internal) {
    return (
      <Link
        href={href}
        className="inline-flex items-center gap-1.5 rounded-md border border-border-default bg-surface-1 px-3 py-1.5 text-[12px] text-text-secondary transition-colors hover:border-border-hover hover:text-text-primary"
      >
        <span>{icon}</span>
        <span>{label}</span>
        <span className="text-text-tertiary">→</span>
      </Link>
    )
  }
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
