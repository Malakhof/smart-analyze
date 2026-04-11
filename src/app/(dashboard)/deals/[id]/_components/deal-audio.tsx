interface DealAudioProps {
  audioUrl: string
  transcript?: string
  duration?: number
}

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

export function DealAudio({ audioUrl, transcript, duration }: DealAudioProps) {
  return (
    <div className="rounded-[10px] border border-border-default bg-surface-1 p-6 shadow-[var(--card-shadow)]">
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-status-green-dim text-[11px] font-bold text-status-green">
          🎙
        </div>
        <span className="text-[15px] font-bold">Запись звонка</span>
        {duration != null && (
          <span className="text-[12px] text-text-tertiary">
            {fmtDuration(duration)}
          </span>
        )}
      </div>

      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio controls className="w-full" preload="metadata">
        <source src={audioUrl} />
      </audio>

      {transcript && (
        <div className="mt-4">
          <h4 className="mb-2 text-[13px] font-semibold text-text-primary">
            Транскрипция
          </h4>
          <p className="text-[13px] leading-relaxed text-text-secondary whitespace-pre-wrap">
            {transcript}
          </p>
        </div>
      )}
    </div>
  )
}
