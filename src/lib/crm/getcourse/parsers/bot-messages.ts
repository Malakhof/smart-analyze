/**
 * Parser for GetCourse bot/auto-mailing messages within a conversation.
 * Source: /chtm/app/filebrainpro/~filebrain-get-bot-messages?conversationId={X}
 *
 * Wave 1 #18 — second parallel layer of messages alongside resp model-view.
 *
 * Live response shape (verified diva 2026-04-19):
 *   { success: true, messages: [...] }
 *
 * For diva all probed conversations returned empty messages array.
 * Schema of populated messages is undocumented — parser handles common
 * field names defensively and falls back to raw JSON in `rawJson`.
 */

export interface ParsedBotMessage {
  /** External id of the bot message (string for cross-CRM consistency). */
  crmId: string | null
  /** Source bot identifier (DIVAonline_bot, botDIVAbot, etc). */
  botId: string | null
  /** Bot human name if exposed. */
  botName: string | null
  /** Plain-text content of the bot message. */
  text: string
  /** Channel ("telegram", "whatsapp", "email", "sms", "site"). */
  channel: string | null
  /** When the bot sent the message. */
  timestamp: Date | null
  /** True if the message is direction = client → bot (rare). */
  isInbound: boolean
  rawJson: unknown
}

/**
 * Parse the JSON envelope returned by the bot-messages endpoint.
 * Returns empty array on missing/empty data — safe for callers to iterate.
 */
export function parseBotMessages(json: unknown): ParsedBotMessage[] {
  if (!json || typeof json !== "object") return []
  const root = json as Record<string, unknown>
  // Some envelopes use {success, messages}; others may use {data: [...]}.
  const list = (root.messages ?? root.data ?? []) as unknown
  if (!Array.isArray(list)) return []
  return list.map(parseSingleBotMessage).filter(Boolean) as ParsedBotMessage[]
}

function parseSingleBotMessage(m: unknown): ParsedBotMessage | null {
  if (!m || typeof m !== "object") return null
  const r = m as Record<string, unknown>

  const idRaw = r.id ?? r.message_id ?? r.uuid
  const crmId =
    typeof idRaw === "number" ? String(idRaw) : typeof idRaw === "string" ? idRaw : null

  const botRaw = r.bot_id ?? r.botId ?? r.source_bot ?? null
  const botId =
    typeof botRaw === "number" ? String(botRaw) : typeof botRaw === "string" ? botRaw : null

  const text =
    typeof r.text === "string"
      ? r.text
      : typeof r.body === "string"
        ? r.body
        : typeof r.message === "string"
          ? r.message
          : ""

  return {
    crmId,
    botId,
    botName: typeof r.bot_name === "string" ? r.bot_name : null,
    text,
    channel:
      typeof r.channel === "string"
        ? r.channel
        : typeof r.transport === "string"
          ? r.transport
          : null,
    timestamp: parseBotTimestamp(r.timestamp ?? r.sent_at ?? r.created_at),
    isInbound: r.direction === "in" || r.is_inbound === true,
    rawJson: r,
  }
}

function parseBotTimestamp(value: unknown): Date | null {
  if (value == null) return null
  if (typeof value === "number") {
    // Unix seconds vs ms heuristic
    const ms = value > 1e12 ? value : value * 1000
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof value === "string") {
    const iso = value.replace(" ", "T").replace(/\+(\d{2})$/, "+$1:00")
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}
