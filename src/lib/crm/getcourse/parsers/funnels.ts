/**
 * Parser for GetCourse CRM funnels + stages REST API.
 * Source:
 *   POST /pl/crm/api/v1/funnel       (body: empty)        → list of funnels
 *   POST /pl/crm/api/v1/stage        (body: {funnel_id})  → list of stages for funnel
 *
 * Wave 1 #15 — funnel/stage structure for kanban-style analytics.
 *
 * Verified diva.school 2026-04-19 — 4 funnels, 11 stages on funnel 920
 * (Доска продаж: Лид → Платный → Контакт → ... → Завершен/Отменен).
 *
 * Response envelope: { status: true, data: [...], errors: [] }
 *
 * Stage `system` field: null for normal stages, 1 for "Cancelled" terminal,
 * 2 for "Completed" terminal. `position` is the column order in kanban (1..N
 * for active stages, 9999/10000 for terminal columns).
 */

export interface ParsedFunnel {
  id: string                   // funnel id, e.g. "920"
  position: number             // tab order
  name: string                 // human label, e.g. "Доска продаж"
  rawJson: unknown
}

export interface ParsedStage {
  id: string                   // stage id, e.g. "10188"
  funnelId: string             // parent funnel id
  position: number             // column order (1..N for active, 9999/10000 for terminal)
  name: string                 // human label, e.g. "Лид поступил"
  /**
   * Terminal type:
   *   null  = active stage
   *   1     = Cancelled (Lost)
   *   2     = Completed (Won)
   */
  system: 1 | 2 | null
  rawJson: unknown
}

/**
 * Convert system marker into our DealStatus enum semantic.
 */
export function stageToDealStatus(system: 1 | 2 | null): "OPEN" | "WON" | "LOST" {
  if (system === 2) return "WON"
  if (system === 1) return "LOST"
  return "OPEN"
}

export function parseFunnels(json: unknown): ParsedFunnel[] {
  if (!json || typeof json !== "object") return []
  const root = json as Record<string, unknown>
  const data = root.data
  if (!Array.isArray(data)) return []
  return data.map(parseSingleFunnel).filter(Boolean) as ParsedFunnel[]
}

function parseSingleFunnel(item: unknown): ParsedFunnel | null {
  if (!item || typeof item !== "object") return null
  const r = item as Record<string, unknown>
  const idRaw = r.id
  const id = typeof idRaw === "number" ? String(idRaw) : (typeof idRaw === "string" ? idRaw : null)
  if (!id) return null
  return {
    id,
    position: typeof r.position === "number" ? r.position : 0,
    name: typeof r.name === "string" ? r.name : `Funnel ${id}`,
    rawJson: r,
  }
}

export function parseStages(json: unknown, funnelId: string): ParsedStage[] {
  if (!json || typeof json !== "object") return []
  const root = json as Record<string, unknown>
  const data = root.data
  if (!Array.isArray(data)) return []
  return data
    .map((it) => parseSingleStage(it, funnelId))
    .filter(Boolean) as ParsedStage[]
}

function parseSingleStage(item: unknown, funnelId: string): ParsedStage | null {
  if (!item || typeof item !== "object") return null
  const r = item as Record<string, unknown>
  const idRaw = r.id
  const id = typeof idRaw === "number" ? String(idRaw) : (typeof idRaw === "string" ? idRaw : null)
  if (!id) return null

  const sysRaw = r.system
  const system: 1 | 2 | null = sysRaw === 1 ? 1 : sysRaw === 2 ? 2 : null

  return {
    id,
    funnelId,
    position: typeof r.position === "number" ? r.position : 0,
    name: typeof r.name === "string" ? r.name : `Stage ${id}`,
    system,
    rawJson: r,
  }
}
