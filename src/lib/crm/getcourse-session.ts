import { chromium } from "playwright"

export interface GcSession {
  cookie: string
  expiresAt: Date
}

export async function getGcSession(
  accountUrl: string,
  email: string,
  password: string
): Promise<GcSession> {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(`${accountUrl}/cms/system/login`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    })
    await page.waitForTimeout(10000)

    const inputs = await page.locator('input[type="text"], input[type="password"]').all()
    if (inputs.length >= 2) await inputs[0].fill(email)
    await page.fill('input[type="password"]', password)
    await page.keyboard.press("Enter")
    await page.waitForTimeout(8000)

    if (page.url().includes("login")) {
      throw new Error("GetCourse login failed")
    }

    const cookies = await page.context().cookies()
    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ")

    return {
      cookie: cookieStr,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    }
  } finally {
    await browser.close()
  }
}
