import { PrismaClient } from "../src/generated/prisma"
import { hash } from "bcryptjs"

const prisma = new PrismaClient()

async function main() {
  console.log("🌱 Seeding database...")

  // Clean existing data
  await prisma.callTag.deleteMany()
  await prisma.callScoreItem.deleteMany()
  await prisma.callScore.deleteMany()
  await prisma.callRecord.deleteMany()
  await prisma.scriptItem.deleteMany()
  await prisma.script.deleteMany()
  await prisma.telegramConfig.deleteMany()
  await prisma.dealPattern.deleteMany()
  await prisma.dealAnalysis.deleteMany()
  await prisma.dealStageHistory.deleteMany()
  await prisma.message.deleteMany()
  await prisma.deal.deleteMany()
  await prisma.pattern.deleteMany()
  await prisma.insight.deleteMany()
  await prisma.funnelStage.deleteMany()
  await prisma.funnel.deleteMany()
  await prisma.manager.deleteMany()
  await prisma.crmConfig.deleteMany()
  await prisma.session.deleteMany()
  await prisma.account.deleteMany()
  await prisma.user.deleteMany()
  await prisma.tenant.deleteMany()

  // === TENANT ===
  const tenant = await prisma.tenant.create({
    data: {
      name: "ООО Рассвет",
      plan: "DEMO",
      dealsUsed: 52,
      dealsLimit: 50,
    },
  })
  console.log("  Tenant:", tenant.name)

  // === USER ===
  const hashedPassword = await hash("demo123", 12)
  const user = await prisma.user.create({
    data: {
      email: "demo@smart-analyze.ru",
      name: "Администратор",
      password: hashedPassword,
      role: "OWNER",
      tenantId: tenant.id,
    },
  })
  console.log("  User:", user.email)

  // === FUNNEL + STAGES ===
  const funnel = await prisma.funnel.create({
    data: {
      tenantId: tenant.id,
      name: "Продажи B2B",
      crmId: "1",
    },
  })

  const stageNames = [
    "Новая заявка",
    "Квалификация",
    "Презентация",
    "КП",
    "Согласование",
    "Закрытие",
  ]
  const stages: Record<string, string> = {}
  for (let i = 0; i < stageNames.length; i++) {
    const stage = await prisma.funnelStage.create({
      data: {
        funnelId: funnel.id,
        name: stageNames[i],
        order: i + 1,
        crmId: String(i + 1),
      },
    })
    stages[stageNames[i]] = stage.id
  }
  console.log("  Funnel:", funnel.name, "with", stageNames.length, "stages")

  // === MANAGERS ===
  const alina = await prisma.manager.create({
    data: {
      tenantId: tenant.id,
      name: "Алина Каримова",
      email: "alina@rassvet.ru",
      crmId: "mgr-1",
      totalDeals: 1,
      successDeals: 1,
      conversionRate: 100,
      avgDealValue: 354781,
      avgDealTime: 172.8,
      talkRatio: 55.7,
      avgResponseTime: 12,
      status: "EXCELLENT",
    },
  })

  const darya = await prisma.manager.create({
    data: {
      tenantId: tenant.id,
      name: "Дарья Белова",
      email: "darya@rassvet.ru",
      crmId: "mgr-2",
      totalDeals: 1,
      successDeals: 1,
      conversionRate: 100,
      avgDealValue: 0,
      avgDealTime: 490.9,
      talkRatio: 40.2,
      avgResponseTime: 25,
      status: "EXCELLENT",
    },
  })

  const madina = await prisma.manager.create({
    data: {
      tenantId: tenant.id,
      name: "Мадина Нурланова",
      email: "madina@rassvet.ru",
      crmId: "mgr-3",
      totalDeals: 2,
      successDeals: 1,
      conversionRate: 50,
      avgDealValue: 21103,
      avgDealTime: 83.5,
      talkRatio: 78.2,
      avgResponseTime: 45,
      status: "WATCH",
    },
  })

  const ekaterina = await prisma.manager.create({
    data: {
      tenantId: tenant.id,
      name: "Екатерина Соколова",
      email: "ekaterina@rassvet.ru",
      crmId: "mgr-4",
      totalDeals: 48,
      successDeals: 19,
      conversionRate: 39.58,
      avgDealValue: 388427,
      avgDealTime: 92.7,
      talkRatio: 46,
      avgResponseTime: 38,
      status: "CRITICAL",
    },
  })

  console.log("  Managers: 4 created")

  // === DEALS ===
  // Helper to create a date N days ago
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000)

  // Alina's deal (WON)
  const dealAlina1 = await prisma.deal.create({
    data: {
      tenantId: tenant.id,
      managerId: alina.id,
      funnelId: funnel.id,
      crmId: "D-101",
      title: "Поставка промышленного оборудования «ТехноГрупп»",
      amount: 354781,
      status: "WON",
      duration: 172.8,
      createdAt: daysAgo(180),
      closedAt: daysAgo(7),
      isAnalyzed: true,
      analysisType: "TEXT",
    },
  })

  // Darya's deal (WON)
  const dealDarya1 = await prisma.deal.create({
    data: {
      tenantId: tenant.id,
      managerId: darya.id,
      funnelId: funnel.id,
      crmId: "D-102",
      title: "Годовой контракт на обслуживание «БизнесСервис»",
      amount: 0,
      status: "WON",
      duration: 490.9,
      createdAt: daysAgo(500),
      closedAt: daysAgo(10),
      isAnalyzed: true,
      analysisType: "TEXT",
    },
  })

  // Madina's deals (1 WON, 1 LOST)
  const dealMadina1 = await prisma.deal.create({
    data: {
      tenantId: tenant.id,
      managerId: madina.id,
      funnelId: funnel.id,
      crmId: "D-103",
      title: "Партия расходных материалов «МедТех»",
      amount: 21103,
      status: "WON",
      duration: 83.5,
      createdAt: daysAgo(90),
      closedAt: daysAgo(7),
      isAnalyzed: true,
      analysisType: "TEXT",
    },
  })

  const dealMadina2 = await prisma.deal.create({
    data: {
      tenantId: tenant.id,
      managerId: madina.id,
      funnelId: funnel.id,
      crmId: "D-104",
      title: "Тестовая закупка образцов «ФармаПлюс»",
      amount: 15000,
      status: "LOST",
      duration: 45.2,
      createdAt: daysAgo(60),
      closedAt: daysAgo(15),
      isAnalyzed: true,
      analysisType: "TEXT",
    },
  })

  // Ekaterina's deals (mix of WON/LOST/OPEN — creating 10 representative)
  const ekaterinaDeals = [
    { crmId: "D-201", title: "Контракт на логистику «ТрансЛогик»", amount: 890000, status: "WON" as const, duration: 65.3, daysAgoCreated: 120, daysAgoClosed: 55 },
    { crmId: "D-202", title: "Оснащение офиса «СтройИнвест»", amount: 425000, status: "WON" as const, duration: 92.1, daysAgoCreated: 150, daysAgoClosed: 58 },
    { crmId: "D-203", title: "Поставка оборудования «АльфаТех»", amount: 312000, status: "WON" as const, duration: 78.4, daysAgoCreated: 100, daysAgoClosed: 22 },
    { crmId: "D-204", title: "Годовое обслуживание «ПромСнаб»", amount: 156000, status: "WON" as const, duration: 110.5, daysAgoCreated: 140, daysAgoClosed: 30 },
    { crmId: "D-205", title: "Комплексная поставка «ИнжСтрой»", amount: 178000, status: "WON" as const, duration: 88.0, daysAgoCreated: 95, daysAgoClosed: 7 },
    { crmId: "D-206", title: "Разовая закупка «НефтеХим»", amount: 530000, status: "LOST" as const, duration: 34.2, daysAgoCreated: 80, daysAgoClosed: 46 },
    { crmId: "D-207", title: "Пилотный проект «ЭнергоСеть»", amount: 210000, status: "LOST" as const, duration: 120.0, daysAgoCreated: 160, daysAgoClosed: 40 },
    { crmId: "D-208", title: "Тендер на оборудование «МашПром»", amount: 1200000, status: "LOST" as const, duration: 95.3, daysAgoCreated: 130, daysAgoClosed: 35 },
    { crmId: "D-209", title: "Расходники для производства «ХимТрейд»", amount: 67000, status: "LOST" as const, duration: 28.5, daysAgoCreated: 45, daysAgoClosed: 17 },
    { crmId: "D-210", title: "Запрос КП на поставку «АгроТех»", amount: 340000, status: "OPEN" as const, duration: undefined, daysAgoCreated: 14, daysAgoClosed: undefined },
  ]

  const createdEkatDeals = []
  for (const d of ekaterinaDeals) {
    const deal = await prisma.deal.create({
      data: {
        tenantId: tenant.id,
        managerId: ekaterina.id,
        funnelId: funnel.id,
        crmId: d.crmId,
        title: d.title,
        amount: d.amount,
        status: d.status,
        duration: d.duration ?? null,
        createdAt: daysAgo(d.daysAgoCreated),
        closedAt: d.daysAgoClosed ? daysAgo(d.daysAgoClosed) : null,
        isAnalyzed: d.status !== "OPEN",
        analysisType: d.status !== "OPEN" ? "TEXT" : null,
      },
    })
    createdEkatDeals.push(deal)
  }

  const allDeals = [dealAlina1, dealDarya1, dealMadina1, dealMadina2, ...createdEkatDeals]
  console.log("  Deals:", allDeals.length, "created")

  // === MESSAGES ===
  // Helper to create messages for a deal
  async function createMessages(
    dealId: string,
    msgs: { sender: "MANAGER" | "CLIENT" | "SYSTEM"; content: string; minutesOffset: number }[]
  ) {
    const base = daysAgo(30)
    for (const m of msgs) {
      await prisma.message.create({
        data: {
          dealId,
          sender: m.sender,
          content: m.content,
          timestamp: new Date(base.getTime() + m.minutesOffset * 60000),
        },
      })
    }
  }

  // Alina's deal messages
  await createMessages(dealAlina1.id, [
    { sender: "CLIENT", content: "Добрый день! Нас интересует промышленное оборудование для нового цеха. Можете подготовить предложение?", minutesOffset: 0 },
    { sender: "MANAGER", content: "Здравствуйте! Конечно, с удовольствием помогу. Подскажите, какой объём производства планируете и есть ли предпочтения по производителям?", minutesOffset: 5 },
    { sender: "CLIENT", content: "Планируем 500 единиц в месяц. Производитель не принципиален, главное — надёжность и сервис.", minutesOffset: 12 },
    { sender: "MANAGER", content: "Отлично! Учитывая ваш объём, рекомендую линейку XR-500 — она оптимальна по соотношению цена/производительность. Могу предложить адаптировать конфигурацию под ваши задачи. Также можем организовать образцы для тестирования.", minutesOffset: 18 },
    { sender: "CLIENT", content: "Образцы — это хорошая идея. Давайте так и сделаем.", minutesOffset: 25 },
  ])

  // Darya's deal messages
  await createMessages(dealDarya1.id, [
    { sender: "SYSTEM", content: "Создана новая сделка из входящего обращения", minutesOffset: 0 },
    { sender: "CLIENT", content: "Здравствуйте, мы ищем подрядчика на годовое обслуживание офисного оборудования.", minutesOffset: 5 },
    { sender: "MANAGER", content: "Добрый день! Расскажите подробнее — сколько единиц техники, какие типы оборудования?", minutesOffset: 15 },
    { sender: "CLIENT", content: "Около 120 единиц: принтеры, МФУ, компьютеры. Нужен выезд инженера + удалённая поддержка.", minutesOffset: 30 },
    { sender: "MANAGER", content: "Понял. Подготовлю детальное КП с вариантами SLA. Обычно для такого объёма предлагаем тариф «Бизнес» с гарантированным временем реакции 4 часа.", minutesOffset: 35 },
  ])

  // Madina's won deal messages
  await createMessages(dealMadina1.id, [
    { sender: "CLIENT", content: "Нужны расходные материалы для медицинского оборудования, срочно.", minutesOffset: 0 },
    { sender: "MANAGER", content: "Здравствуйте! Какое оборудование, какие артикулы нужны?", minutesOffset: 3 },
    { sender: "CLIENT", content: "Аппарат УЗИ Mindray DC-70, нужны гели и бумага для принтера.", minutesOffset: 8 },
    { sender: "MANAGER", content: "Всё есть на складе, могу отправить сегодня. Цена по прайсу 21 103 руб. Скину счёт?", minutesOffset: 10 },
    { sender: "CLIENT", content: "Да, скидывайте, оплатим сегодня.", minutesOffset: 12 },
  ])

  // Madina's lost deal messages
  await createMessages(dealMadina2.id, [
    { sender: "CLIENT", content: "Хотим заказать тестовую партию образцов для лаборатории.", minutesOffset: 0 },
    { sender: "MANAGER", content: "Добрый день! Какие именно образцы вас интересуют?", minutesOffset: 120 },
    { sender: "CLIENT", content: "Реагенты серии BX. Сколько будет стоить минимальная партия?", minutesOffset: 125 },
    { sender: "MANAGER", content: "Сейчас уточню наличие, вернусь с ответом.", minutesOffset: 200 },
    { sender: "CLIENT", content: "Мы уже нашли другого поставщика. Спасибо.", minutesOffset: 1500 },
  ])

  // Ekaterina's deals messages (first 4 for variety)
  await createMessages(createdEkatDeals[0].id, [
    { sender: "CLIENT", content: "Нужен контракт на логистику, 3 маршрута ежедневно.", minutesOffset: 0 },
    { sender: "MANAGER", content: "Добрый день, какие направления?", minutesOffset: 30 },
    { sender: "CLIENT", content: "Москва-Казань, Москва-Нижний, Москва-Самара.", minutesOffset: 35 },
    { sender: "MANAGER", content: "Подготовлю тарифную сетку. По срокам — когда нужно начать?", minutesOffset: 40 },
    { sender: "CLIENT", content: "В течение месяца. Присылайте КП.", minutesOffset: 50 },
  ])

  await createMessages(createdEkatDeals[5].id, [
    { sender: "CLIENT", content: "Какая цена на партию катализаторов?", minutesOffset: 0 },
    { sender: "MANAGER", content: "Добрый день, уточните объём.", minutesOffset: 180 },
    { sender: "CLIENT", content: "500 кг. И ещё вопрос — есть ли скидки при повторном заказе?", minutesOffset: 185 },
    { sender: "MANAGER", content: "По 500 кг — стандартный прайс 530 000 руб. По скидкам вернусь позже.", minutesOffset: 600 },
    { sender: "CLIENT", content: "Слишком долго ждать, нашли другого поставщика.", minutesOffset: 2000 },
  ])

  await createMessages(createdEkatDeals[7].id, [
    { sender: "CLIENT", content: "Участвуем в тендере, нужно КП на оборудование для цеха.", minutesOffset: 0 },
    { sender: "MANAGER", content: "Здравствуйте, что именно нужно?", minutesOffset: 60 },
    { sender: "CLIENT", content: "Список в приложении. Срок подачи — неделя.", minutesOffset: 65 },
    { sender: "MANAGER", content: "Получила, работаю над КП.", minutesOffset: 120 },
    { sender: "CLIENT", content: "Сроки вышли, мы подали с другим поставщиком. Может, в следующий раз.", minutesOffset: 10000 },
  ])

  console.log("  Messages: created for key deals")

  // === DEAL STAGE HISTORY ===
  // Create stage history for analyzed deals (progression through funnel)
  async function createStageHistory(
    dealId: string,
    stageProgression: { stageName: string; daysAgoEntered: number; daysAgoLeft?: number }[]
  ) {
    for (const sp of stageProgression) {
      const enteredAt = daysAgo(sp.daysAgoEntered)
      const leftAt = sp.daysAgoLeft !== undefined ? daysAgo(sp.daysAgoLeft) : null
      const dur = leftAt ? (leftAt.getTime() - enteredAt.getTime()) / 86400000 : null
      await prisma.dealStageHistory.create({
        data: {
          dealId,
          stageId: stages[sp.stageName],
          enteredAt,
          leftAt,
          duration: dur,
        },
      })
    }
  }

  await createStageHistory(dealAlina1.id, [
    { stageName: "Новая заявка", daysAgoEntered: 180, daysAgoLeft: 175 },
    { stageName: "Квалификация", daysAgoEntered: 175, daysAgoLeft: 160 },
    { stageName: "Презентация", daysAgoEntered: 160, daysAgoLeft: 140 },
    { stageName: "КП", daysAgoEntered: 140, daysAgoLeft: 90 },
    { stageName: "Согласование", daysAgoEntered: 90, daysAgoLeft: 20 },
    { stageName: "Закрытие", daysAgoEntered: 20, daysAgoLeft: 7 },
  ])

  await createStageHistory(dealMadina1.id, [
    { stageName: "Новая заявка", daysAgoEntered: 90, daysAgoLeft: 88 },
    { stageName: "Квалификация", daysAgoEntered: 88, daysAgoLeft: 85 },
    { stageName: "КП", daysAgoEntered: 85, daysAgoLeft: 30 },
    { stageName: "Согласование", daysAgoEntered: 30, daysAgoLeft: 10 },
    { stageName: "Закрытие", daysAgoEntered: 10, daysAgoLeft: 7 },
  ])

  await createStageHistory(createdEkatDeals[0].id, [
    { stageName: "Новая заявка", daysAgoEntered: 120, daysAgoLeft: 115 },
    { stageName: "Квалификация", daysAgoEntered: 115, daysAgoLeft: 100 },
    { stageName: "Презентация", daysAgoEntered: 100, daysAgoLeft: 85 },
    { stageName: "КП", daysAgoEntered: 85, daysAgoLeft: 70 },
    { stageName: "Согласование", daysAgoEntered: 70, daysAgoLeft: 58 },
    { stageName: "Закрытие", daysAgoEntered: 58, daysAgoLeft: 55 },
  ])

  await createStageHistory(createdEkatDeals[5].id, [
    { stageName: "Новая заявка", daysAgoEntered: 80, daysAgoLeft: 78 },
    { stageName: "Квалификация", daysAgoEntered: 78, daysAgoLeft: 65 },
    { stageName: "КП", daysAgoEntered: 65, daysAgoLeft: 50 },
  ])

  console.log("  Stage history: created for key deals")

  // === DEAL ANALYSIS ===
  await prisma.dealAnalysis.create({
    data: {
      dealId: dealAlina1.id,
      summary: "Менеджер продемонстрировала высокий уровень экспертизы и проактивный подход. Адаптация конфигурации под задачи клиента и предложение образцов стали ключевыми факторами успеха.",
      successFactors: "Быстрая реакция на запрос, адаптивное конфигурирование, проактивное предложение образцов, глубокое знание продукта",
      keyQuotes: [
        { text: "Могу предложить адаптировать конфигурацию под ваши задачи", context: "Предложение кастомизации", isPositive: true, dealCrmId: "D-101" },
        { text: "Также можем организовать образцы для тестирования", context: "Проактивное предложение", isPositive: true, dealCrmId: "D-101" },
      ],
      recommendations: "Использовать подход Алины как образец: быстрая квалификация + кастомное предложение + образцы.",
      talkRatio: 55.7,
      avgResponseTime: 5,
    },
  })

  await prisma.dealAnalysis.create({
    data: {
      dealId: dealDarya1.id,
      summary: "Длительная сделка с качественной проработкой. Менеджер задавала правильные вопросы и предложила подходящий тариф. Несмотря на длительный цикл, клиент остался удовлетворён.",
      successFactors: "Структурированный подход к квалификации, правильная тарификация, терпеливая работа с длинным циклом",
      keyQuotes: [
        { text: "Для такого объёма предлагаем тариф «Бизнес» с гарантированным временем реакции 4 часа", context: "Экспертное предложение", isPositive: true, dealCrmId: "D-102" },
      ],
      recommendations: "Сократить цикл сделки — 490 дней чрезмерно для такого типа контракта.",
      talkRatio: 40.2,
      avgResponseTime: 10,
    },
  })

  await prisma.dealAnalysis.create({
    data: {
      dealId: dealMadina2.id,
      summary: "Клиент потерян из-за медленной реакции менеджера. Время ответа на вопрос о цене — более 2 часов, повторный ответ — через сутки. Клиент ушёл к конкуренту.",
      failureFactors: "Медленное время ответа, отсутствие конкретики по ценам, пассивный follow-up",
      keyQuotes: [
        { text: "Сейчас уточню наличие, вернусь с ответом", context: "Отсутствие готовности", isPositive: false, dealCrmId: "D-104" },
        { text: "Мы уже нашли другого поставщика", context: "Потеря клиента", isPositive: false, dealCrmId: "D-104" },
      ],
      recommendations: "Подготовить прайс-лист на типовые позиции для мгновенных ответов. Установить SLA на время ответа — не более 30 минут.",
      talkRatio: 78.2,
      avgResponseTime: 75,
    },
  })

  await prisma.dealAnalysis.create({
    data: {
      dealId: createdEkatDeals[5].id,
      summary: "Сделка проиграна из-за игнорирования вопроса клиента о скидках и медленного ответа. Клиент явно сигнализировал о готовности к повторным заказам, но менеджер не использовала этот сигнал.",
      failureFactors: "Игнорирование вопроса о скидках, медленный ответ (3 часа на первый ответ), отсутствие follow-up",
      keyQuotes: [
        { text: "По скидкам вернусь позже", context: "Игнорирование ценового вопроса", isPositive: false, dealCrmId: "D-206" },
        { text: "Слишком долго ждать, нашли другого поставщика", context: "Потеря из-за медлительности", isPositive: false, dealCrmId: "D-206" },
      ],
      recommendations: "Немедленно отвечать на вопросы о ценах и скидках. Использовать вопрос о повторных заказах как сигнал для апсейла.",
      talkRatio: 35,
      avgResponseTime: 180,
    },
  })

  await prisma.dealAnalysis.create({
    data: {
      dealId: createdEkatDeals[7].id,
      summary: "Тендерная сделка проиграна из-за срыва сроков подготовки КП. Клиент чётко обозначил дедлайн, но менеджер не уложилась в него.",
      failureFactors: "Срыв сроков, пассивная коммуникация, отсутствие эскалации при жёстких дедлайнах",
      keyQuotes: [
        { text: "Сроки вышли, мы подали с другим поставщиком", context: "Потеря тендера", isPositive: false, dealCrmId: "D-208" },
      ],
      recommendations: "При тендерах немедленно эскалировать подготовку КП. Установить внутренний дедлайн за 2 дня до внешнего.",
      talkRatio: 46,
      avgResponseTime: 60,
    },
  })

  await prisma.dealAnalysis.create({
    data: {
      dealId: createdEkatDeals[0].id,
      summary: "Успешная сделка на логистику. Менеджер задала правильные вопросы о маршрутах и сроках, быстро подготовила КП с тарифной сеткой.",
      successFactors: "Структурированная квалификация, быстрая подготовка КП, понимание логистических потребностей",
      keyQuotes: [
        { text: "Подготовлю тарифную сетку. По срокам — когда нужно начать?", context: "Проактивное выяснение деталей", isPositive: true, dealCrmId: "D-201" },
      ],
      recommendations: "Хороший пример квалификации — масштабировать подход на другие сделки.",
      talkRatio: 48,
      avgResponseTime: 30,
    },
  })

  console.log("  Deal analyses: 6 created")

  // === PATTERNS ===
  const patternSuccess1 = await prisma.pattern.create({
    data: {
      tenantId: tenant.id,
      type: "SUCCESS",
      title: "Адаптивное конфигурирование заказа",
      description: "Менеджер адаптирует предложение под конкретные задачи клиента, предлагая кастомные конфигурации вместо стандартных решений. Это повышает воспринимаемую ценность и увеличивает конверсию.",
      strength: 84,
      impact: 83.3,
      reliability: 91,
      coverage: 72.7,
      dealCount: 8,
      managerCount: 2,
    },
  })

  const patternSuccess2 = await prisma.pattern.create({
    data: {
      tenantId: tenant.id,
      type: "SUCCESS",
      title: "Проактивное предложение образцов",
      description: "Менеджер без запроса клиента предлагает тестовые образцы или пилотный проект. Снижает барьер входа и ускоряет принятие решения.",
      strength: 71,
      impact: 61.2,
      reliability: 85,
      coverage: 45.5,
      dealCount: 5,
      managerCount: 2,
    },
  })

  const patternFailure1 = await prisma.pattern.create({
    data: {
      tenantId: tenant.id,
      type: "FAILURE",
      title: "Игнорирование вопросов о цене",
      description: "Менеджер уходит от прямого ответа на вопросы о стоимости, откладывает ценовое предложение. Клиент теряет доверие и уходит к конкуренту с прозрачным ценообразованием.",
      strength: 14,
      impact: -73.3,
      reliability: 75,
      coverage: 0,
      dealCount: 6,
      managerCount: 2,
    },
  })

  const patternFailure2 = await prisma.pattern.create({
    data: {
      tenantId: tenant.id,
      type: "FAILURE",
      title: "Медленный ответ и пассивный follow-up",
      description: "Время ответа менеджера превышает 2 часа, follow-up отсутствует или формален. Клиент чувствует незаинтересованность и обращается к конкурентам.",
      strength: 28,
      impact: -52.1,
      reliability: 68,
      coverage: 33.3,
      dealCount: 9,
      managerCount: 3,
    },
  })

  console.log("  Patterns: 4 created")

  // === DEAL-PATTERN LINKS ===
  // Link success patterns to WON deals
  await prisma.dealPattern.createMany({
    data: [
      { dealId: dealAlina1.id, patternId: patternSuccess1.id },
      { dealId: dealAlina1.id, patternId: patternSuccess2.id },
      { dealId: createdEkatDeals[0].id, patternId: patternSuccess1.id },
      { dealId: createdEkatDeals[1].id, patternId: patternSuccess1.id },
      { dealId: createdEkatDeals[2].id, patternId: patternSuccess2.id },
      { dealId: dealMadina1.id, patternId: patternSuccess1.id },
      // Link failure patterns to LOST deals
      { dealId: dealMadina2.id, patternId: patternFailure1.id },
      { dealId: dealMadina2.id, patternId: patternFailure2.id },
      { dealId: createdEkatDeals[5].id, patternId: patternFailure1.id },
      { dealId: createdEkatDeals[5].id, patternId: patternFailure2.id },
      { dealId: createdEkatDeals[6].id, patternId: patternFailure2.id },
      { dealId: createdEkatDeals[7].id, patternId: patternFailure2.id },
    ],
  })

  console.log("  Deal-pattern links: 12 created")

  // === INSIGHTS ===
  await prisma.insight.create({
    data: {
      tenantId: tenant.id,
      type: "SUCCESS_INSIGHT",
      title: "Кастомизация предложения увеличивает конверсию на 83%",
      content: "В 8 из 11 успешных сделок менеджер адаптировал предложение под конкретные задачи клиента.",
      detailedDescription:
        "Анализ 52 сделок показал: когда менеджер предлагает кастомную конфигурацию вместо стандартного прайс-листа, конверсия вырастает с 28% до 83%. Ключевой момент — адаптация происходит на этапе квалификации, а не после отправки КП. Менеджеры, которые задают уточняющие вопросы о задачах клиента (объём производства, специфика использования, бюджет), закрывают в 2.9 раза больше сделок.",
      dealIds: [dealAlina1.id, createdEkatDeals[0].id, createdEkatDeals[1].id, createdEkatDeals[2].id, dealMadina1.id],
      managerIds: [alina.id, ekaterina.id, madina.id],
      quotes: [
        { text: "Могу предложить адаптировать конфигурацию под ваши задачи", dealCrmId: "D-101" },
        { text: "Подготовлю тарифную сетку по вашим маршрутам", dealCrmId: "D-201" },
      ],
    },
  })

  await prisma.insight.create({
    data: {
      tenantId: tenant.id,
      type: "SUCCESS_INSIGHT",
      title: "Предложение образцов ускоряет закрытие сделки в 1.6 раза",
      content: "В 5 из 11 успешных сделок менеджер проактивно предложил образцы или пилотный проект.",
      detailedDescription:
        "Предложение образцов без запроса клиента снижает средний цикл сделки с 142 до 89 дней. Работает особенно эффективно в сегментах медицинского оборудования и промышленных расходников. Важно: образцы предлагаются на этапе презентации, до отправки КП — это создаёт доверие и даёт клиенту тактильный опыт с продуктом.",
      dealIds: [dealAlina1.id, createdEkatDeals[2].id, dealMadina1.id],
      managerIds: [alina.id, ekaterina.id],
      quotes: [
        { text: "Также можем организовать образцы для тестирования", dealCrmId: "D-101" },
      ],
    },
  })

  await prisma.insight.create({
    data: {
      tenantId: tenant.id,
      type: "FAILURE_INSIGHT",
      title: "Игнорирование вопросов о цене приводит к потере 73% сделок",
      content: "В 6 из 9 проигранных сделок менеджер уклонялся от прямого ответа на вопросы о стоимости.",
      detailedDescription:
        "Когда клиент спрашивает о цене, а менеджер отвечает «уточню» или «вернусь позже», вероятность потери сделки возрастает до 73%. Средний клиент ждёт ответ о цене не более 1 часа. После 2 часов ожидания 60% клиентов начинают искать альтернативы. Решение: подготовить прайс-листы на типовые позиции и дать менеджерам полномочия называть ориентировочные цены сразу.",
      dealIds: [dealMadina2.id, createdEkatDeals[5].id, createdEkatDeals[6].id],
      managerIds: [madina.id, ekaterina.id],
      quotes: [
        { text: "По скидкам вернусь позже", dealCrmId: "D-206" },
        { text: "Сейчас уточню наличие, вернусь с ответом", dealCrmId: "D-104" },
      ],
    },
  })

  await prisma.insight.create({
    data: {
      tenantId: tenant.id,
      type: "FAILURE_INSIGHT",
      title: "Время ответа >2ч снижает конверсию на 52%",
      content: "В 9 из 19 проигранных сделок среднее время ответа менеджера превышало 2 часа.",
      detailedDescription:
        "Анализ времени ответа по 52 сделкам показал прямую корреляцию: при ответе до 30 минут конверсия 67%, 30-120 минут — 41%, свыше 120 минут — 15%. Особенно критично на этапах «Квалификация» и «КП», когда клиент активно сравнивает поставщиков. Рекомендация: установить уведомления при отсутствии ответа более 30 минут, внедрить шаблоны быстрых ответов.",
      dealIds: [dealMadina2.id, createdEkatDeals[5].id, createdEkatDeals[6].id, createdEkatDeals[7].id, createdEkatDeals[8].id],
      managerIds: [madina.id, ekaterina.id],
      quotes: [
        { text: "Слишком долго ждать, нашли другого поставщика", dealCrmId: "D-206" },
        { text: "Сроки вышли, мы подали с другим поставщиком", dealCrmId: "D-208" },
        { text: "Мы уже нашли другого поставщика", dealCrmId: "D-104" },
      ],
    },
  })

  console.log("  Insights: 4 created")

  // === QUALITY CONTROL: SCRIPT ===
  const script = await prisma.script.create({
    data: {
      tenantId: tenant.id,
      name: "Скрипт входящего звонка B2B",
      category: "incoming",
      isActive: true,
    },
  })

  const scriptItemsData = [
    { text: "Представиться по имени и назвать компанию", weight: 1.0, isCritical: true, order: 1 },
    { text: "Выявить потребность клиента", weight: 1.5, isCritical: false, order: 2 },
    { text: "Назвать примерный ценовой диапазон", weight: 2.0, isCritical: true, order: 3 },
    { text: "Предложить отправить образцы", weight: 1.0, isCritical: false, order: 4 },
    { text: "Обозначить следующий шаг", weight: 1.5, isCritical: true, order: 5 },
    { text: "Уточнить сроки принятия решения", weight: 1.0, isCritical: false, order: 6 },
    { text: "Предложить удобный способ связи", weight: 0.5, isCritical: false, order: 7 },
    { text: "Поблагодарить за обращение", weight: 0.5, isCritical: false, order: 8 },
  ]

  const scriptItems: Array<{ id: string; weight: number; isCritical: boolean }> = []
  for (const item of scriptItemsData) {
    const created = await prisma.scriptItem.create({
      data: { scriptId: script.id, ...item },
    })
    scriptItems.push({ id: created.id, weight: item.weight, isCritical: item.isCritical })
  }
  console.log("  Script:", script.name, "with", scriptItems.length, "items")

  // === QUALITY CONTROL: CALL RECORDS ===
  const callRecordsData = [
    {
      managerId: alina.id,
      clientName: "Виктор Петров",
      clientPhone: "+7 (495) 123-45-67",
      direction: "INCOMING" as const,
      category: "incoming",
      duration: 340,
      transcript: `Менеджер: Добрый день, компания Рассвет, Алина, слушаю вас.
Клиент: Здравствуйте, меня зовут Виктор Петров, компания ТехноГрупп. Нас интересует промышленное оборудование.
Менеджер: Виктор, очень приятно. Подскажите, какой тип оборудования вас интересует и для каких задач?
Клиент: Нужны станки для резки металла, планируем запускать новый цех.
Менеджер: Понял. По вашим задачам оптимальный вариант — линейка XR-500, ценовой диапазон от 280 до 400 тысяч за единицу.
Клиент: Хорошо, а можно посмотреть образцы?
Менеджер: Конечно, могу организовать демонстрацию на нашем складе. Давайте договоримся о дате — когда вам удобно на следующей неделе?
Клиент: Среда подойдёт.
Менеджер: Отлично, записала. Вам удобнее связаться по телефону или в мессенджере?
Клиент: В Телеграме лучше.
Менеджер: Хорошо, напишу вам подтверждение. Спасибо за обращение, Виктор!`,
      // Score: 85% — missed item 6 (сроки принятия решения)
      scorePercent: 85,
      itemsDone: [true, true, true, true, true, false, true, true],
      aiComments: [
        "Чётко представилась и назвала компанию",
        "Задала правильный вопрос о задачах",
        "Назвала конкретный ценовой диапазон",
        "Предложила демонстрацию образцов",
        "Назначила конкретную дату встречи",
        "Не уточнила сроки принятия решения по закупке",
        "Спросила об удобном способе связи",
        "Вежливо поблагодарила за обращение",
      ],
      tags: ["хорошая квалификация", "отличная работа с возражениями"],
    },
    {
      managerId: alina.id,
      clientName: "Ольга Сидорова",
      clientPhone: "+7 (495) 234-56-78",
      direction: "OUTGOING" as const,
      category: "outgoing",
      duration: 420,
      transcript: `Менеджер: Добрый день, Ольга! Это Алина из компании Рассвет. Звоню уточнить по вашей заявке на расходные материалы.
Клиент: Да, здравствуйте. Мы оставляли заявку на прошлой неделе.
Менеджер: Верно. Подскажите, какой объём вам нужен и как часто планируете заказывать?
Клиент: Примерно 200 единиц в месяц, на постоянной основе.
Менеджер: Отлично. При таком объёме стоимость будет в диапазоне 15-20 тысяч за партию, плюс есть скидка при годовом контракте.
Клиент: Интересно, а образцы можете прислать?
Менеджер: Да, отправим образцы курьером завтра. Следующий шаг — после тестирования обсудим условия контракта. Когда планируете принять решение?
Клиент: В течение двух недель.
Менеджер: Хорошо, я свяжусь с вами через неделю. Удобнее по телефону или на почту написать?
Клиент: По почте.
Менеджер: Договорились. Благодарю за уделённое время, Ольга!`,
      scorePercent: 92,
      itemsDone: [true, true, true, true, true, true, true, true],
      aiComments: [
        "Представилась по имени и назвала компанию",
        "Детально выяснила потребность: объём и периодичность",
        "Назвала ценовой диапазон и упомянула скидку",
        "Согласилась отправить образцы",
        "Чётко обозначила следующий шаг — обсуждение контракта",
        "Уточнила сроки принятия решения — 2 недели",
        "Спросила удобный способ связи",
        "Поблагодарила за время",
      ],
      tags: ["образцовый звонок", "отличная работа с возражениями"],
    },
    {
      managerId: alina.id,
      clientName: "Дмитрий Козлов",
      clientPhone: "+7 (495) 345-67-89",
      direction: "INCOMING" as const,
      category: "incoming",
      duration: 280,
      transcript: `Менеджер: Рассвет, Алина, добрый день!
Клиент: Здравствуйте, Дмитрий Козлов, МедТех. Нужна консультация по оборудованию.
Менеджер: Дмитрий, рада слышать. Расскажите, что именно вас интересует?
Клиент: Автоклавы для стерилизации. Сколько стоят ваши модели?
Менеджер: У нас есть несколько вариантов от 180 до 350 тысяч. Зависит от объёма камеры и функционала.
Клиент: Нужен средний вариант.
Менеджер: Тогда рекомендую модель AC-200 за 245 тысяч. Могу отправить подробное описание. Когда планируете закупку?
Клиент: В этом квартале точно.
Менеджер: Понял. Давайте я подготовлю КП и вышлю вам. Спасибо за звонок!`,
      scorePercent: 78,
      itemsDone: [true, true, true, false, true, true, false, true],
      aiComments: [
        "Представилась, назвала компанию",
        "Выяснила потребность клиента",
        "Назвала ценовой диапазон и конкретную модель",
        "Не предложила образцы или демонстрацию",
        "Обозначила следующий шаг — подготовка КП",
        "Уточнила сроки — в этом квартале",
        "Не предложила удобный способ связи",
        "Поблагодарила за звонок",
      ],
      tags: ["не предложил образцы"],
    },
    {
      managerId: ekaterina.id,
      clientName: "Андрей Волков",
      clientPhone: "+7 (495) 456-78-90",
      direction: "INCOMING" as const,
      category: "incoming",
      duration: 180,
      transcript: `Менеджер: Алло, слушаю.
Клиент: Здравствуйте, это Андрей Волков из НефтеХим. Мне нужна информация по катализаторам.
Менеджер: Да, что именно нужно?
Клиент: Цены и сроки поставки на 500 кг.
Менеджер: Я сейчас не могу сказать точную цену, нужно уточнить. Перезвоню.
Клиент: Когда?
Менеджер: Сегодня-завтра.
Клиент: Ладно, жду.`,
      scorePercent: 45,
      itemsDone: [false, false, false, false, false, false, false, false],
      aiComments: [
        "Не представилась по имени и не назвала компанию",
        "Не выявила потребность — только зафиксировала запрос",
        "Не назвала даже примерный ценовой диапазон",
        "Не предложила образцы",
        "Не обозначила конкретный следующий шаг",
        "Не уточнила сроки принятия решения",
        "Не предложила удобный способ связи",
        "Не поблагодарила за обращение",
      ],
      tags: ["не озвучил цену", "нет приветствия", "критический звонок"],
    },
    {
      managerId: ekaterina.id,
      clientName: "Марина Белова",
      clientPhone: "+7 (495) 567-89-01",
      direction: "OUTGOING" as const,
      category: "outgoing",
      duration: 240,
      transcript: `Менеджер: Добрый день, Марина. Звоню из Рассвета по поводу вашего запроса.
Клиент: Да, здравствуйте. Мы запрашивали КП на оборудование для склада.
Менеджер: Да, помню. КП пока не готово, но скоро будет.
Клиент: Сколько ждать? У нас сроки горят.
Менеджер: Постараюсь на этой неделе отправить.
Клиент: А хотя бы примерно — сколько это будет стоить?
Менеджер: Точно пока сказать не могу, зависит от конфигурации.
Клиент: Ну хотя бы вилку назовите.
Менеджер: Ориентировочно от 500 тысяч. Пришлю точные цифры в КП.
Клиент: Хорошо, жду.`,
      scorePercent: 52,
      itemsDone: [true, false, true, false, true, false, false, false],
      aiComments: [
        "Представилась и назвала компанию",
        "Не выявила потребность — клиент сам напоминал о запросе",
        "Назвала цену только после настойчивой просьбы клиента",
        "Не предложила образцы или демонстрацию",
        "Обозначила следующий шаг — отправка КП",
        "Не уточнила сроки принятия решения",
        "Не предложила удобный способ связи",
        "Не поблагодарила за уделённое время",
      ],
      tags: ["не озвучил цену", "пассивная коммуникация"],
    },
  ]

  const createdCallRecords = []
  for (const cr of callRecordsData) {
    const record = await prisma.callRecord.create({
      data: {
        tenantId: tenant.id,
        managerId: cr.managerId,
        clientName: cr.clientName,
        clientPhone: cr.clientPhone,
        direction: cr.direction,
        category: cr.category,
        duration: cr.duration,
        transcript: cr.transcript,
        createdAt: daysAgo(Math.floor(Math.random() * 14) + 1),
      },
    })
    createdCallRecords.push({ record, meta: cr })
  }
  console.log("  CallRecords:", createdCallRecords.length, "created")

  // === QUALITY CONTROL: CALL SCORES + ITEMS + TAGS ===
  for (const { record, meta } of createdCallRecords) {
    const callScore = await prisma.callScore.create({
      data: {
        callRecordId: record.id,
        scriptId: script.id,
        totalScore: meta.scorePercent,
      },
    })

    for (let i = 0; i < scriptItems.length; i++) {
      await prisma.callScoreItem.create({
        data: {
          callScoreId: callScore.id,
          scriptItemId: scriptItems[i].id,
          isDone: meta.itemsDone[i],
          aiComment: meta.aiComments[i],
        },
      })
    }

    for (const tag of meta.tags) {
      await prisma.callTag.create({
        data: {
          callRecordId: record.id,
          tag,
        },
      })
    }
  }
  console.log("  CallScores + CallScoreItems + CallTags: created for all records")

  console.log("\nSeeding complete!")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
