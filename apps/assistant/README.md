# Помощник по проекту (`@don-ti/assistant`)

Web-интерфейс проекта, отвечающий на вопросы о репозитории на основе документации,
кода и проектного контекста. Спецификация: `specs/004-project-assistant/spec.md`.

## Запуск

```bash
pnpm install        # воркспейс целиком
pnpm rag:index      # построить индекс знаний (один раз и после больших правок)
pnpm assistant:dev  # UI + backend одним dev-сервером на localhost
```

Открыть URL, который напечатает Vite (обычно http://localhost:5173).

## Что нужно окружению

- Индекс знаний: `pnpm rag:index` (нужен запущенный Ollama с моделью
  `qwen3-embedding` — эмбеддинги считаются локально, см. ADR-0005).
- LLM: по умолчанию DeepSeek — задайте `DEEPSEEK_API_KEY`; либо офлайн-фолбэк
  `ASSISTANT_LLM=ollama` (модель `qwen3:1.7b`).
- MCP-сервер: `node ./services/mcp-server/dist/index.js`, сборка —
  `pnpm --filter @don-ti/mcp-server build` (Помощник спавнит его с cwd корня репо).

## Переменные окружения

Шаблон — [`apps/assistant/.env.example`](.env.example); значения читаются из
`apps/assistant/.env` и корневого `.env` (существующие переменные не перезаписываются, `.env` в `.gitignore`).

- `ASSISTANT_LLM` — `deepseek` (по умолчанию) | `ollama`.
- `DEEPSEEK_API_KEY` — ключ DeepSeek, только backend, в бандл не попадает.
- `DEEPSEEK_MODEL` — необязательно, по умолчанию `deepseek-chat`.
- `KNOWLEDGE_DB` — необязательно, путь к базе индекса (по умолчанию `.data/knowledge.db`).

## API (backend Hono, один порт с UI)

- `POST /api/ask {question}` → `{ answer, citations: [{file, heading?}], context: {branch, clean, changedFilesCount} }`
- `GET /api/health` → `{ status, llm: { provider, ready }, knowledge: { indexPresent } }`
- Ошибок нет «молча»: деградации возвращают `{ error: { code, message } }` —
  400 `invalid_question`, 422 `index_missing` («запустите pnpm rag:index»),
  502 `mcp_unavailable`, 503 `deepseek_key_missing` / `ollama_unavailable`, 500 `llm_error`.

История чата хранится локально в браузере (`localStorage`, ключ `assistant.chat.v1`,
последние 50 сообщений), кнопка «Новый вопрос» полностью сбрасывает чат.
