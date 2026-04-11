# Next Session TODO

## Что сделано (сессия 2026-04-11)

Полный SaaS-продукт от идеи до рабочего деплоя за 1 сессию:
- 90+ файлов, 15K+ строк, 35+ коммитов
- Живой продукт: https://sa.qupai.ru
- amoCRM подключена, real call pipeline работает (Whisper + DeepSeek)

## Что нужно в следующей сессии

### P0 — Блокеры

1. **amoCRM adapter: auto-fetch calls from contacts**
   - Звонки привязаны к контактам, не к сделкам
   - Метод: `/leads/{id}?with=contacts` → `/contacts/{cid}/notes?note_type=call_in,call_out`
   - Audio URL в `params.link`, duration в `params.duration`

2. **Whisper из РФ**
   - OpenAI API 403 с Timeweb сервера
   - Решение: OpenRouter прокси ИЛИ self-hosted Whisper medium
   - Временно: транскрибация с мака

### P1 — UI доработки

3. **QC графики: обрезанные подписи X-axis**
   - "Выполнение скрипта" — названия шагов обрезаются
   - Фикс: `angle: -45` или `tickFormatter` обрезка + tooltip

4. **Менеджер: сравнить с оригиналом (скрины 3-5)**
   - Breadcrumb: "Дашборд > Алина Каримова" (у нас нет)
   - Поиск + "Всё время" фильтр в header менеджера (у нас нет)
   - Pie chart первичные/повторные клиенты (у нас нет)
   - 9 метрик — реализовано, но проверить визуально

5. **Deal detail: stage tree пустой на некоторых сделках**
   - Если нет StageHistory — показать placeholder "Нет данных по этапам"
   - Или: при sync создавать StageHistory из CRM данных

### P2 — Масштабирование

6. **Боевая CRM** — подключить с десятками сделок/звонков
7. **Массовый прогон** Whisper + DeepSeek
8. **Telegram алерты** — подключить бота
9. **Экспорт PDF** (из расшифровки "PDF отчёт")
