interface AudioPlayerProps {
  audioUrl: string | null
}

export function AudioPlayer({ audioUrl }: AudioPlayerProps) {
  return (
    <div className="rounded-[10px] border border-border-default bg-surface-1 p-5 shadow-[var(--card-shadow)]">
      <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
        Аудио
      </h3>
      {audioUrl ? (
        <audio
          controls
          src={`/api/audio?url=${encodeURIComponent(audioUrl)}`}
          className="w-full rounded-lg"
          preload="none"
        />
      ) : (
        <div className="flex h-12 items-center justify-center rounded-lg bg-surface-2 text-[13px] text-text-tertiary">
          Аудио недоступно
        </div>
      )}
    </div>
  )
}
