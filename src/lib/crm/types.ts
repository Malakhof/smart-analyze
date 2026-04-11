export interface CrmDeal {
  crmId: string
  title: string
  amount: number | null
  status: "open" | "won" | "lost"
  managerId: string | null
  managerName: string | null
  funnelId: string | null
  funnelName: string | null
  stageName: string | null
  createdAt: Date
  closedAt: Date | null
}

export interface CrmMessage {
  dealCrmId: string
  sender: "manager" | "client" | "system"
  content: string
  timestamp: Date
  isAudio: boolean
  audioUrl?: string
  duration?: number // seconds
  phone?: string
}

export interface CrmManager {
  crmId: string
  name: string
  email?: string
}

export interface CrmFunnel {
  crmId: string
  name: string
  stages: { crmId: string; name: string; order: number }[]
}

export interface CrmAdapter {
  testConnection(): Promise<boolean>
  getFunnels(): Promise<CrmFunnel[]>
  getDeals(funnelId?: string, since?: Date): Promise<CrmDeal[]>
  getMessages(dealCrmId: string): Promise<CrmMessage[]>
  getManagers(): Promise<CrmManager[]>
}
