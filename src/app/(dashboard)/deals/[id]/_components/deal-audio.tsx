"use client"

import { useState } from "react"

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

  // PRIORITY 1: Whisper stereo-split format — [МЕНЕДЖЕР MM:SS] text or [КЛИЕНТ MM:SS] text
  // Markers can appear inline (not necessarily at line start), so we split by regex.
  const whisperRegex = /\[(МЕНЕДЖЕР|КЛИЕНТ)\s+\d+:\d+\]\s*/g
  if (whisperRegex.test(raw)) {
    const parts = raw.split(/\[(МЕНЕДЖЕР|КЛИЕНТ)\s+\d+:\d+\]\s*/)
    // parts is like ["", "МЕНЕДЖЕР", "first text", "КЛИЕНТ", "second text", ...]
    for (let i = 1; i < parts.length; i += 2) {
      const role = parts[i] as "МЕНЕДЖЕР" | "КЛИЕНТ"
      const text = (parts[i + 1] ?? "").trim()
      if (!text) continue
      lines.push({
        speaker: role === "МЕНЕДЖЕР" ? "operator" : "client",
        text,
      })
    }
    if (lines.length > 0) return lines
  }

  // PRIORITY 2: Legacy "Оператор: ... Клиент: ..." line-prefixed format
  const rawLines = raw.split("\n").filter((l) => l.trim())
  const hasPrefixes = rawLines.some((l) =>
    /^(?:Оператор|Менеджер|Operator|Manager|Клиент|Client|Customer)\s*[:]/i.test(l)
  )

  if (hasPrefixes) {
    for (const part of rawLines) {
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
      } else if (lines.length > 0) {
        lines[lines.length - 1].text += " " + part.trim()
      } else {
        lines.push({ speaker: "operator", text: part.trim() })
      }
    }
    return lines
  }

  // No prefixes — split into sentences and assign by question/answer heuristic.
  // Operator asks questions ("?"), client gives short answers.
  // Group consecutive sentences: accumulate into operator until "?" is found,
  // then switch to client until next question sentence appears.
  const sentences = raw.match(/[^.!?]*[.!?]+/g)
  if (!sentences || sentences.length === 0) {
    if (raw.trim()) {
      lines.push({ speaker: "operator", text: raw.trim() })
    }
    return lines
  }

  let speaker: "operator" | "client" = "operator"
  let buffer = ""

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i].trim()
    if (!s) continue

    const isQuestion = s.endsWith("?")

    if (speaker === "operator") {
      // Accumulate operator text. Flush when we hit a "?" and next sentence is not a "?"
      buffer += (buffer ? " " : "") + s
      if (isQuestion) {
        // Check if next sentence is also a question — if so, keep accumulating
        const next = i + 1 < sentences.length ? sentences[i + 1].trim() : ""
        const nextIsQuestion = next.endsWith("?")
        if (!nextIsQuestion) {
          lines.push({ speaker: "operator", text: buffer.trim() })
          buffer = ""
          speaker = "client"
        }
      }
    } else {
      // Client mode: accumulate until a question sentence appears
      if (isQuestion) {
        // This question belongs to operator — flush client first
        if (buffer.trim()) {
          lines.push({ speaker: "client", text: buffer.trim() })
        }
        buffer = s
        speaker = "operator"
        // Check if next is also a question
        const next = i + 1 < sentences.length ? sentences[i + 1].trim() : ""
        const nextIsQuestion = next.endsWith("?")
        if (!nextIsQuestion) {
          lines.push({ speaker: "operator", text: buffer.trim() })
          buffer = ""
          speaker = "client"
        }
      } else {
        buffer += (buffer ? " " : "") + s
      }
    }
  }

  // Flush remaining buffer
  if (buffer.trim()) {
    lines.push({ speaker, text: buffer.trim() })
  }

  return lines
}

export function DealAudio({ audioUrl, transcript, duration }: DealAudioProps) {
  const [error, setError] = useState<string | null>(null)
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

      {error ? (
        <div className="rounded-[6px] border border-status-amber/40 bg-status-amber-dim/20 px-3 py-2 text-[12px] text-status-amber">
          ⚠ Не удалось загрузить запись: {error}
        </div>
      ) : (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio
          controls
          className="w-full rounded-lg"
          src={`/api/audio?url=${encodeURIComponent(audioUrl)}`}
          preload="none"
          onError={(e) => {
            const a = e.currentTarget
            const code = a.error?.code
            const map: Record<number, string> = {
              1: "Загрузка прервана",
              2: "Сетевая ошибка",
              3: "Ошибка декодирования",
              4: "Источник недоступен (URL заблокирован или формат не поддерживается)",
            }
            setError(code ? map[code] ?? `code=${code}` : "неизвестная ошибка")
          }}
        />
      )}

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
