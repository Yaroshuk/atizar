# Дизайн: вертикальный срез «Inbox» на моках

- **Дата:** 2026-06-06
- **Статус:** на ревью
- **Автор:** Sergey + Claude

## 1. Контекст и цель

Гринфилд-проект: опенсорс-фреймворк для AI-инженеров, которые ставят агентные
автоматизации клиентам (разделение «режим разработчика» / «режим консьюмера»).
Заточка по умолчанию — обработка входящих потоков: письмо/заявка → квалификация
→ подтверждение человеком → действие.

Это **первый рабочий артефакт** — вертикальный срез сверху вниз на фейковых данных.
Цель: за один-два дня получить **живой кликабельный дашборд** и доказать, что
самый рискованный кусок стека (CopilotKit + AG-UI: стриминг, generative UI,
человек-в-контуре) работает end-to-end.

Подход выбран сознательно — **«максимально приближённо к реальному» (подход Б)**:
вся проводка настоящая (CopilotKit, AG-UI, Hono, Copilot Runtime), фейковый только
сам агент (заскриптованная лента событий, без настоящей модели).

## 2. Scope

### В срезе (делаем)

- Один экран — рабочий стол с одной карточкой агента «EMAIL AGENT».
- Закрытая карточка: имя, кнопка START, визуальный индикатор статуса.
- Открытая карточка (модалка): лента-чат с результатами работы агента.
- Фейковый агент, который по START стримит заскриптованную ленту событий.
- Generative UI: агент рисует карточку лида (`LeadCard`).
- Человек-в-контуре: пауза на подтверждение (`ApprovalDialog`), кнопка возобновляет.
- Настоящие CopilotKit + AG-UI + Hono + Copilot Runtime.

### НЕ в срезе (откладываем)

- Mastra / реальный агентный цикл / настоящая модель.
- Реальные интеграции (Gmail и т.п.), MCP.
- База данных, хранение настроек, разделение файл/DB.
- Авторизация, роли, RBAC, audit-log.
- Разбивка на пакеты `@platform/*` (вынесем позже, когда петля заработает).
- Реестр провайдеров, контракт `defineAgent`, визуальный редактор, режим 2/3
  в полном виде, автогенерация форм из Zod.

## 3. Стек среза

| Слой | Инструмент | Роль |
|---|---|---|
| Интерфейс | React + Vite | рисует карточку, ленту, кнопки; быстрый dev/hot-reload |
| Язык | TypeScript | типобезопасность |
| Сервер | Hono | тонкий BFF; монтирует Copilot Runtime |
| UI-агенты | `@copilotkit/react-core`, `@copilotkit/react-ui` | стриминг, generative UI, human-in-the-loop |
| Рантайм | `@copilotkit/runtime` (v2) | серверный слой CopilotKit |
| События | `@ag-ui/client` | типы событий AG-UI для фейкового агента |
| Стили | Tailwind CSS | аккуратный вид без возни |

Hono выбран осознанно: построен на Web-стандартах (fetch), поэтому
`createCopilotEndpoint` (fetch-обработчик) монтируется в него без адаптеров.
Сервер взаимозаменяем за тонким слоем — при желании заменяется на Express/Fastify
без переделки остального.

## 4. Структура файлов

Одно приложение, без разбивки на пакеты. Клиент и сервер запускаются вместе.

```
apps/inbox/
├── package.json                    # скрипт dev запускает клиент + сервер
├── client/                         # интерфейс (Vite + React)
│   └── src/
│       ├── main.tsx                # точка входа
│       ├── App.tsx                 # <CopilotKit> провайдер + рабочий стол
│       ├── actions.ts              # useCopilotAction: renderLead, confirmSend
│       └── components/
│           ├── AgentCard.tsx       # ЗАКРЫТАЯ карточка: имя, START, индикатор статуса
│           ├── AgentModal.tsx      # ОТКРЫТАЯ карточка: лента-чат
│           ├── LeadCard.tsx        # карточка лида (рисуется агентом через render)
│           └── ApprovalDialog.tsx  # окно подтверждения (renderAndWaitForResponse)
└── server/                         # тонкий сервер (Hono)
    ├── index.ts                    # Hono + CopilotRuntime, эндпоинт /api/copilotkit
    └── mock-agent.ts               # BuiltInAgent type:"custom", заскриптованная лента
```

## 5. Поток сигнала (петля)

```
менеджер жмёт START на AgentCard
  → клиент инициирует прогон агента на сервере (/api/copilotkit)
  → mock-agent (async generator) шлёт события AG-UI по порядку:
       1. TEXT_MESSAGE_CHUNK "Проверяю входящие…"   → лента; статус = "работает"
       2. TOOL_CALL (renderLead) {данные лида}        → CopilotKit рисует <LeadCard>
       3. TOOL_CALL (confirmSend) {…}                 → пауза, рисует <ApprovalDialog>,
                                                         статус = "жду подтверждения"
  → менеджер жмёт "Отправить" → respond() → агент продолжает
       4. TEXT_MESSAGE_CHUNK "Готово, ответ отправлен" → статус = "готово"
```

«Один run, два вида»: закрытая карточка и открытая модалка — два отображения одного
прогона. Статус-индикатор выводится из состояния прогона CopilotKit
(idle / работает / жду подтверждения / готово), лента целиком видна в модалке.

## 6. Модель статуса карточки

Закрытая карточка показывает один из статусов, выведенный из жизненного цикла прогона:

- `idle` — ничего не происходит (до START);
- `running` — идёт работа (после START, во время стрима, лоадер);
- `awaiting_approval` — отрисован `ApprovalDialog`, ждём нажатия;
- `done` — прогон завершён;
- `error` — ошибка (минимально, для полноты).

## 7. Фейковый агент (ключевая механика подхода Б)

Серверный кастомный агент CopilotKit — async generator, который yield-ит события
AG-UI без участия модели. Опорная форма (по доке CopilotKit v2):

```ts
import { EventType, type BaseEvent } from "@ag-ui/client";
import {
  CopilotRuntime, createCopilotEndpoint,
  InMemoryAgentRunner, BuiltInAgent,
} from "@copilotkit/runtime/v2";

const agent = new BuiltInAgent({
  type: "custom",
  factory: async function* ({ input, abortSignal }) {
    // 1) текст
    // 2) TOOL_CALL_START/ARGS/END → renderLead {данные лида}
    // 3) TOOL_CALL_START/ARGS/END → confirmSend {текст подтверждения}
    // 4) текст "готово" (после возобновления)
  },
});

const runtime = new CopilotRuntime({
  agents: { default: agent },
  runner: new InMemoryAgentRunner(),
});

const endpoint = createCopilotEndpoint({ runtime, basePath: "/api/copilotkit" });
// endpoint (fetch-обработчик) монтируется в Hono
```

Имена tool-call (`renderLead`, `confirmSend`) совпадают с именами действий
`useCopilotAction` на клиенте — так агент «вызывает» нужный компонент.

## 8. Generative UI и человек-в-контуре (клиент)

```ts
// renderLead → рисует карточку лида (generative UI)
useCopilotAction({
  name: "renderLead",
  render: ({ args }) => <LeadCard lead={args} />,
});

// confirmSend → пауза, ждём ответа менеджера (human-in-the-loop)
useCopilotAction({
  name: "confirmSend",
  renderAndWaitForResponse: ({ args, respond }) => (
    <ApprovalDialog data={args} onApprove={() => respond("approved")} />
  ),
});
```

Захардкоженный лид (пример данных), который шлёт агент:

```json
{ "id": 42, "from": "ivan@acme.ru", "subject": "Заказ 10 шт", "intent": "order" }
```

## 9. Критерий готовности (проверка)

Успех = руками прокликать всю петлю:

1. Открыл дашборд → видна карточка «EMAIL AGENT», статус `idle`.
2. Нажал START → статус `running`, в ленте появился текст «Проверяю входящие…».
3. Появилась карточка лида (`LeadCard`) с данными.
4. Появилось окно подтверждения (`ApprovalDialog`), статус `awaiting_approval`.
5. Нажал «Отправить» → агент дописал «Готово», статус `done`.

Автотесты для этого черновика не пишем. Компоненты держим чистыми и без лишних
зависимостей, чтобы их было легко покрыть тестами на следующих шагах.

## 10. Открытые вопросы / на потом

- Точная форма монтирования `createCopilotEndpoint` в Hono — уточняется на этапе кода.
- Как именно вывести статус карточки из состояния прогона CopilotKit (какие хуки) —
  уточняется на этапе кода.
- Версии пакетов CopilotKit/AG-UI фиксируются при установке.
- git-репозиторий ещё не инициализирован; коммит спецификации — по решению пользователя.
