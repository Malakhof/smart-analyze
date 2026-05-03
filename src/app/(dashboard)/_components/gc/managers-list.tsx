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
import type { ManagerListRow } from "@/lib/queries/managers-gc"

function scoreColor(pct: number | null): string {
  if (pct === null) return "text-text-tertiary"
  if (pct >= 0.7) return "text-status-green"
  if (pct >= 0.5) return "text-status-amber"
  return "text-status-red"
}

export function ManagersListGc({ rows }: { rows: ManagerListRow[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Менеджеры</CardTitle>
          <CardDescription>Нет менеджеров с звонками за период.</CardDescription>
        </CardHeader>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Менеджеры</CardTitle>
        <CardDescription>
          Кураторы исключены. Click МОПа → drill-down с паттернами.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>МОП</TableHead>
              <TableHead className="text-right">Звонков</TableHead>
              <TableHead className="text-right">Дозвоны</TableHead>
              <TableHead className="text-right">Script score</TableHead>
              <TableHead className="text-right">Phrase used</TableHead>
              <TableHead className="text-right">
                <span title="Звонок попал в pipeline gap — onPBX ещё не отдал аудио или был sync issue. Это не оценка МОПа.">
                  Не дотянулось
                </span>
              </TableHead>
              <TableHead>Топ-1 ошибка</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.managerId}>
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
                <TableCell className="text-right tabular-nums">
                  {r.real}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${scoreColor(r.scriptScorePctAvg)}`}
                >
                  {r.scriptScorePctAvg !== null
                    ? `${Math.round(r.scriptScorePctAvg * 100)}%`
                    : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.phraseUsedAvg !== null
                    ? `${r.phraseUsedAvg.toFixed(1)} / 12`
                    : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.pipelineGap > 0 ? (
                    <span
                      className={
                        r.pipelineGapPct > 0.1
                          ? "text-status-red"
                          : "text-status-amber"
                      }
                    >
                      {r.pipelineGap} ({Math.round(r.pipelineGapPct * 100)}%)
                    </span>
                  ) : (
                    <span className="text-text-muted">0</span>
                  )}
                </TableCell>
                <TableCell>
                  {r.topCriticalError ? (
                    <span className="rounded bg-status-red-dim px-2 py-0.5 text-[11px] text-status-red">
                      {r.topCriticalError}
                    </span>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
