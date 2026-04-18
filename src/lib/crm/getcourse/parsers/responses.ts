/**
 * Parser for GetCourse responses (обращения) JSON.
 * Source: /pl/tasks/resp/models-list?filter[object_type_id]=55&filter[status]={0|1}&page=N
 *
 * Each response (resp) is a conversation thread between client and managers.
 * Verified on diva.school 2026-04-19 with cookie-based session.
 */

export interface ParsedResponse {
  crmId: string                   // resp id (e.g. "320686043")
  clientUserId: string            // GC user id of the client
  managerUserId: string | null    // GC user id of currently responsible manager
  managerUserName: string | null  // human-readable manager name
  responsibleType: string | null  // e.g. "Обращения в watsapp"
  status: "open" | "closed"
  openedAt: Date | null           // ISO date with TZ
  closedAt: Date | null
  lastSnippet: string | null      // info.comment (preview of last msg)
  clientName: string | null       // info.title
  conversationId: string | null   // conversation.id if attached
  rawJson: unknown                // keep raw for debugging
}

export interface ResponsesListResponse {
  models: ParsedResponse[]
  totalCount: number              // count field — total in this status
  nextOffset: number | null       // for pagination
  pageSize: number                // typically 20
}

/**
 * Parse a single models-list JSON response from GetCourse.
 * Returns parsed list + pagination meta.
 */
export function parseResponsesList(
  json: unknown
): ResponsesListResponse {
  if (!json || typeof json !== "object") {
    return { models: [], totalCount: 0, nextOffset: null, pageSize: 0 }
  }
  const root = json as Record<string, unknown>
  const data = root.data as Record<string, unknown> | undefined
  if (!data) {
    return { models: [], totalCount: 0, nextOffset: null, pageSize: 0 }
  }

  const rawModels = (data.models ?? []) as Array<Record<string, unknown>>
  const models = rawModels.map(parseSingleResponse).filter(Boolean) as ParsedResponse[]

  return {
    models,
    totalCount: typeof data.count === "number" ? data.count : models.length,
    nextOffset:
      typeof data.nextOffset === "number" ? data.nextOffset : null,
    pageSize: models.length,
  }
}

function parseSingleResponse(m: Record<string, unknown>): ParsedResponse | null {
  const idRaw = m.id
  const id = typeof idRaw === "number" ? String(idRaw) : (idRaw as string)
  if (!id) return null

  const status = m.status === 1 ? "closed" : "open"

  const userIdRaw = m.user_id
  const clientUserId =
    typeof userIdRaw === "number" ? String(userIdRaw) : (userIdRaw as string)

  const mgrIdRaw = m.manager_user_id
  const managerUserId =
    typeof mgrIdRaw === "number"
      ? String(mgrIdRaw)
      : typeof mgrIdRaw === "string"
        ? mgrIdRaw
        : null

  const info = (m.info ?? {}) as Record<string, unknown>

  const conv = (m.conversation ?? null) as Record<string, unknown> | null
  const conversationId =
    conv && conv.id !== undefined && conv.id !== null
      ? String(conv.id)
      : null

  return {
    crmId: id,
    clientUserId: clientUserId ?? "",
    managerUserId,
    managerUserName: typeof m.manager_user_name === "string" ? m.manager_user_name : null,
    responsibleType:
      typeof m.responsible_object_title === "string"
        ? m.responsible_object_title
        : null,
    status,
    openedAt: parseGcDateTime(m.opened_at),
    closedAt: parseGcDateTime(m.closed_at_str ?? null),
    lastSnippet: typeof info.comment === "string" ? info.comment : null,
    clientName: typeof info.title === "string" ? info.title : null,
    conversationId,
    rawJson: m,
  }
}

/**
 * GetCourse opened_at format: "2026-04-19 00:02:37+03"
 * (ISO-like with TZ but with space instead of T).
 */
function parseGcDateTime(value: unknown): Date | null {
  if (!value || typeof value !== "string") return null
  // Replace space with T to make it ISO 8601 friendly
  const iso = value.replace(" ", "T").replace(/\+(\d{2})$/, "+$1:00")
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}
