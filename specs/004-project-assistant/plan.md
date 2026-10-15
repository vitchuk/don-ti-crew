# План реализации: Помощник по проекту (спека 004)

Реализует [spec.md](spec.md). Терминология — [GLOSSARY.md](../../GLOSSARY.md).

## Подход

**Backend — Hono.** Обоснование выбора против express:

- **Один dev-сервер (FR-1):** `@hono/vite-dev-server` подключает Hono-приложение прямо в dev-сервер Vite — UI (HMR) и `/api/*` живут на одном порту одной командой `pnpm assistant:dev`. С express понадобился бы proxy-конфиг Vite + отдельный процесс сервера — два процесса и рассинхрон портов.
- **TypeScript-first:** типизированные хендлеры и окружения из коробки; express требует отдельных типов (`@types/express`) и трясёт callback-модель.
- **Малый размер:** Hono — без внешних runtime-зависимостей, на web-стандартах `Request/Response` (Node 22 LTS их нативно поддерживает). Дерево зависимостей минимально — согласуется с NFR-5 и общим правилом «не вводить зависимости без обоснования».
- express: зрелый и известный, но тяжеловеснее и не даёт реального выигрыша для задачи из одного POST и одного GET.

**Единый LLM-клиент.** И DeepSeek (`https://api.deepseek.com`), и Ollama (`http://localhost:11434/v1`) дают OpenAI-совместимый endpoint `POST /chat/completions` — один клиент на оба провайдера, отличается только `baseUrl`, `model` и наличие `apiKey` (DeepSeek — из env; Ollama — без ключа) (FR-5, ADR-0005).

**MCP-клиент.** Готовый `@modelcontextprotocol/sdk` (`Client` + `StdioClientTransport`) — spawn `services/mcp-server` как дочерний stdio-процесс, вызовы MCP-инструментов `get_context` / `git_diff` по контрактам спеки 002. Не пишем JSON-RPC вручную. Дочерний процесс — долгоживущий: спавнится лениво при первом вопросе, переиспользуется (spawn на каждый вопрос добавил бы ~1–2 с latency, конфликт с NFR-1), перезапускается при падении.

**knowledge.query — прямой импорт.** Backend импортирует функцию поиска из `services/knowledge` (workspace-зависимость), минуя MCP: Помощник локален и уже имеет прямой доступ к библиотеке; MCP-путь зарезервирован для внешних AI-потребителей (OpenCode) — это соответствует архитектурной схеме (`A --> query() K` напрямую, `M --> K search_project_docs` для MCP).

**История в localStorage (FR-8) — обоснование.** Один пользователь, одна машина, требование «всё локально» (NFR-3) — синхронизации нет, значит IndexedDB (как у клиента) избыточен: ~5 МБ localStorage покрывают 50 сообщений с запасом более 100×, API проще в разы, service worker и Dexie для этого не нужны. Ограничение ~5 МБ при лимите 50 сообщений несущественно.

**Runtime-пайплайн одного вопроса:**

```
POST /api/ask
  → validate(question)                    400 при невалидном
  → changeDetector(question)?             FR-9: нужны ли diff
  → mcp.call('get_context')               branch, clean, changedFilesCount
       (+ mcp.call('git_diff', maxLines 200))
  → knowledge.query(question, k=4)        top-4 фрагмента знаний (спека 003)
  → buildPrompt(question, context, diff?, fragments)
  → llm.complete(messages)                deepseek | ollama (env ASSISTANT_LLM)
  → 200 { answer, citations: fragments→Citation[], context }
```

Ошибки окружения поднимаются как типизированные `AppError` с кодом и коротким сообщением на русском; маршрут переводит их в HTTP.

**Эвристика `git_diff` (FR-9, детерминированная):** вопрос в нижнем регистре проверяется на вхождение ключей: `diff`, стемы `изменени` (покрывает «изменения/изменилось/изменён»), `ветк` (покрывает «ветке/ветках»), отдельные слова `branch`, `commit`, `коммит`, `PR`, `merge`, `git`. Совпадение хотя бы одного → вызывается `git_diff(maxLines = 200)`. Тестовая матрица — в тест-плане.

## Компоненты и файлы

```
apps/assistant/
├── package.json                 # имя @don-ti/assistant, deps: hono, vue, @modelcontextprotocol/sdk,
│                                # @hono/vite-dev-server, vite, @vitejs/plugin-vue, vitest
├── tsconfig.json
├── vite.config.ts               # vue-плагин + @hono/vite-dev-server → backend/app.ts на /api/*
├── index.html
├── src/                         # frontend (Vue)
│   ├── main.ts
│   ├── App.vue                  # чат: список сообщений, ввод, кнопки
│   ├── components/MessageItem.vue   # вопрос/ответ/цитаты-пути
│   ├── api.ts                   # типизированные вызовы /api/ask, /api/health, маппинг кодов ошибок в тексты
│   ├── history.ts               # localStorage: load/save/clear, лимит 50 (FR-8)
│   └── types.ts                 # общие DTO — единый источник типов для обеих сторон
└── backend/
    ├── app.ts                   # Hono: /api/ask, /api/health, обработка AppError
    ├── validate.ts              # валидация question (trim, 1..2000) → invalid_question
    ├── orchestrate.ts           # пайплайн FR-3
    ├── changeDetector.ts        # эвристика FR-9: regexp изменений (см. ниже)
    ├── prompt.ts                # system-промпт + сборка, бюджеты NFR-2
    ├── errors.ts                # AppError, коды
    ├── llm.ts                   # клиент chat/completions (baseUrl/model/apiKey из env)
    ├── llmConfig.ts             # ASSISTANT_LLM=deepseek|ollama → baseUrl/model/проверка доступности
    ├── mcpClient.ts             # spawn + SDK-клиент, get_context/git_diff, таймауты, рестарт
    └── health.ts                # GET /api/health
```

Корневой `package.json`: скрипт `"assistant:dev": "pnpm --filter @don-ti/assistant dev"`. Workspace-зависимость на `@don-ti/knowledge` (workspace:*). Конвенция нейминга workspace-пакетов — `@don-ti/*` (единогласно в спеках 002/003/005, см. T-1, T-14).

`.gitignore` (корень, дополнение): `.env` уже/добавить; `apps/assistant/.env.example` — шаблон с `ASSISTANT_LLM=`, `DEEPSEEK_API_KEY=` (без значений).

## Контракты API (request/response DTO)

### POST /api/ask

Request:

```ts
// AskRequest
{ question: string }   // trim → 1..2000 символов, иначе 400
```

Response 200:

```ts
// AskAnswer
{
  answer: string,                  // полный ответ LLM (без стриминга)
  citations: Citation[],           // все фрагменты знаний из промпта (FR-4)
  context: GitContext
}

// Citation
{ file: string,                    // путь от корня репо, напр. "docs/adr/0004-mcp-single-context-provider.md"
  heading?: string }               // headingPath фрагмента, если есть

// GitContext
{ branch: string,                  // напр. "session-42"
  clean: boolean,                  // нет незакоммиченных изменений
  changedFilesCount: number }      // число изменённых файлов
```

Ошибки (тело `{ error: { code, message } }`, `message` — одна фраза на русском):

| HTTP | code | когда |
|---|---|---|
| 400 | `invalid_question` | пустой/длинный question (FR-2) |
| 422 | `index_missing` | нет индекса знаний → «запустите pnpm rag:index» (FR-6, AC-6) |
| 502 | `mcp_unavailable` | spawn/вызов mcp-server не удался (FR-6) |
| 503 | `deepseek_key_missing` | ключ не задан при ASSISTANT_LLM=deepseek (FR-6, AC-7) |
| 503 | `ollama_unavailable` | Ollama не отвечает при ASSISTANT_LLM=ollama (FR-6, AC-5) |
| 500 | `llm_error` | сетевой сбой/ошибка провайдера |

Порядок шагов пайплайна фиксирован (см. подход выше): mcp → query → LLM-вызов всегда последний; проверки доступностей по кодам таблицы в первую очередь: при отсутствии индекса (`index_missing`) LLM-вызова нет, при недоступности MCP — тоже (AC-6).

### GET /api/health

```ts
// HealthResponse (200 всегда; поля несут фактическое состояние)
{
  status: "ok",
  llm: { provider: "deepseek" | "ollama",
         ready: boolean },   // deepseek: ключ задан; ollama: ping GET /api/tags (localhost)
  knowledge: { indexPresent: boolean }
}
```

Проверки дешёвые (без боевых LLM-вызовов), чтобы health не стоил времени/токенов.

### Общие правила

- Пути в `citations.file` — относительные от корня репо, разделитель `/` (не кликабельные ссылки, FR-4).
- Все DTO определены один раз в `apps/assistant/src/types.ts` и импортируются обеими сторонами (frontend + backend) — контракт не расходится.

## Модель данных

Backend stateless (кроме долгоживущего MCP-процесса). Персистентность одна — frontend:

```ts
// ChatMessage (localStorage key: "assistant.chat.v1", JSON-массив)
{
  id: string,          // crypto.randomUUID()
  role: "user" | "assistant",
  text: string,        // вопрос или ответ
  citations?: Citation[],
  context?: GitContext,// только у role=assistant
  createdAt: string    // ISO 8601
}
```

Правила: длина массива ≤ 50 (старейшие отбрасываются, FR-8); сохранение после каждого сообщения; кнопка «новый вопрос» → `history.clear()` и пустой чат остаётся пустым после перезагрузки (AC-9). До 50 сообщений с цитатами объём ≪ 1 МБ — потолка localStorage не достигаем.

Промпт (в памяти на время запроса):

```
system: "Ты — Помощник по проекту don-ti-crew. Отвечай ТОЛЬКО на основе
         переданного контекста. Указывай пути файлов-цитат (relative path).
         Если контекста недостаточно — честно напиши «не нашёл в документации»."
user: [Вопрос] question
      [Контекст git] branch=…, clean=…, changedFiles=…   // ≤ 400 симв.
      (+ [Diff (до 200 строк)] при вопросе об изменениях)
      [Фрагменты знаний] 1..4 ×: file, heading, excerpt   // каждый ≤ 600 симв.
```

## Тест-план

Инструменты: vitest (unit + integration/e2e), `@vue/test-utils` для компонентов. Ручные проверки QA — на реальном окружении (Ollama + ключ DeepSeek) по AC.

**Unit (backend, node-env, без сети):**
1. `validate`: пустая строка, только пробелы, 2000/2001 символов → код `invalid_question`; корректный → проходит.
2. `changeDetector`: матрица вопросов — «что изменилось в ветке?» → diff; «как работает таймер?» → без diff; остальные ключи FR-9 по regexp из реализации.
3. `prompt`: сборка = system + вопрос + git-контекст ≤ 400 симв.; 4 отрывка каждый ≤ 600 и с file/heading; правило обрезки длинного фрагмента.
4. `llmConfig`: нет `ASSISTANT_LLM` → deepseek; `ASSISTANT_LLM=ollama` → ollama; недопустимое значение → ошибка конфигурации.
5. `llm`: mock fetch — 200 → текст; 401/нет ключа → `deepseek_key_missing`; connection refused (ollama) → `ollama_unavailable`; 5xx → `llm_error`.
6. `errors` → HTTP: AppError→status/тело (сопоставление с таблицей выше).

**Integration (backend, node-env, заглушки инъекцией зависимостей):**
7. `orchestrate` happy-path: fake MCP client + fake knowledge.query(k=4) + fake llm → answer, citations = все 4 фрагмента, context passthrough.
8. `orchestrate` + вопрос об изменениях → git_diff вызван и попал в промпт.
9. Отсутствие индекса (fake knowledge кидает `index_missing`) → AppError, llm НЕ вызван (AC-6).

**API e2e (app.request() Hono, без сети):**
10. `POST /api/ask` happy (заглушённые зависимости) → 200 c DTO; 400; 503-кейс с кодом ошибки.
11. `GET /api/health` → 200, поля отражают заглушенное состояние.

**Frontend (vitest + jsdom):**
12. `history`: save/load/лимит 50/restore на инициализации (FR-8, AC-9).
13. `api.ts`: маппинг каждого `code` ошибки в единую русскую фразу с инструкцией (FR-6).
14. `App.vue`: отправка вопроса рендерит обе пары user/assistant; «новый вопрос» очищает DOM и localStorage.

**QA, ручной прогон (реальное окружение):** AC-1..AC-11 из spec.md (вкл. p50-замер NFR-1 ≤ ~15 с и проверку отсутствия ключа в собранном бандле AC-10 — `grep` по `dist/assets/*.js`).

**Review-чеклист:** соответствие FR-1..FR-9 / NFR-1..NFR-5; ключ только на backend; Hono выбор соответствует выбранному подходу; MCP-контракты совпадают со спекой 002; `knowledge.query` подпись совпадает со спекой 003; нет зависимостей вне списка выше.
