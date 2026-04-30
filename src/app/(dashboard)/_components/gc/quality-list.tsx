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
import type { QualityListResult } from "@/lib/queries/quality-gc"

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

function normalizeCriticalErrors(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    if (typeof item === "string") out.push(item)
    else if (item && typeof item === "object" && "error" in item) {
      const e = (item as { error: unknown }).error
      if (typeof e === "string") out.push(e)
    }
  }
  return out
}

export function QualityListGc({
  data,
  searchParamsString,
}: {
  data: QualityListResult
  searchParamsString: string
}) {
  if (data.rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Звонки</CardTitle>
          <CardDescription>
            За выбранный период по фильтрам ничего не найдено.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Звонки{" "}
          <span className="text-text-secondary">
            ({data.total.toLocaleString("ru-RU")} всего, страница {data.page} из{" "}
            {data.pages})
          </span>
        </CardTitle>
        <CardDescription>
          Click row → карточка звонка по эталону.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Дата (МСК)</TableHead>
              <TableHead className="text-right">duration</TableHead>
              <TableHead className="text-right">talkDuration</TableHead>
              <TableHead>МОП</TableHead>
              <TableHead>Клиент</TableHead>
              <TableHead>callType</TableHead>
              <TableHead>callOutcome</TableHead>
              <TableHead className="text-right">Script score</TableHead>
              <TableHead>Critical errors</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((c) => {
              const errs = normalizeCriticalErrors(c.criticalErrors).slice(0, 2)
              const phoneTail = c.clientPhone
                ? `***${c.clientPhone.slice(-4)}`
                : "—"
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
                        {fmtMsk(c.createdAt)}
                      </Link>
                    ) : (
                      fmtMsk(c.createdAt)
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
                    {c.clientName || phoneTail}
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {c.callType ?? "—"}
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {c.callOutcome ?? "—"}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${scoreColor(c.scriptScorePct)}`}
                  >
                    {c.scriptScorePct !== null
                      ? `${Math.round(c.scriptScorePct * 100)}%`
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {errs.map((e, i) => (
                        <span
                          key={`${c.id}-err-${i}`}
                          className="rounded bg-status-red-dim px-1.5 py-0.5 text-[10px] text-status-red"
                        >
                          {e}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        {data.pages > 1 && (
          <Pagination
            page={data.page}
            pages={data.pages}
            searchParamsString={searchParamsString}
          />
        )}
      </CardContent>
    </Card>
  )
}

function Pagination({
  page,
  pages,
  searchParamsString,
}: {
  page: number
  pages: number
  searchParamsString: string
}) {
  function withPage(p: number): string {
    const params = new URLSearchParams(searchParamsString)
    params.set("page", String(p))
    return `?${params.toString()}`
  }
  const prev = page > 1 ? page - 1 : null
  const next = page < pages ? page + 1 : null
  return (
    <nav className="mt-4 flex items-center justify-between gap-3 border-t border-border-default pt-3 text-[12px] text-text-tertiary">
      <span>
        Страница {page} из {pages}
      </span>
      <div className="flex gap-2">
        {prev !== null ? (
          <Link
            href={withPage(prev)}
            scroll={false}
            className="rounded-md border border-border-default px-3 py-1 hover:border-border-hover"
          >
            ← Предыдущая
          </Link>
        ) : (
          <span className="rounded-md border border-border-default px-3 py-1 text-text-muted">
            ←
          </span>
        )}
        {next !== null ? (
          <Link
            href={withPage(next)}
            scroll={false}
            className="rounded-md border border-border-default px-3 py-1 hover:border-border-hover"
          >
            Следующая →
          </Link>
        ) : (
          <span className="rounded-md border border-border-default px-3 py-1 text-text-muted">
            →
          </span>
        )}
      </div>
    </nav>
  )
}
