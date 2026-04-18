/**
 * Parser for GetCourse conversation thread (inner HTML inside model-view JSON wrapper).
 * Source: /pl/tasks/resp/model-view?id={respId}&withHistory=1
 *   → JSON { data: { html: "<conversation-widget>..." } }
 *
 * Each comment block looks like:
 *   <div class="gc-comment ... comment{commentId}top gc-user-comment-{authorId}"
 *        data-timestamp="1763136937"
 *        data-level="1">
 *     ...
 *     <textarea class="edited-comment-text">текст сообщения</textarea>
 *     ...
 *     <span class="comment-transports" ...>через сайт</span>
 *   </div>
 *
 * NOTE: Some "comments" are system events ("Назначен отдел", "Открыто",
 * "Закрыто", "Взял себе", "Отказался"). We keep them with sender="system".
 */

export interface ParsedConversationMessage {
  commentId: string
  authorUserId: string | null      // GC user id (null for system events)
  text: string                      // plain text content
  timestamp: Date | null
  channel: string | null           // "через сайт", "telegram", "vk", "whatsapp", etc
  isSystem: boolean                // system event vs human message
  raw?: string                     // optional raw HTML for debugging
}

/**
 * Parse the inner HTML of conversation widget.
 * Returns ordered list of messages (oldest first by timestamp).
 */
export function parseConversationThread(innerHtml: string): ParsedConversationMessage[] {
  const messages: ParsedConversationMessage[] = []

  // Match each gc-comment block by its opening tag, then capture until the
  // closing of its top-level div. We use a non-greedy character set scoped
  // by the next opening of "gc-comment" or end of string.
  const blockRegex =
    /<div\b[^>]*class="[^"]*\bgc-comment\b[^"]*"[^>]*data-timestamp="(\d+)"[^>]*>([\s\S]*?)(?=<div\b[^>]*class="[^"]*\bgc-comment\b|<\/script>|$)/g

  let match: RegExpExecArray | null
  while ((match = blockRegex.exec(innerHtml)) !== null) {
    const timestamp = Number.parseInt(match[1], 10)
    const fullMatch = match[0]
    const block = match[2]

    const commentIdMatch = fullMatch.match(/comment(\d+)top/)
    const authorMatch = fullMatch.match(/gc-user-comment-(\d+)/)
    const text = extractCommentText(block)
    const channel = extractChannel(block)
    const isSystem = looksLikeSystemEvent(text, fullMatch)

    if (!commentIdMatch) continue

    messages.push({
      commentId: commentIdMatch[1],
      authorUserId: authorMatch ? authorMatch[1] : null,
      text,
      timestamp: timestamp ? new Date(timestamp * 1000) : null,
      channel,
      isSystem,
    })
  }

  return messages
}

/**
 * Comment text lives in either:
 *  (a) <textarea class="edited-comment-text">...</textarea>  — preferred (raw)
 *  (b) <div class="comment-text"> ... </div>                  — fallback (rendered)
 */
function extractCommentText(block: string): string {
  // Try edited-comment-text textarea first
  const ta = block.match(
    /<textarea[^>]*class="[^"]*edited-comment-text[^"]*"[^>]*>([\s\S]*?)<\/textarea>/
  )
  if (ta) {
    return decodeHtml(ta[1].trim())
  }
  // Fallback to comment-text div
  const div = block.match(
    /<div[^>]*class="[^"]*comment-text[^"]*"[^>]*>([\s\S]*?)<\/div>/
  )
  if (div) {
    return stripTags(div[1]).trim()
  }
  return ""
}

function extractChannel(block: string): string | null {
  const m = block.match(
    /<span[^>]*class="comment-transports"[^>]*>([\s\S]*?)<\/span>/
  )
  if (!m) return null
  return stripTags(m[1]).trim() || null
}

/**
 * Heuristic: GetCourse renders system events (assignments, status changes)
 * as comments without a user author and with short stylized markup.
 * If the block has no edited-comment-text textarea AND no gc-user-comment-{id},
 * it's likely a system event.
 *
 * Also flags by Russian system phrases.
 */
function looksLikeSystemEvent(text: string, block: string): boolean {
  const systemPhrases = [
    "Назначен отдел",
    "Взял себе",
    "Отказался",
    "Закрыто",
    "Открыто",
    "Передан",
    "Добавлена заметка",
    "Создан",
    "Закрыт",
    "Открыт",
  ]
  if (systemPhrases.some((p) => text.includes(p))) return true
  if (!/gc-user-comment-\d+/.test(block) && text.length < 100) return true
  return false
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

function decodeHtml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .trim()
}
