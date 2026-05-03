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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import type { ManagerListRow } from "@/lib/queries/managers-gc"

function scoreColor(pct: number | null): string {
  if (pct === null) return "text-text-tertiary"
  if (pct >= 0.7) return "text-status-green"
  if (pct >= 0.5) return "text-status-amber"
  return "text-status-red"
}

function ManagerRowsTable({ rows }: { rows: ManagerListRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="px-1 py-3 text-[13px] text-text-tertiary">
        Нет менеджеров в этой группе за период.
      </p>
    )
  }
  return (
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
  )
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

  // Splits per anketa §2.1: МОПы / Первая линия / Кураторы.
  // Curators are mutually exclusive — they're never counted as МОП even if
  // they happen to also have first-line calls in this period.
  const curators = rows.filter((m) => m.isCurator)
  const firstLine = rows.filter((m) => !m.isCurator && m.isFirstLine)
  const sales = rows.filter((m) => !m.isCurator && !m.isFirstLine)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Менеджеры</CardTitle>
        <CardDescription>
          Три группы — МОПы, первая линия и кураторы. Click МОПа → drill-down с паттернами.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="sales">
          <TabsList>
            <TabsTrigger value="sales">МОПы ({sales.length})</TabsTrigger>
            <TabsTrigger value="first-line">
              Первая линия ({firstLine.length})
            </TabsTrigger>
            <TabsTrigger value="curators">
              Кураторы ({curators.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="sales">
            <ManagerRowsTable rows={sales} />
          </TabsContent>
          <TabsContent value="first-line">
            <ManagerRowsTable rows={firstLine} />
          </TabsContent>
          <TabsContent value="curators">
            <ManagerRowsTable rows={curators} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
