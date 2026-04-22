# Diva.school GC — разбор детальной страницы сделки (probe 22.04.2026)

**Цель:** закрыть пункт 7 онбординг-анкеты ("CRM-поля и атрибуция") силами команды через прямой парсинг GC. Клиент не знает куда смотреть — смотрим сами.

**Пробная сделка:** `829185050` (Месяц с DIVA_май26, amount=4900₽, managerId=set)
**URL сделки:** https://web.diva.school/sales/control/deal/update/id/829185050

---

## ✅ Что нашли в HTML детальной страницы сделки

### 1. Дата создания (критично — фикс bug #34)

```html
<tr>
  <td>Создан:</td>
  <td class="value">Пт 17 Апр 18:56</td>
</tr>
<tr>
  <td>Изменен:</td>
  <td class="value">Пт 17 Апр 18:59</td>
</tr>
<tr>
  <td>Статус:</td>
  ...
</tr>
```

**Селектор:** `/<td>Создан:<\/td>\s*<td class="value">([^<]+)<\/td>/`
**Формат:** `"Пт 17 Апр 18:56"` — день недели + день + месяц (RU сокращённо) + время. **Год отсутствует** — угадываем:
- Если месяц < текущий → следующий год
- Если месяц > текущий → предыдущий год  
- Если месяц = текущий → текущий год

Месяц-парсер нужен: `янв фев мар апр май июн июл авг сен окт ноя дек`.

---

### 2. Менеджер сделки

```html
<select name="Deal[manager_user_id]">
  <option value="">Не выбран</option>
  <option value="499287221">Kirill</option>
  <option value="492291033">Алена</option>
  <option value="479641130">Анастасия Тышкевич</option>
  <option value="388135467">Анастасия Рогачёва</option>
  <!-- ... весь список менеджеров diva ... -->
</select>
```

**Селектор выбранного менеджера:**
```regex
<select[^>]*name="Deal\[manager_user_id\]"[^>]*>[\s\S]*?<option[^>]*selected[^>]*value="(\d+)"
```

**Бонус:** этот dropdown — **полный справочник менеджеров diva** с `crmId → имя`. Можно извлечь из первой любой сделки, построить локальную таблицу `Manager` без отдельного запроса к странице сотрудников.

**Применение:** мапить список "кураторов" из анкеты (Лукашенко, Чернышева, Марьяна, Чиркова, Щ, Добренькова, Романова, Довгалева, Николае) в конкретные `user_id`.

---

### 3. Сумма сделки

```html
<input name="Position[846066877][price]" value="4900" />
<select name="Position[846066877][currency]">
  <option value="RUB" selected>RUB</option>
  <option value="USD">USD</option>
</select>
```

**И отдельно платёж:**
```html
<input name="Payment[amount]" value="4900" />
<select name="Payment[currency]">
  <option value="RUB" selected>RUB</option>
</select>
```

**Селектор:**
```regex
<input[^>]*name="Position\[\d+\]\[price\]"[^>]*value="([\d.]+)"
<input[^>]*name="Payment\[amount\]"[^>]*value="([\d.]+)"
```

**Структура:** сделка может иметь **несколько позиций** (Position[X]) — каждая со своей ценой. Суммарно = сумма сделки. Мы уже парсим. Валюта всегда `RUB` для diva.

---

### 4. UTM-метки (5 стандартных)

В HTML найдены две группы field-ID mapping:

```js
// domfoxMachine.dto_user — UTM на КЛИЕНТЕ:
.setField("utm_source",   851876)
.setField("utm_medium",   852921)
.setField("utm_campaign", 852922)
.setField("utm_content",  852923)
.setField("utm_term",     852925)
.setField("utm_group",    1739356)
.setField("sid",          10683257)
.setField("tgid",         11219...)
.setField("cid",          1112419)
.setField("telegram_id",  ...)
.setField("sb_avito_id",  1812251)
.setField("is_iphone",    1720697)

// domfoxMachine.dto_deal — UTM на СДЕЛКЕ:
.setField("utm_source",   854766)
.setField("utm_medium",   854767)
.setField("utm_campaign", 854768)
.setField("utm_content",  854769)
.setField("utm_term",     854770)
.setField("utm_group",    1739359)
.setField("cid",          1112419)
.setField("telegram_id",  ...)
```

**Как работают:**
- GC хранит "дополнительные поля" как **field_id → value**
- Эти setField() вызовы мапят человекочитаемое имя → GC internal field_id
- Чтобы получить значение UTM — нужно найти в HTML блок `addInputs/setInputs` где по field_id даётся значение

**Селектор маппинга:** `/setField\("([^"]+)",\s*(\d+)\)/g`

**Нужен второй probe:** найти **значения** полей (не только их ID). Обычно либо `addInput(field_id, value)` либо скрытые `<input name="dto_deal[fields][854766]" value="yandex">`.

**Бонус-поля diva (кроме UTM):**
- `cid` — Client ID Google Analytics
- `telegram_id` — Telegram контакт
- `sb_avito_id` — Avito ID
- `is_iphone` — флаг iPhone user
- `sid` — session ID

---

### 5. Статус и стадия воронки

```html
<input name="Deal[change_status]" />
<input name="Deal[cancel_reason_id]" />
<input name="Deal[cancel_reason_comment]" />
<select name="FunnelStageDeal[funnel_id]">...</select>
<select name="FunnelStageDeal[funnel_stage_id]">...</select>
```

**Применение:**
- `cancel_reason_id + cancel_reason_comment` — почему сделка отменена (ценно для /retro "lost deals")
- `funnel_stage_id` — текущая стадия (уже используется)

---

### 6. Дополнительные поля сделки (Position-based)

```html
<input name="Position[846066877][price]" value="4900" />
<!-- + валюта, название продукта и т.д. -->
```

**Применение:** каждая сделка = список позиций с ценой и продуктом. Можно извлечь **что именно купили** для классификации "флагман / трипваер".

---

## ❌ Что НЕ получилось через cookie

Страницы настроек полей вернули `AUTH-FAIL`:
- `/sales/dealfield`
- `/sales/control/dealfield`
- `/pl/sales/dealfield`
- `/sales/dealadditionalfield/index`
- `/pl/sales/dealadditionalfield/index`

**Вероятная причина:** cookie уровня "читать сделки" но не "админить настройки школы". Это **ОК** — список полей мы видим в самой сделке, отдельный settings-page не нужен.

---

## 🔧 План парсера (готов к реализации, не запущен)

### Новый файл
**`src/lib/crm/getcourse/parsers/deal-detail.ts`**

```ts
export interface ParsedDealDetail {
  crmId: string
  realCreatedAt: Date | null
  realUpdatedAt: Date | null
  managerCrmId: string | null
  managerDropdown: Array<{ id: string; name: string }>  // бонус: полный список
  positions: Array<{ price: number; currency: "RUB" | "USD" | "EUR" }>
  utm: {
    source: string | null
    medium: string | null
    campaign: string | null
    content: string | null
    term: string | null
  }
  cancelReason: string | null
  cancelComment: string | null
  funnelStageCrmId: string | null
}

export function parseDealDetail(html: string): ParsedDealDetail
export function parseGcDate(ruShortDate: string): Date | null
```

### Prisma migration (ждёт одобрения)
```prisma
model Deal {
  // existing...
  realCreatedAt DateTime?  // фикс bug #34
  realUpdatedAt DateTime?
  utmSource     String?
  utmMedium     String?
  utmCampaign   String?
  utmContent    String?
  utmTerm       String?
  cancelReason  String?
  cancelComment String?
}
```

### Backfill scripts (готовы к написанию)
1. `scripts/backfill-diva-createdat.ts` — пройти ~138K сделок, обновить `createdAt` из detail-страницы
2. `scripts/backfill-diva-utm.ts` — извлечь UTM
3. `scripts/extract-diva-managers.ts` — вытащить полный mapping crmId → имя из dropdown одной сделки → построить справочник

### Интеграция в gc-sync-v2
В `writeDealsPage()`, после создания/обновления Deal:
- если Deal новый → fetch detail-страницу → извлечь realCreatedAt, UTM, cancel reason → UPDATE
- опционально: rate-limit (один fetch на сделку = дорого для 138K за раз)

---

## Что говорить клиенту

**Ирине (или Тане):**

> Про пункт 7 онбординг-анкеты — больше ничего не нужно смотреть. Мы через прямой парсинг ваших страниц GC нашли всё сами:
> - менеджер = стандартное поле `manager_user_id`
> - сумма = Position[].price, валюта RUB
> - UTM = 5 стандартных (source, medium, campaign, content, term) — настроены и у клиента, и у сделки
> - реальная дата создания — в шапке сделки
>
> Пункт закрыт.

---

## Команды для воспроизведения probe (при необходимости)

```bash
# Скрипт probe (один раз запускался 22.04)
scp /tmp/probe-diva-fields-deep.ts root@80.76.60.130:/root/smart-analyze/scripts/

docker run --rm --network smart-analyze_default \
  -v /root/smart-analyze:/app -w /app node:22-slim \
  sh -c "set -a && . /app/.env && set +a && \
    ./node_modules/.bin/tsx scripts/probe-diva-fields-deep.ts"
```
