"use client"

import { useRouter } from "next/navigation"

function scoreColor(score: number): string {
  if (score >= 80) return "text-status-green"
  if (score >= 50) return "text-status-amber"
  return "text-status-red"
}

function scoreBg(score: number): string {
  if (score >= 80) return "bg-status-green"
  if (score >= 50) return "bg-status-amber"
  return "bg-status-red"
}

const AVATAR_CLASSES = [
  "bg-gradient-to-br from-ai-1 to-ai-2",
  "bg-gradient-to-br from-[#EC4899] to-ai-1",
  "bg-gradient-to-br from-status-amber to-[#EF4444]",
  "bg-surface-4 !text-text-tertiary",
]

function getInitials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

interface ManagerRow {
  id: string
  name: string
  callCount: number
  avgScore: number
  bestScore: number
  worstScore: number
  criticalMisses: number
}

interface QcManagerTableProps {
  managers: ManagerRow[]
}

export function QcManagerTable({ managers }: QcManagerTableProps) {
  const router = useRouter()

  return (
    <div className="overflow-hidden rounded-[10px] border border-border-default bg-surface-1 shadow-[var(--card-shadow)]">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {[
              "Менеджер",
              "Звонков",
              "Средний балл",
              "Лучший",
              "Худший",
              "Критичные пропуски",
            ].map((h) => (
              <th
                key={h}
                className="border-b border-border-default px-[18px] py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {managers.map((m, i) => (
            <tr
              key={m.id}
              onClick={() => router.push(`/quality/manager/${m.id}`)}
              className="cursor-pointer transition-colors duration-100 hover:bg-surface-2 [&:not(:last-child)>td]:border-b [&:not(:last-child)>td]:border-border-default"
            >
              <td className="px-[18px] py-3 text-[14px]">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white ${AVATAR_CLASSES[i % AVATAR_CLASSES.length]}`}
                  >
                    {getInitials(m.name)}
                  </div>
                  <span className="text-[13px] font-medium">{m.name}</span>
                </div>
              </td>
              <td className="px-[18px] py-3 text-[14px]">{m.callCount}</td>
              <td className="px-[18px] py-3 text-[14px]">
                {m.avgScore > 0 ? (
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-3">
                      <div
                        className={`h-full rounded-full ${scoreBg(m.avgScore)}`}
                        style={{ width: `${Math.min(100, m.avgScore)}%` }}
                      />
                    </div>
                    <span className={`font-semibold ${scoreColor(m.avgScore)}`}>
                      {Math.round(m.avgScore)}%
                    </span>
                  </div>
                ) : (
                  <span className="text-[12px] text-text-tertiary">Не оценен</span>
                )}
              </td>
              <td className="px-[18px] py-3 text-[14px] text-status-green">
                {m.bestScore > 0 ? Math.round(m.bestScore) + "%" : <span className="text-[12px] text-text-tertiary">—</span>}
              </td>
              <td className="px-[18px] py-3 text-[14px] text-status-red">
                {m.worstScore > 0 ? Math.round(m.worstScore) + "%" : <span className="text-[12px] text-text-tertiary">—</span>}
              </td>
              <td className="px-[18px] py-3 text-[14px]">
                {m.criticalMisses > 0 ? (
                  <span className="font-semibold text-status-red">
                    {m.criticalMisses}
                  </span>
                ) : (
                  <span className="text-text-tertiary">0</span>
                )}
              </td>
            </tr>
          ))}
          {managers.length === 0 && (
            <tr>
              <td
                colSpan={6}
                className="px-[18px] py-8 text-center text-[13px] text-text-tertiary"
              >
                Нет данных по менеджерам
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
