"use client"

import { useState } from "react"
import { DealAudio } from "./deal-audio"
import type { DealDetailMessage } from "@/lib/queries/deal-detail"

interface DealAudioListProps {
  audios: DealDetailMessage[]
  defaultVisible?: number
}

export function DealAudioList({
  audios,
  defaultVisible = 5,
}: DealAudioListProps) {
  const [showAll, setShowAll] = useState(false)
  if (audios.length === 0) return null

  const visible = showAll ? audios : audios.slice(0, defaultVisible)
  const hidden = audios.length - visible.length
  const transcripts = audios.filter(
    (m) => (m.content?.trim().length ?? 0) > 50
  ).length

  return (
    <div className="space-y-3">
      {!showAll && audios.length > defaultVisible && (
        <div className="rounded-[8px] border border-border-default bg-surface-1 px-3 py-2 text-[11px] text-text-tertiary">
          Показано {defaultVisible} последних из {audios.length} звонков (
          {transcripts} с расшифровкой). Старые записи провайдер CRM
          (Sipuni/Gravitel) обычно не отдаёт — ниже только свежие.
        </div>
      )}
      {visible.map((m) => (
        <DealAudio
          key={m.id}
          audioUrl={m.audioUrl!}
          transcript={m.content || undefined}
          duration={m.duration ?? undefined}
          recordedAt={new Date(m.timestamp)}
        />
      ))}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="block w-full rounded-[6px] border border-border-default bg-surface-2 py-2 text-center text-[12px] text-text-secondary transition-colors hover:bg-surface-3"
        >
          Показать ещё {hidden}{" "}
          {hidden === 1 ? "запись" : hidden < 5 ? "записи" : "записей"}
          <span className="ml-1 text-text-tertiary">
            (старые — могут не играть, транскрипты могут быть)
          </span>
        </button>
      )}
      {showAll && audios.length > defaultVisible && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="block w-full rounded-[6px] border border-border-default bg-surface-2 py-2 text-center text-[12px] text-text-secondary transition-colors hover:bg-surface-3"
        >
          Свернуть до {defaultVisible} последних
        </button>
      )}
    </div>
  )
}
