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

interface TranscriptLine {
  speaker: "operator" | "client"
  text: string
}

function parseTranscript(raw: string): TranscriptLine[] {
  const lines: TranscriptLine[] = []
  const parts = raw.split("\n").filter((l) => l.trim())

  for (const part of parts) {
    const operatorMatch = part.match(
      /^(?:Оператор|Менеджер|Operator|Manager)\s*[:]\s*(.*)/i
    )
    const clientMatch = part.match(
      /^(?:Клиент|Client|Customer)\s*[:]\s*(.*)/i
    )

    if (operatorMatch) {
      lines.push({ speaker: "operator", text: operatorMatch[1].trim() })
    } else if (clientMatch) {
      lines.push({ speaker: "client", text: clientMatch[1].trim() })
    } else {
      // Alternate speakers when no prefix detected
      if (lines.length > 0) {
        const lastSpeaker = lines[lines.length - 1].speaker
        lines.push({
          speaker: lastSpeaker === "operator" ? "client" : "operator",
          text: part.trim(),
        })
      } else {
        lines.push({ speaker: "operator", text: part.trim() })
      }
    }
  }

  return lines
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
        <source src={`/api/audio?url=${encodeURIComponent(audioUrl)}`} />
      </audio>

      {transcript && (
        <div className="mt-4">
          <h4 className="mb-2 text-[13px] font-semibold text-text-primary">
            Транскрипция
          </h4>
          <div className="space-y-2">
            {parseTranscript(transcript).map((line, idx) => (
              <div
                key={idx}
                className={`rounded-lg border-l-2 px-3 py-2 ${
                  line.speaker === "operator"
                    ? "border-l-blue-500 bg-blue-500/5"
                    : "border-l-emerald-500 bg-emerald-500/5"
                }`}
              >
                <span className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
                  {line.speaker === "operator" ? "Оператор" : "Клиент"}
                </span>
                <p className="mt-0.5 text-[13px] leading-relaxed text-text-secondary">
                  {line.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
