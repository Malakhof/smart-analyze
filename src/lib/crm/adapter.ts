import { CrmAdapter } from "./types"
import { Bitrix24Adapter } from "./bitrix24"
import { AmoCrmAdapter } from "./amocrm"
import { GetCourseAdapter } from "./getcourse"

export function createCrmAdapter(config: {
  provider: string
  webhookUrl?: string | null
  subdomain?: string | null
  apiKey?: string | null
  gcCookie?: string | null
}): CrmAdapter {
  switch (config.provider) {
    case "BITRIX24":
      if (!config.webhookUrl) throw new Error("Bitrix24 webhook URL required")
      return new Bitrix24Adapter(config.webhookUrl)
    case "AMOCRM":
      if (!config.subdomain || !config.apiKey) throw new Error("amoCRM subdomain and API key required")
      return new AmoCrmAdapter(config.subdomain, config.apiKey)
    case "GETCOURSE":
      if (!config.gcCookie) throw new Error("GetCourse session cookie required")
      return new GetCourseAdapter(
        `https://${config.subdomain}.getcourse.ru`,
        config.gcCookie
      )
    default:
      throw new Error(`Unknown CRM provider: ${config.provider}`)
  }
}
