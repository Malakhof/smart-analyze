import {
  CrmAdapter,
  CrmDeal,
  CrmFunnel,
  CrmManager,
  CrmMessage,
  CrmTask,
} from "./types"

/** Rate-limit pause: Bitrix24 webhooks allow ~2 req/sec */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const REQUEST_DELAY_MS = 550 // ~1.8 req/sec, safe margin for 2 req/sec limit
const REQUEST_TIMEOUT_MS = 30_000
const MAX_PAGES = 200 // safety cap: 200 pages * 50 = 10,000 items

interface BitrixResponse<T = unknown> {
  result: T
  total?: number
  next?: number
  error?: string
  error_description?: string
}

interface BitrixDeal {
  ID: string
  TITLE: string
  OPPORTUNITY: string | null
  STAGE_ID: string
  CATEGORY_ID: string
  ASSIGNED_BY_ID: string
  DATE_CREATE: string
  CLOSEDATE: string | null
  CONTACT_ID: string | null
}

interface BitrixCategory {
  ID: string
  NAME: string
}

interface BitrixStage {
  STATUS_ID: string
  NAME: string
  SORT: string
}

interface BitrixUser {
  ID: string
  NAME: string
  LAST_NAME: string
  EMAIL: string
}

interface BitrixActivity {
  ID: string
  OWNER_ID: string
  OWNER_TYPE_ID: string
  TYPE_ID: string // 1=email, 2=call, 3=task, 6=sms
  DIRECTION: string // 1=incoming, 2=outgoing
  SUBJECT: string
  DESCRIPTION: string
  CREATED: string
  RESPONSIBLE_ID: string
  STORAGE_ELEMENT_IDS?: string[]
  FILES?: Array<{ url: string }>
  SETTINGS?: {
    DURATION?: number
    RECORD_URL?: string
  }
}

interface BitrixTimelineComment {
  ID: string
  ENTITY_ID: string
  COMMENT: string
  CREATED: string
  AUTHOR_ID: string
}

export class Bitrix24Adapter implements CrmAdapter {
  private baseUrl: string
  private lastRequestTime = 0

  constructor(webhookUrl: string) {
    // Normalize: strip trailing slash
    this.baseUrl = webhookUrl.replace(/\/+$/, "")
  }

  // ------- Low-level helpers -------

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestTime
    if (elapsed < REQUEST_DELAY_MS) {
      await sleep(REQUEST_DELAY_MS - elapsed)
    }
    this.lastRequestTime = Date.now()
  }

  private async call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<BitrixResponse<T>> {
    await this.throttle()

    const url = `${this.baseUrl}/${method}`
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS
    )

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: controller.signal,
      })

      if (!res.ok) {
        throw new Error(
          `Bitrix24 HTTP ${res.status}: ${res.statusText}`
        )
      }

      const data = (await res.json()) as BitrixResponse<T>

      if (data.error) {
        throw new Error(
          `Bitrix24 API error [${data.error}]: ${data.error_description ?? ""}`
        )
      }

      return data
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Fetch all pages for a list method.
   * Bitrix24 returns max 50 items per page; `next` field indicates offset.
   */
  private async fetchAll<T>(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<T[]> {
    const items: T[] = []
    let start = 0

    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await this.call<T[]>(method, { ...params, start })

      if (Array.isArray(res.result)) {
        items.push(...res.result)
      }

      if (res.next === undefined || res.next === null) break
      start = res.next
    }

    return items
  }

  // ------- CrmAdapter interface -------

  async testConnection(): Promise<boolean> {
    try {
      const res = await this.call<BitrixUser[]>("user.current")
      return !!res.result
    } catch {
      return false
    }
  }

  async getFunnels(): Promise<CrmFunnel[]> {
    // Fetch categories (funnels)
    const categories = await this.fetchAll<BitrixCategory>(
      "crm.dealcategory.list"
    )

    // Always include the default funnel (category 0)
    const allCategories: BitrixCategory[] = [
      { ID: "0", NAME: "General" },
      ...categories,
    ]

    const funnels: CrmFunnel[] = []

    for (const cat of allCategories) {
      const stages = await this.fetchAll<BitrixStage>(
        "crm.dealcategory.stage.list",
        { id: cat.ID }
      )

      funnels.push({
        crmId: cat.ID,
        name: cat.NAME,
        stages: stages.map((s, idx) => ({
          crmId: s.STATUS_ID,
          name: s.NAME,
          order: parseInt(s.SORT, 10) || idx,
        })),
      })
    }

    return funnels
  }

  async getDeals(funnelId?: string, since?: Date): Promise<CrmDeal[]> {
    const filter: Record<string, unknown> = {}
    if (funnelId !== undefined) {
      filter["CATEGORY_ID"] = funnelId
    }
    if (since) {
      filter[">DATE_CREATE"] = since.toISOString()
    }

    const deals = await this.fetchAll<BitrixDeal>("crm.deal.list", {
      filter,
      select: [
        "ID",
        "TITLE",
        "OPPORTUNITY",
        "STAGE_ID",
        "CATEGORY_ID",
        "ASSIGNED_BY_ID",
        "DATE_CREATE",
        "CLOSEDATE",
      ],
    })

    // We need manager names — batch-resolve unique user IDs
    const uniqueUserIds = [
      ...new Set(deals.map((d) => d.ASSIGNED_BY_ID).filter(Boolean)),
    ]
    const userMap = await this.resolveUsers(uniqueUserIds)

    // Resolve stage names from funnels cache
    const funnels = await this.getFunnels()
    const stageMap = new Map<string, { funnelId: string; funnelName: string; stageName: string }>()
    for (const f of funnels) {
      for (const s of f.stages) {
        stageMap.set(s.crmId, {
          funnelId: f.crmId,
          funnelName: f.name,
          stageName: s.name,
        })
      }
    }

    return deals.map((d) => {
      const stageInfo = stageMap.get(d.STAGE_ID)
      const user = userMap.get(d.ASSIGNED_BY_ID)

      return {
        crmId: d.ID,
        title: d.TITLE ?? "",
        amount: d.OPPORTUNITY ? parseFloat(d.OPPORTUNITY) : null,
        status: this.mapDealStatus(d.STAGE_ID),
        managerId: d.ASSIGNED_BY_ID ?? null,
        managerName: user ?? null,
        funnelId: stageInfo?.funnelId ?? d.CATEGORY_ID ?? null,
        funnelName: stageInfo?.funnelName ?? null,
        stageName: stageInfo?.stageName ?? null,
        stageCrmId: null,
        createdAt: new Date(d.DATE_CREATE),
        closedAt: d.CLOSEDATE ? new Date(d.CLOSEDATE) : null,
      }
    })
  }

  async getMessages(dealCrmId: string): Promise<CrmMessage[]> {
    const messages: CrmMessage[] = []

    // 1. Timeline comments
    const comments = await this.fetchAll<BitrixTimelineComment>(
      "crm.timeline.comment.list",
      {
        filter: { ENTITY_ID: dealCrmId, ENTITY_TYPE: "deal" },
      }
    )

    for (const c of comments) {
      messages.push({
        dealCrmId,
        sender: "system",
        content: this.stripHtml(c.COMMENT),
        timestamp: new Date(c.CREATED),
        isAudio: false,
      })
    }

    // 2. Activities (calls, emails, messages)
    const activities = await this.fetchAll<BitrixActivity>(
      "crm.activity.list",
      {
        filter: {
          OWNER_ID: dealCrmId,
          OWNER_TYPE_ID: 2, // 2 = deal
        },
      }
    )

    for (const act of activities) {
      const isCall = act.TYPE_ID === "2"
      const isIncoming = act.DIRECTION === "1"
      const recordUrl = act.SETTINGS?.RECORD_URL
      const duration = act.SETTINGS?.DURATION

      messages.push({
        dealCrmId,
        sender: isIncoming ? "client" : "manager",
        content:
          act.DESCRIPTION
            ? this.stripHtml(act.DESCRIPTION)
            : act.SUBJECT ?? "",
        timestamp: new Date(act.CREATED),
        isAudio: isCall && !!recordUrl,
        ...(isCall && recordUrl ? { audioUrl: recordUrl } : {}),
        ...(isCall && duration ? { duration } : {}),
      })
    }

    // Sort by timestamp ascending
    messages.sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    )

    return messages
  }

  async getManagers(): Promise<CrmManager[]> {
    const users = await this.fetchAll<BitrixUser>("user.get", {
      filter: { ACTIVE: true },
    })

    return users.map((u) => ({
      crmId: u.ID,
      name: [u.NAME, u.LAST_NAME].filter(Boolean).join(" ").trim() || `User ${u.ID}`,
      email: u.EMAIL || undefined,
    }))
  }

  async getTasks(): Promise<CrmTask[]> {
    // TODO: Task #9 (B24 pre-Phase 1) — real implementation pending.
    return []
  }

  // ------- Private helpers -------

  /**
   * Map Bitrix24 stage ID to simplified status.
   * Convention: stage IDs ending with ":WON" or equal to "WON" mean won,
   * ":LOSE" or "LOSE" mean lost, everything else is open.
   */
  private mapDealStatus(stageId: string): "open" | "won" | "lost" {
    const upper = (stageId ?? "").toUpperCase()
    if (upper === "WON" || upper.endsWith(":WON")) return "won"
    if (upper === "LOSE" || upper.endsWith(":LOSE")) return "lost"
    return "open"
  }

  /**
   * Resolve a list of Bitrix user IDs into a map of id -> full name.
   */
  private async resolveUsers(
    userIds: string[]
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    if (userIds.length === 0) return map

    // Bitrix user.get supports filtering by ID array
    const users = await this.fetchAll<BitrixUser>("user.get", {
      filter: { ID: userIds },
    })

    for (const u of users) {
      const name =
        [u.NAME, u.LAST_NAME].filter(Boolean).join(" ").trim() ||
        `User ${u.ID}`
      map.set(u.ID, name)
    }

    return map
  }

  /** Strip basic HTML tags from Bitrix text fields */
  private stripHtml(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .trim()
  }
}
