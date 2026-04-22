# Diva.school onlinePBX — полная интеграция (SAVED 22.04.2026)

**Статус:** ✅ Все endpoint'ы найдены и проверены. Готовы к написанию адаптера.
**Контакт по PBX:** Таня Брусникина (`kpolyakov@inbox.ru`)

---

## 🔑 Учётные данные

| Параметр | Значение |
|---|---|
| PBX domain | `pbx1720.onpbx.ru` |
| auth_key | `clFwZ3JKZ0luZVRuMVI4UlBMTTB1RHB3TVFIcVo3Y0w` |
| Формат API-key (после auth) | `{key_id}:{key}` в заголовке `x-pbx-authentication` |
| API hosts | `api.onlinepbx.ru` (основной) + `api2.onlinepbx.ru` (записи) |
| Стерео-запись | ✅ для всех с 10.04.2026 (подтверждено ffprobe: channels=2) |
| API-документация | https://onlinepbx.evateam.ru/docs/docs/DOC-000051#api |
| OpenAPI spec | https://api.onlinepbx.ru/api-scheme.yaml |

---

## 📡 ПРОВЕРЕННЫЕ ENDPOINT'Ы

### 1. Auth — `POST /auth.json`
```bash
curl -X POST "https://api.onlinepbx.ru/pbx1720.onpbx.ru/auth.json" \
  -d "auth_key=clFwZ3JKZ0luZVRuMVI4UlBMTTB1RHB3TVFIcVo3Y0w"
```
**Ответ:**
```json
{"status":"1","data":{
  "key":"f621bd01bf220e898c79551bd99c727d760602f4238edba53a312a03d6e8fbdbe93cee13a0db3bd02b",
  "key_id":"e25b892d6c56ab3e755341f91b6c7543522717114900a349df8b80309527ab75",
  "new":0
}}
```

Дальше во всех запросах — заголовок: `x-pbx-authentication: {key_id}:{key}`

### 2. История звонков — `POST /mongo_history/search.json`
```bash
curl -X POST "https://api.onlinepbx.ru/pbx1720.onpbx.ru/mongo_history/search.json" \
  -H "x-pbx-authentication: ${KEY_ID}:${KEY}" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "limit=100&start_stamp_from=1776260000&start_stamp_to=1776865000"
```

Параметры:
- `limit` — макс. сколько строк
- `start_stamp_from`, `start_stamp_to` — unix timestamps (10 цифр)
- `skip` — offset для пагинации
- `user_talk_time_from`, `user_talk_time_to` — фильтр по длительности разговора
- `accountcode` — `inbound`/`outbound`

**Объём на diva:** 4 961 звонок за 7 дней.

**Response fields:**
```json
{
  "uuid": "91600b8f-3707-4d2a-b212-72d2c0ab7778",
  "caller_id_name": "121",                      // внутр. номер менеджера
  "caller_id_number": "121",
  "destination_number": "79213541758",          // телефон клиента
  "from_host": "pbx1720.onpbx.ru",
  "to_host": "pbx1720.onpbx.ru",
  "start_stamp": 1776780339,                    // unix time начала
  "end_stamp": 1776780799,                      // unix time конца
  "duration": 460,                              // общая длительность, сек
  "user_talk_time": 443,                        // время разговора (0=недозвон)
  "hangup_cause": "NORMAL_CLEARING",            // причина завершения
  "accountcode": "outbound",                    // inbound/outbound
  "gateway": "79391145065",                     // транк
  "quality_score": 0,
  "events": [...]
}
```

**hangup_cause** — ключевые значения:
- `NORMAL_CLEARING` → успешное завершение разговора
- `ORIGINATOR_CANCEL` → звонящий отменил (недозвон)
- `NO_ANSWER` → не ответили
- `USER_BUSY` → занято
- `CALL_REJECTED` → отклонено

### 3. 🎯 Скачивание записи — ТОТ ЖЕ endpoint + `download=1`

**КРИТИЧНО:** это не отдельный endpoint. Параметр `download=1` превращает search в запрос URL.

```bash
curl -X POST "https://api.onlinepbx.ru/pbx1720.onpbx.ru/mongo_history/search.json" \
  -H "x-pbx-authentication: ${KEY_ID}:${KEY}" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "uuid=91600b8f-3707-4d2a-b212-72d2c0ab7778&download=1"
```

**Ответ (status="1" → вернул URL):**
```json
{
  "status":"1",
  "data":"https://api2.onlinepbx.ru/calls-records/download/f5b2044fd59ca52941428238f7028731a7c05787ce08d6161e9de2fb39b82ceb6d/rec.mp3"
}
```

**Особенности:**
- Ссылка живёт **30 минут** для одной записи, **1 час** для архива
- Для **нескольких** записей — `uuid_array=[uuid1,uuid2,...]&download=1` → вернёт **архив .tar**
- Ссылка не требует auth-header — можно скачивать прямым `fetch()`
- Content-type: `audio/mpeg`, имя файла в `Content-Disposition` формата `YY.MM.DD-HH:MM:SS_{внутр.номер}_{телефон}_{uuid}.mp3`

**Проверка на реальном звонке (91600b8f):**
- Длительность: 460 сек (по API) / 463 сек (по ffprobe)
- Channels: **2 (stereo)** ✅
- Codec: mp3, sample_rate=8000 Hz, bitrate=16 kbps
- Размер: 905 KB для 7-минутного звонка

### 4. Список пользователей (внутренние номера) — `POST /user/get.json`
```bash
curl -X POST "https://api.onlinepbx.ru/pbx1720.onpbx.ru/user/get.json" \
  -H "x-pbx-authentication: ${KEY_ID}:${KEY}"
```

**Response:** массив `{num, name, enabled, ...}`. Полный снимок diva на 22.04.2026 — см. ниже.

### 5. Получение одного пользователя — `POST /user/get.json` с параметром num
```bash
-d "num=112"
```

### 6. ICM (контакты) — `POST /icm/search.json`
Есть, но пока не исследовал детально. Может понадобиться для маппинга телефон клиента → имя.

---

## 👥 СПРАВОЧНИК МЕНЕДЖЕРОВ DIVA (27 внутренних номеров)

**Источник:** `/user/get.json` на 22.04.2026.

### 🟢 МОПы (24 активных, подлежат оценке)
| Номер | ФИО |
|---|---|
| 100 | Людмила Баранова ОП2 |
| 101 | Татьяна Сарапулова |
| 102 | Юрий Земсков |
| 103 | Вероника Эйрих |
| 104 | Ольга Торшина |
| 105 | Ирина Зинченко |
| 106 | Наталья Костина |
| 107 | Надежда Попова |
| 108 | Татьяна Штундер |
| 109 | Ольга Непочатых |
| 110 | Анастасия Тышкевич |
| 111 | Галина Архипова ОП4 |
| 112 | Наталья Кейдалюк |
| 113 | Марина Сергеева |
| 114 | Ольга Апексимова ОП3 |
| 115 | Наталья Тесла |
| 116 | Наталья Дунаева ОП3 |
| 119 | Татьяна Храптович ОП4 |
| 120 | Нелли Кузьменко |
| 121 | Ирина Погода |
| 122 | Лейла |
| 123 | Татьяна Дубровина ОП3 |

### 🔸 ПЕРВАЯ ЛИНИЯ (отдельный скрипт по анкете)
| Номер | ФИО |
|---|---|
| 125 | Сергей Жихарев 1 линия |
| 126 | Татьяна Чернышова 1 линия |

### ⛔ ИСКЛЮЧИТЬ из оценки
| Номер | Причина |
|---|---|
| 117 | Кураторы Лукашенко, Чернышева, Марьяна, Чиркова, Щ (групповой) |
| 118 | Кураторы Добренькова, Романова, Довгалева, Николае (групповой) |
| 124 | Ирина Ишбирдина ОП4 — не работает (enabled:false) |

---

## 🛠 ПЛАН АДАПТЕРА `src/lib/crm/onlinepbx/adapter.ts`

```ts
export class OnlinePbxAdapter {
  constructor(
    private readonly domain: string,          // "pbx1720.onpbx.ru"
    private readonly authKey: string,         // "clFw..."
    private keyId?: string,                   // after auth
    private key?: string
  ) {}

  async authenticate(): Promise<void> {
    const res = await fetch(`https://api.onlinepbx.ru/${this.domain}/auth.json`, {
      method: "POST",
      body: new URLSearchParams({ auth_key: this.authKey }),
    })
    const json = await res.json()
    if (json.status !== "1") throw new Error("Auth failed")
    this.keyId = json.data.key_id
    this.key = json.data.key
  }

  async listCalls(from: Date, to: Date, opts: { limit?: number; skip?: number } = {}): Promise<OnPbxCall[]> {
    // POST /mongo_history/search.json
  }

  async getRecordUrl(uuid: string): Promise<string | null> {
    // POST /mongo_history/search.json with uuid=X&download=1
    // returns data URL string (live 30 min)
  }

  async listUsers(): Promise<OnPbxUser[]> {
    // POST /user/get.json
  }
}

export interface OnPbxCall {
  uuid: string
  callerNumber: string       // внутр номер менеджера
  destinationNumber: string  // телефон клиента
  startStamp: number         // unix
  duration: number
  userTalkTime: number       // 0 = недозвон
  hangupCause: string
  direction: "inbound" | "outbound"
}

export interface OnPbxUser {
  num: string           // "112"
  name: string          // "Наталья Кейдалюк"
  enabled: boolean
}
```

Примерно 150 строк кода, включая auth-retry на 401, обработку URL протухания (refetch если 30-мин прошло).

---

## 🔧 ИНТЕГРАЦИЯ В SYSTEM

1. **CrmConfig.provider** — добавить `"ONLINEPBX"` к enum (сейчас `AMOCRM`/`GETCOURSE`/`BITRIX24`)
2. **Доп.поля CrmConfig:** `onPbxAuthKey`, `onPbxDomain` — encrypt/decrypt как gcCookie
3. **`src/lib/sync/onpbx-sync.ts`** — новый модуль:
   - На вход: `tenantId`
   - Читает CrmConfig с provider=ONLINEPBX
   - Для diva это **второй CrmConfig** к уже существующему GETCOURSE
4. **Маппинг onPbxCall ↔ CallRecord (diva):**
   - `uuid` → `CallRecord.crmId`
   - `callerNumber` (напр. "121") → найти `Manager` по `Manager.num = 121` (новое поле!) → `CallRecord.managerId`
   - `destinationNumber` → `CallRecord.clientPhone`
   - `startStamp` → `CallRecord.createdAt`
   - `duration` → `CallRecord.duration`
   - `hangupCause + userTalkTime` → `CallRecord.endReason` + флаг "real vs missed"
   - `direction` → `CallRecord.direction`
   - Audio URL скачивается на сервере во временное хранилище → на RunPod → transcribe → save audioUrl=null, transcript

5. **Новое поле `Manager.internalExtension`** — для маппинга "101" → Manager (перенести уже в schema)

---

## ❓ Что ЕЩЁ надо узнать / выяснить

1. **Срок хранения записей на onlinePBX** — сколько дней/месяцев? Влияет на окно sync (если 30 дней — синкаем за 30, если год — за 90)
2. **Формат `uuid_array`** — точный синтаксис (JSON-массив или `uuid_array[]=X&uuid_array[]=Y`)?
3. **Webhook** при новом звонке — есть ли? Настроим чтобы триггерить sync в real-time, а не polling каждые 2ч

**НЕ блокирует — можем писать адаптер сейчас, эти 3 вопроса — P2.**

---

## 📊 Объём работы для diva после подключения

| Метрика | Значение |
|---|---|
| Активных менеджеров | 24 МОП + 2 первая линия |
| Звонков за 7 дней | ~5 000 |
| За 30 дней (проекция) | ~20 000 |
| Стерео-запись | ✅ 100% |
| Средний размер audio | ~130 KB/мин (stereo MP3 8kHz 16kbps) |
| Трафик для транскрибации | ~2.5 GB/месяц если всё качать |
| RunPod стоимость | ~$30-40/месяц на обработку всех звонков |
| DeepSeek оценка | ~$10-15/месяц |

---

## 🚀 Следующий шаг

Написать `src/lib/crm/onlinepbx/adapter.ts` + `src/lib/sync/onpbx-sync.ts`. Оценка: **~3-4 часа** работы (с тестами и error handling).

После этого — добавить второй CrmConfig для diva, указать onPbx-ключи, запустить полный sync метаданных (без audio) за 30 дней, собрать snapshot.

**После PBX: audio→transcribe→score pipeline** (детали в `docs/plans/2026-04-21-transcription-pipeline-fix.md`).
