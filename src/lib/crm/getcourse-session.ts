// Playwright is loaded dynamically and untyped here — it's only available
// in the mcr.microsoft.com/playwright Docker image used by
// scripts/refresh-gc-cookie.ts, not in the main app's production build.
// This avoids a TS2307 build-time error when the package isn't installed
// in the Next.js builder image.

export interface GcSession {
  cookie: string
  expiresAt: Date
}

interface PwBrowser {
  newPage(): Promise<PwPage>
  close(): Promise<void>
}
interface PwPage {
  goto(url: string, opts: { waitUntil: string; timeout: number }): Promise<unknown>
  waitForTimeout(ms: number): Promise<void>
  locator(selector: string): { all(): Promise<{ fill(v: string): Promise<void> }[]> }
  fill(selector: string, value: string): Promise<void>
  keyboard: { press(key: string): Promise<void> }
  url(): string
  context(): { cookies(): Promise<{ name: string; value: string }[]> }
}

export async function getGcSession(
  accountUrl: string,
  email: string,
  password: string
): Promise<GcSession> {
  // String constant indirection prevents TS2307 when playwright isn't installed
  // in the production build image — module is resolved at runtime only.
  const moduleName = "playwright"
  const playwright = (await import(moduleName).catch(() => {
    throw new Error(
      "Playwright not installed. Run from mcr.microsoft.com/playwright image (see scripts/refresh-gc-cookie.ts header)."
    )
  })) as { chromium: { launch(opts: { headless: boolean }): Promise<PwBrowser> } }

  const browser = await playwright.chromium.launch({ headless: true })
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
