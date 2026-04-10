import OpenAI from "openai"

export const ai = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY!,
  baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
})

export const AI_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat"
