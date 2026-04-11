import {
  CrmAdapter,
  CrmDeal,
  CrmFunnel,
  CrmManager,
  CrmMessage,
} from "./types"

/** Rate-limit pause: amoCRM allows 7 req/sec */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const REQUEST_DELAY_MS = 150 // ~6.6 req/sec, safe margin for 7 req/sec limit
const REQUEST_TIMEOUT_MS = 30_000
const MAX_PAGES = 200 // safety cap: 200 pages * 250 = 50,000 items
const PAGE_LIMIT = 250 // max items per page in amoCRM v4

// amoCRM special status IDs
const STATUS_WON = 142
const STATUS_LOST = 143

// -------- amoCRM response types --------

interface AmoEmbedded<T> {
  _embedded: Record<string, T[]>
  _page: number
  _page_count?: number
}

interface AmoAccount {
  id: number
  name: string
}

interface AmoPipeline {
  id: number
  name: string
  sort: number
  _embedded: {
    statuses: AmoStatus[]
  }
}

interface AmoStatus {
  id: number
  name: string
  sort: number
  pipeline_id: number
  is_editable: boolean
}

interface AmoLead {
  id: number
  name: string
  price: number | null
  status_id: number
  pipeline_id: number
  responsible_user_id: number | null
  created_at: number // unix timestamp
  closed_at: number | null // unix timestamp
  loss_reason: { id: number; name: string }[] | null
  _embedded?: {
    contacts?: AmoContact[]
  }
}

interface AmoContact {
  id: number
  name: string
}

interface AmoNote {
  id: number
  entity_id: number
  note_type: string // "common", "call_in", "call_out", "sms", etc.
  params?: {
    duration?: number
    link?: string // audio URL for calls
    phone?: string
    source?: string
    text?: string
  }
  text?: string
  created_at: number // unix timestamp
  responsible_user_id: number | null
  created_by: number
}

interface AmoEvent {
  id: string
  type: string // "incoming_call", "outgoing_call", etc.
  entity_id: number
  created_at: number
  value_after?: Array<{
    note?: {
      id?: number
    }
    link?: string
    duration?: number
    call_recording?: string
    phone?: string
    call_result?: string
    call_status?: number
  }>
}

interface AmoUser {
  id: number
  name: string
  email: string
}

export class AmoCrmAdapter implements CrmAdapter {
  private baseUrl: string
  private apiKey: string
  private lastRequestTime = 0

  constructor(subdomain: string, apiKey: string) {
    this.baseUrl = `https://${subdomain}.amocrm.ru/api/v4`
    this.apiKey = apiKey
  }

  // ------- Low-level helpers -------

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestTime
    if (elapsed < REQUEST_DELAY_MS) {
      await sleep(REQUEST_DELAY_MS - elapsed)
    }
    this.lastRequestTime = Date.now()
  }

  private async request<T>(
    path: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    await this.throttle()

    const url = new URL(`${this.baseUrl}${path}`)
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value))
      }
    }

    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS
    )

    try {
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      })

      // 204 = no content (empty list)
      if (res.status === 204) {
        return { _embedded: {} } as T
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new Error(
          `amoCRM HTTP ${res.status}: ${res.statusText} — ${body}`
        )
      }

      return (await res.json()) as T
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Fetch all pages for a list endpoint.
   * amoCRM v4 uses ?page=N&limit=250, returns _page and _page_count.
   */
  private async fetchAll<T>(
    path: string,
    embeddedKey: string,
    params: Record<string, unknown> = {}
  ): Promise<T[]> {
    const items: T[] = []

    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await this.request<AmoEmbedded<T>>(path, {
        ...params,
        page,
        limit: PAGE_LIMIT,
      })

      const embedded = res._embedded?.[embeddedKey]
      if (Array.isArray(embedded)) {
        items.push(...embedded)
      }

      // No more pages if we got fewer items than limit or no _page_count
      if (
        !Array.isArray(embedded) ||
        embedded.length < PAGE_LIMIT ||
        (res._page_count !== undefined && page >= res._page_count)
      ) {
        break
      }
    }

    return items
  }

  // ------- CrmAdapter interface -------

  async testConnection(): Promise<boolean> {
    try {
      const res = await this.request<AmoAccount>("/account")
      return !!res.id
    } catch {
      return false
    }
  }

  async getFunnels(): Promise<CrmFunnel[]> {
    const pipelines = await this.fetchAll<AmoPipeline>(
      "/leads/pipelines",
      "pipelines"
    )

    return pipelines.map((p) => ({
      crmId: String(p.id),
      name: p.name,
      stages: (p._embedded?.statuses ?? []).map((s, idx) => ({
        crmId: String(s.id),
        name: s.name,
        order: s.sort ?? idx,
      })),
    }))
  }

  async getDeals(funnelId?: string, since?: Date): Promise<CrmDeal[]> {
    const params: Record<string, unknown> = {
      with: "contacts",
    }

    if (funnelId !== undefined) {
      params["filter[pipe_id]"] = funnelId
    }

    if (since) {
      params["filter[created_at][from]"] = Math.floor(
        since.getTime() / 1000
      )
    }

    const leads = await this.fetchAll<AmoLead>("/leads", "leads", params)

    // Resolve manager names
    const uniqueUserIds = [
      ...new Set(
        leads
          .map((l) => l.responsible_user_id)
          .filter((id): id is number => id !== null)
      ),
    ]
    const userMap = await this.resolveUsers(uniqueUserIds)

    // Build stage map from pipelines
    const funnels = await this.getFunnels()
    const stageMap = new Map<
      string,
      { funnelId: string; funnelName: string; stageName: string }
    >()
    for (const f of funnels) {
      for (const s of f.stages) {
        stageMap.set(s.crmId, {
          funnelId: f.crmId,
          funnelName: f.name,
          stageName: s.name,
        })
      }
    }

    return leads.map((l) => {
      const stageInfo = stageMap.get(String(l.status_id))
      const user = l.responsible_user_id
        ? userMap.get(l.responsible_user_id)
        : null

      return {
        crmId: String(l.id),
        title: l.name ?? "",
        amount: l.price ?? null,
        status: this.mapDealStatus(l.status_id),
        managerId: l.responsible_user_id
          ? String(l.responsible_user_id)
          : null,
        managerName: user ?? null,
        funnelId: stageInfo?.funnelId ?? String(l.pipeline_id) ?? null,
        funnelName: stageInfo?.funnelName ?? null,
        stageName: stageInfo?.stageName ?? null,
        createdAt: new Date(l.created_at * 1000),
        closedAt: l.closed_at ? new Date(l.closed_at * 1000) : null,
      }
    })
  }

  async getMessages(dealCrmId: string): Promise<CrmMessage[]> {
    // Fetch notes from the lead itself (text notes, etc.)
    const leadNotes = await this.fetchAll<AmoNote>(
      `/leads/${dealCrmId}/notes`,
      "notes"
    )

    const messages: CrmMessage[] = leadNotes.map((n) => {
      const isCallIn = n.note_type === "call_in"
      const isCallOut = n.note_type === "call_out"
      const isCall = isCallIn || isCallOut
      const audioUrl = n.params?.link
      const duration = n.params?.duration
      const phone = n.params?.phone

      const content =
        n.params?.text ?? n.text ?? ""

      return {
        dealCrmId,
        sender: isCallIn
          ? ("client" as const)
          : isCallOut
            ? ("manager" as const)
            : ("system" as const),
        content,
        timestamp: new Date(n.created_at * 1000),
        isAudio: isCall && !!audioUrl,
        ...(isCall && audioUrl ? { audioUrl } : {}),
        ...(isCall && duration ? { duration } : {}),
        ...(phone ? { phone } : {}),
      }
    })

    // Fetch call notes from linked contacts (calls are attached to contacts, not leads)
    const contactCallMessages = await this.fetchContactCallNotes(dealCrmId)

    // Merge contact call messages, dedup by timestamp (within 2s tolerance)
    const existingTimestamps = new Set(
      messages
        .filter((m) => m.isAudio)
        .map((m) => m.timestamp.getTime())
    )

    for (const cm of contactCallMessages) {
      const isDuplicate = [...existingTimestamps].some(
        (t) => Math.abs(t - cm.timestamp.getTime()) < 2000
      )
      if (!isDuplicate) {
        messages.push(cm)
        existingTimestamps.add(cm.timestamp.getTime())
      }
    }

    // Also fetch call events — some calls are stored as events, not notes
    const eventMessages = await this.fetchCallEvents(dealCrmId)

    for (const em of eventMessages) {
      const isDuplicate = [...existingTimestamps].some(
        (t) => Math.abs(t - em.timestamp.getTime()) < 2000
      )
      if (!isDuplicate) {
        messages.push(em)
        existingTimestamps.add(em.timestamp.getTime())
      }
    }

    // Sort by timestamp ascending
    messages.sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    )

    return messages
  }

  /**
   * Fetch call recordings from amoCRM events API.
   * Events with type "incoming_call" or "outgoing_call" may contain
   * audio URLs and duration not present in notes.
   */
  private async fetchCallEvents(
    dealCrmId: string
  ): Promise<CrmMessage[]> {
    try {
      const events = await this.fetchAll<AmoEvent>(
        "/events",
        "events",
        {
          "filter[entity]": "lead",
          "filter[entity_id]": dealCrmId,
          "filter[type]": "incoming_call,outgoing_call",
        }
      )

      const messages: CrmMessage[] = []

      for (const event of events) {
        const isIncoming = event.type === "incoming_call"
        const valueAfter = event.value_after?.[0]

        const audioUrl =
          valueAfter?.call_recording ?? valueAfter?.link ?? undefined
        const duration = valueAfter?.duration ?? undefined
        const callResult = valueAfter?.call_result ?? ""

        messages.push({
          dealCrmId,
          sender: isIncoming
            ? ("client" as const)
            : ("manager" as const),
          content: callResult || (isIncoming ? "Входящий звонок" : "Исходящий звонок"),
          timestamp: new Date(event.created_at * 1000),
          isAudio: !!audioUrl,
          ...(audioUrl ? { audioUrl } : {}),
          ...(duration ? { duration } : {}),
        })
      }

      return messages
    } catch {
      // Events API may not be available on all amoCRM plans — graceful fallback
      return []
    }
  }

  /**
   * Fetch call notes from contacts linked to a deal.
   * In amoCRM, call recordings are attached to contacts, not leads.
   * Steps: get deal with contacts -> for each contact, fetch notes -> filter calls.
   */
  private async fetchContactCallNotes(
    dealCrmId: string
  ): Promise<CrmMessage[]> {
    try {
      // 1. Get the deal with embedded contacts
      const lead = await this.request<AmoLead>(
        `/leads/${dealCrmId}`,
        { with: "contacts" }
      )

      const contacts = lead._embedded?.contacts
      if (!contacts || contacts.length === 0) {
        return []
      }

      const messages: CrmMessage[] = []

      // 2. For each contact, fetch their notes
      for (const contact of contacts) {
        try {
          const notes = await this.fetchAll<AmoNote>(
            `/contacts/${contact.id}/notes`,
            "notes"
          )

          // 3. Filter for call notes only
          for (const n of notes) {
            const isCallIn = n.note_type === "call_in"
            const isCallOut = n.note_type === "call_out"
            if (!isCallIn && !isCallOut) continue

            const audioUrl = n.params?.link
            const duration = n.params?.duration
            const phone = n.params?.phone

            messages.push({
              dealCrmId,
              sender: isCallOut
                ? ("manager" as const)
                : ("client" as const),
              content: "", // empty, will be filled by Whisper transcription
              timestamp: new Date(n.created_at * 1000),
              isAudio: !!audioUrl,
              ...(audioUrl ? { audioUrl } : {}),
              ...(duration ? { duration } : {}),
              ...(phone ? { phone } : {}),
            })
          }
        } catch {
          // Skip this contact if notes fetch fails — don't break the whole sync
          continue
        }
      }

      return messages
    } catch {
      // Graceful fallback if contacts endpoint is unavailable
      return []
    }
  }

  async getManagers(): Promise<CrmManager[]> {
    const users = await this.fetchAll<AmoUser>("/users", "users")

    return users.map((u) => ({
      crmId: String(u.id),
      name: u.name || `User ${u.id}`,
      email: u.email || undefined,
    }))
  }

  // ------- Private helpers -------

  /**
   * Map amoCRM status_id to simplified status.
   * 142 = won (successfully closed), 143 = lost, everything else = open.
   */
  private mapDealStatus(statusId: number): "open" | "won" | "lost" {
    if (statusId === STATUS_WON) return "won"
    if (statusId === STATUS_LOST) return "lost"
    return "open"
  }

  /**
   * Resolve a list of amoCRM user IDs into a map of id -> name.
   */
  private async resolveUsers(
    userIds: number[]
  ): Promise<Map<number, string>> {
    const map = new Map<number, string>()
    if (userIds.length === 0) return map

    // Fetch all users and filter locally (amoCRM v4 doesn't support ID-array filter on /users)
    const users = await this.fetchAll<AmoUser>("/users", "users")
    const idSet = new Set(userIds)

    for (const u of users) {
      if (idSet.has(u.id)) {
        map.set(u.id, u.name || `User ${u.id}`)
      }
    }

    return map
  }
}
