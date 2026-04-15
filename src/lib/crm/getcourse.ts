import type { CrmAdapter, CrmDeal, CrmFunnel, CrmManager, CrmMessage } from "./types"
import { fetchGcCalls, fetchGcCallDetail, fetchGcUsers } from "./getcourse-parser"

export class GetCourseAdapter implements CrmAdapter {
  private accountUrl: string
  private cookie: string

  constructor(accountUrl: string, cookie: string) {
    this.accountUrl = accountUrl
    this.cookie = cookie
  }

  async testConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.accountUrl}/pl/user/contact/index`, {
        headers: { Cookie: this.cookie },
      })
      return res.ok && !res.url.includes("login")
    } catch {
      return false
    }
  }

  async getFunnels(): Promise<CrmFunnel[]> {
    return [{
      crmId: "gc-orders",
      name: "Заказы GetCourse",
      stages: [
        { crmId: "new", name: "Новый", order: 0 },
        { crmId: "in_work", name: "В работе", order: 1 },
        { crmId: "payment_waiting", name: "Ожидает оплаты", order: 2 },
        { crmId: "payed", name: "Оплачен", order: 3 },
        { crmId: "cancelled", name: "Отменён", order: 4 },
      ],
    }]
  }

  async getDeals(_funnelId?: string, _since?: Date): Promise<CrmDeal[]> {
    const calls = await fetchGcCalls(this.accountUrl, this.cookie)
    return calls.map((c) => ({
      crmId: c.id,
      title: c.subject || `Звонок ${c.id}`,
      amount: null,
      status: "open" as const,
      managerId: null,
      managerName: c.managerName || null,
      funnelId: "gc-orders",
      funnelName: "Заказы GetCourse",
      stageName: null,
      createdAt: new Date(c.date || Date.now()),
      closedAt: null,
    }))
  }

  async getMessages(dealCrmId: string): Promise<CrmMessage[]> {
    const detail = await fetchGcCallDetail(this.accountUrl, this.cookie, dealCrmId)
    const messages: CrmMessage[] = []
    if (detail.transcription) {
      messages.push({
        dealCrmId,
        sender: "manager",
        content: detail.transcription,
        timestamp: new Date(),
        isAudio: !!detail.audioUrl,
        ...(detail.audioUrl ? { audioUrl: detail.audioUrl } : {}),
      })
    }
    return messages
  }

  async getManagers(): Promise<CrmManager[]> {
    const users = await fetchGcUsers(this.accountUrl, this.cookie)
    return users
      .filter((u) => u.type === "admin" || u.type === "administrator")
      .map((u) => ({
        crmId: u.id,
        name: u.name || u.email,
        email: u.email,
      }))
  }
}
