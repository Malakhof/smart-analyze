import { CrmAdapter } from "./types"
import { Bitrix24Adapter } from "./bitrix24"
import { AmoCrmAdapter } from "./amocrm"

export function createCrmAdapter(config: {
  provider: string
  webhookUrl?: string | null
  subdomain?: string | null
  apiKey?: string | null
}): CrmAdapter {
  switch (config.provider) {
    case "BITRIX24":
      if (!config.webhookUrl) throw new Error("Bitrix24 webhook URL required")
      return new Bitrix24Adapter(config.webhookUrl)
    case "AMOCRM":
      if (!config.subdomain || !config.apiKey) throw new Error("amoCRM subdomain and API key required")
      return new AmoCrmAdapter(config.subdomain, config.apiKey)
    default:
      throw new Error(`Unknown CRM provider: ${config.provider}`)
  }
}
