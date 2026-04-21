# Shumoff174 (новый клиент) — onboarding reference

**Дата подключения:** 21 апреля 2026  
**Статус:** Tenant создан, OAuth прошёл, первый sync запущен

---

## Tenant в Sales GURU

- `tenant.id` = **`cmo8icb8700000ipg6iy3sl27`**
- `tenant.name` = `shumoff174`
- Login (для клиента): `kirill+shumoff@smart-analyze.ru` / `demo123`
- URL: https://app.salezguru.ru/login

## amoCRM integration

- **Subdomain:** `Shumoff174` (полный URL: https://shumoff174.amocrm.ru)
- **client_id (ID интеграции):** `9356c995-d9b2-4df9-b510-bbc7fe8e1d4c`
- **client_secret:** `e9uLN6YVQ98CEsGx5u4GhcwymVYRMNZv19Lle52DjdtLYSIJbO0OmylxEk5F2aa4`
- **redirect_uri:** `https://app.salezguru.ru/api/auth/amocrm/callback`
- **refresh_token expires:** ~3 месяца (до ~21 июля 2026)
- **scopes:** push_notifications, files, crm, files_delete, notifications

Tokens encrypted в БД (CrmConfig.refreshToken / clientSecret через `encrypt()`).

## Account info из JWT

- **account_id:** 31613282
- **base_domain:** amocrm.ru
- **api_domain:** api-b.amocrm.ru

## Sync статус

- Первый sync запущен: 21.04.2026 ~12:00
- Тянет 90 дней истории (583 deals expected)
- Логи: `/root/smart-analyze/logs/shumoff-sync.log`
- После окончания — нужно сделать **аудит-снапшот** перед показом клиенту

## TODO для shumoff

- [ ] Дождаться окончания первого sync
- [ ] Audit-snapshot (deals/funnels/managers/calls/messages)
- [ ] Послать клиенту анкету `2026-04-21-shumoff-onboarding-4kits.md`
- [ ] После ответов: backfill, фильтрация менеджеров, калибровка
- [ ] Добавить в `TENANT_DISPLAY_NAMES` в `header.tsx`: `shumoff174: "Шумов 174"` (или другое название)
- [ ] Подключить cron auto-sync каждые 2ч
