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
import type { ClientDetail } from "@/lib/queries/client-detail-gc"

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
