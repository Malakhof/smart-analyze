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
  newContext(opts?: { viewport?: { width: number; height: number } }): Promise<PwContext>
  close(): Promise<void>
}
interface PwContext {
  newPage(): Promise<PwPage>
  cookies(): Promise<{ name: string; value: string }[]>
}
interface PwLocator {
  fill(value: string, opts?: { timeout?: number }): Promise<void>
  click(opts?: { timeout?: number }): Promise<void>
  count(): Promise<number>
  first(): PwLocator
}
interface PwPage {
  goto(url: string, opts: { waitUntil: string; timeout: number }): Promise<unknown>
  waitForTimeout(ms: number): Promise<void>
  locator(selector: string): PwLocator
  getByRole(role: string, opts: { name: RegExp | string }): PwLocator
  url(): string
  title(): Promise<string>
}

export async function getGcSession(
  accountUrl: string,
  email: string,
  password: string
): Promise<GcSession> {
  // GC login page (since ~05.2026 redesign):
  //   - SINGLE <form action=/cms/system/login method=GET> with BOTH login and
  //     register fields + 18+ submit buttons (mobile + desktop layouts).
  //   - Multiple input[name=email] / input[name=password] from layout dupes.
  //   - Real submit MUST be a click on the <button>Войти</button> (text match);
  //     keyboard.press('Enter') triggers the form's GET (no AJAX) → no login.
  //   - viewport must be desktop-wide (1280×800) so :visible matches the
  //     correct (desktop) layout copy of the inputs.
  const moduleName = "playwright"
  const playwright = (await import(moduleName).catch(() => {
    throw new Error(
      "Playwright not installed. Run from mcr.microsoft.com/playwright image (see scripts/refresh-gc-cookie.ts header)."
    )
  })) as { chromium: { launch(opts: { headless: boolean }): Promise<PwBrowser> } }

  const browser = await playwright.chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    await page.goto(`${accountUrl}/cms/system/login`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    })
    await page.waitForTimeout(3000)

    // Visible-only — skips the duplicate hidden mobile copy of the same inputs.
    await page.locator("input[name=email]:visible").first().fill(email, { timeout: 10000 })
    await page.locator("input[name=password]:visible").first().fill(password, { timeout: 10000 })

    const loginBtnCount = await page.getByRole("button", { name: /войти/i }).count()
    if (loginBtnCount === 0) {
      throw new Error("GetCourse login: <Войти> button not found — UI may have changed again.")
    }
    await page.getByRole("button", { name: /войти/i }).first().click({ timeout: 10000 })
    await page.waitForTimeout(8000)

    if (page.url().includes("/login")) {
      throw new Error(`GetCourse login failed: still on /login after submit (title=${await page.title()})`)
    }

    const cookies = await context.cookies()
    if (!cookies.some((c) => c.name === "PHPSESSID5")) {
      throw new Error("GetCourse login: no PHPSESSID5 cookie returned")
    }
    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ")

    return {
      cookie: cookieStr,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    }
  } finally {
    await browser.close()
  }
}
