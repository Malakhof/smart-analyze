# 🍪 GetCourse Cookie Auto-Refresh — Canon (mandatory для GC tenants)

**Зачем:** GC не имеет API key (для большинства endpoints). Мы аутентифицируемся через **session cookie** в `CrmConfig.gcCookie`. Cookie живёт **7-14 дней**, потом **протухает**.

Когда cookie протух — **синхронно ломается:**
- Phone resolve (gcContactId = null для всех новых звонков)
- Deal sync (Deal.clientCrmId не обновляется)
- Reconciliation (crmCount = null → 3-way diff degraded до 2-way)
- Block 7 commitments sync (когда построим)

**Текущий процесс (handoff v2):** Telegram alert «нужна ручная авторизация» → ты заходишь в GC → копируешь cookie → обновляешь в БД. **Реальная latency = 12-24 часа** (если cookie протух ночью).

## Решение: автоматический refresh через Playwright

### Архитектура

```
┌──────────────────────────────────────────┐
│ Cron каждый час: cron-gc-cookie-check.ts │
│   ↓                                       │
│ 1. Проверить cookie — сделать probe       │
│    GET /pl/sales/control/deal/index      │
│    с текущим cookie                      │
│   ↓                                       │
│ 2. Если 200 OK → cookie живой → exit     │
│ 3. Если 302 redirect to /login →         │
│    cookie expired → запустить refresh    │
│   ↓                                       │
│ 4. Refresh: Playwright headless browser  │
│    a. Открыть GC login page              │
│    b. Login через email+password         │
│       (encrypted в Tenant.gcCredentials) │
│    c. Если 2FA — взять code из          │
│       Tenant.gcTotpSecret через TOTP    │
│    d. Получить cookies после login       │
│    e. UPDATE CrmConfig.gcCookie          │
│    f. Telegram info alert "cookie auto-  │
│       refreshed for tenant X"            │
└──────────────────────────────────────────┘
```

### Реализация

```typescript
// scripts/cron-gc-cookie-check.ts
import { chromium } from 'playwright'
import { authenticator } from 'otplib'

async function checkCookieAlive(tenant: Tenant): Promise<boolean> {
  const config = await getCrmConfig(tenant.id)
  const cookie = decryptIfNeeded(config.gcCookie)

  const res = await fetch(`https://${config.subdomain}/pl/sales/control/deal/index`, {
    headers: { Cookie: `PHPSESSID=${cookie}` },
    redirect: 'manual'  // не следовать redirect, иначе не различим 200 vs 302
  })

  if (res.status === 200) return true
  if (res.status === 302 && res.headers.get('location')?.includes('/login')) return false
  // Любой другой статус — подозрительно, alert
  await telegramAlert(`${tenant.name}: GC probe вернул unexpected ${res.status}`)
  return false
}

async function refreshCookieViaPlaywright(tenant: Tenant) {
  const creds = decryptCredentials(tenant.gcCredentials)
  // creds = { email, password, totpSecret? }

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    // 1. Открыть login page
    await page.goto(`https://${tenant.gcSubdomain}/pl/auth/login`)

    // 2. Заполнить форму
    await page.fill('input[name="LoginForm[email]"]', creds.email)
    await page.fill('input[name="LoginForm[password]"]', creds.password)
    await page.click('button[type="submit"]')

    // 3. Wait for navigation
    await page.waitForLoadState('networkidle', { timeout: 10000 })

    // 4. Если 2FA нужно — обработать
    if (page.url().includes('2fa')) {
      if (!creds.totpSecret) {
        throw new Error('2FA prompted but no totpSecret in creds')
      }
      const code = authenticator.generate(creds.totpSecret)
      await page.fill('input[name="code"]', code)
      await page.click('button[type="submit"]')
      await page.waitForLoadState('networkidle', { timeout: 10000 })
    }

    // 5. Verify logged in (URL содержит /sales или /teach, не /login)
    if (page.url().includes('/login') || page.url().includes('2fa')) {
      throw new Error('Login failed — credentials wrong?')
    }

    // 6. Получить cookies
    const cookies = await context.cookies()
    const phpSessId = cookies.find(c => c.name === 'PHPSESSID')?.value
    if (!phpSessId) throw new Error('No PHPSESSID cookie after login')

    // 7. Записать в БД
    await db.crmConfig.update({
      where: { tenantId: tenant.id, provider: 'GETCOURSE' },
      data: {
        gcCookie: encryptIfPolicy(phpSessId),
        gcCookieRefreshedAt: new Date()
      }
    })

    await telegramAlert(`${tenant.name}: ✅ GC cookie auto-refreshed`)

    return phpSessId
  } catch (err) {
    await telegramAlert(`${tenant.name}: 🔴 GC cookie refresh FAILED: ${err.message}. Manual login needed.`)
    throw err
  } finally {
    await browser.close()
  }
}

async function main() {
  const tenants = await db.tenant.findMany({
    where: { crmConfigs: { some: { provider: 'GETCOURSE' } } }
  })

  for (const tenant of tenants) {
    const alive = await checkCookieAlive(tenant)
    if (!alive) {
      console.log(`[cookie-check] ${tenant.name}: cookie expired, refreshing...`)
      await refreshCookieViaPlaywright(tenant)
    } else {
      console.log(`[cookie-check] ${tenant.name}: cookie alive`)
    }
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
```

### Schema additions

```prisma
model Tenant {
  // ... existing ...
  gcCredentials String?  // encrypted JSON: { email, password, totpSecret? }
}

model CrmConfig {
  // ... existing ...
  gcCookieRefreshedAt DateTime?
}
```

### Crontab

```cron
# Проверять cookie каждый час (refresh если протух)
0 * * * * cd /root/smart-analyze && tsx scripts/cron-gc-cookie-check.ts >> /var/log/smart-analyze/gc-cookie.log 2>&1
```

## Безопасность credentials

⚠️ **gcCredentials хранится зашифрованно** (AES-256-GCM с `ENCRYPTION_KEY` из env).

```typescript
function encryptCredentials(creds: { email: string, password: string, totpSecret?: string }) {
  const json = JSON.stringify(creds)
  return aes256gcmEncrypt(json, process.env.ENCRYPTION_KEY)
  // Format: iv:tag:ciphertext (hex)
}
```

Как user даёт credentials — **через защищённый канал** (не плейн в БД, не в git). Setup procedure:

```typescript
// scripts/setup-gc-credentials.ts (manual run, не cron)
const creds = await prompt({
  email: 'GC email:',
  password: 'GC password:',
  totpSecret: 'TOTP secret (если 2FA):'
})

const encrypted = encryptCredentials(creds)

await db.tenant.update({
  where: { id: tenantId },
  data: { gcCredentials: encrypted }
})

console.log('Credentials saved encrypted. Test refresh with: tsx scripts/cron-gc-cookie-check.ts')
```

## Test scenario

```bash
# 1. Inject expired cookie
psql -c "UPDATE \"CrmConfig\" SET \"gcCookie\" = 'expired-fake-cookie' WHERE \"tenantId\" = 'cmo4qkb1000000jo432rh0l3u'"

# 2. Запустить check
tsx scripts/cron-gc-cookie-check.ts

# 3. Verify
# - В логе: "cookie expired, refreshing..."
# - В БД: gcCookieRefreshedAt = NOW()
# - В Telegram: "✅ GC cookie auto-refreshed"

# 4. Verify refresh работает
psql -c "SELECT LENGTH(\"gcCookie\"), \"gcCookieRefreshedAt\" FROM \"CrmConfig\" WHERE \"tenantId\" = 'cmo4qkb1000000jo432rh0l3u'"
# LENGTH должен быть ~32 (нормальный PHPSESSID)
```

## Failure modes & mitigation

| Сценарий | Что происходит | Mitigation |
|---|---|---|
| GC изменил login form selectors | Playwright не найдёт input | Try-catch + alert «manual login needed» |
| 2FA включили на аккаунте а totpSecret не настроен | Login fail на 2FA шаге | Alert + ручной flow |
| Сервер где cron — без display | Headless Chromium должен работать | Использовать `chromium-no-sandbox` для root |
| Playwright не установлен в Docker image | Cron fail при `import { chromium }` | Добавить в Dockerfile: `RUN npx playwright install chromium` |
| GC bot detection включится | Login отклоняется | Use stealth plugin или чередовать User-Agent + delays |

## Without this canon

Cookie expiry — самая частая причина silent failure cron'а. Без auto-refresh:
- 60% вероятность что cookie протухнет за неделю
- Замечается через 12-48 часов (когда РОП спросит «почему gcContactId null у новых?»)
- 12+ часов простоя phone resolve / reconciliation
- Клиенты diva теряют новых лидов в дашборде РОПа

Auto-refresh переводит это в **5-10 минут downtime раз в неделю** (cookie expired → следующий час cron triggered → refresh → возврат в строй).
