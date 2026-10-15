# don-ti-crew

Приложение для **совместных тренировок родителя и ребёнка** на одном экране с Tabata-таймером, плюс собственная **AI-инфраструктура проекта**: «Помощник по проекту» (`/help`), MCP-сервер проектного контекста, RAG-поиск по документации и коду, автоматический AI Code Review для pull request.

Проект ведётся по **SDD** (Specification Driven Development, см. `AGENTS.md`): требования фиксируются спецификациями, решения — ADR.

## Документация

| Что | Где |
|---|---|
| Архитектура системы | [docs/architecture.md](docs/architecture.md) |
| Принятые решения | [docs/adr/](docs/adr/) |
| Термины | [GLOSSARY.md](GLOSSARY.md) |
| Спецификации | [specs/](specs/) |
| CI / runner / секреты | [docs/dev/](docs/dev/) |

## Структура

```
apps/client/       PWA: Tabata-таймер (Vue 3 + Vite + Dexie)
apps/assistant/    «Помощник по проекту»: Vue UI + Hono backend (pnpm assistant:dev)
services/knowledge/   RAG: indexer CLI + query() (qwen3-embedding через Ollama, sqlite-vec)
services/mcp-server/  MCP: 7 инструментов проектного контекста (stdio)
services/review/      AI Code Review CLI (MCP-клиент + DeepSeek)
```

## Разработка (pnpm workspace, TypeScript, Node 22 LTS)

```sh
pnpm install            # после клонирования
pnpm lint               # eslint
pnpm test               # все пакеты (vitest)
pnpm build              # все пакеты

pnpm dev                # клиент (или pnpm --filter @don-ti/client dev)
pnpm assistant:dev      # «Помощник по проекту» — UI + API одним dev-сервером

pnpm rag:index          # индексация репо (нужен Ollama; модель по умолчанию qwen3-embedding)
pnpm rag:query "..."    # отладочный поиск по индексу
pnpm review:run --base <ref> --head <ref> --out report.md   # локальный AI-ревью (нужен ключ DEEPSEEK_API_KEY)
```

Переменные окружения: скопируйте [`.env.example`](.env.example) в `.env` (корень репо).
Ключевые: `DEEPSEEK_API_KEY`, `ASSISTANT_LLM`, `KNOWLEDGE_EMBED_MODEL` (тег модели эмбеддингов, например `qwen3-embedding:0.6b`), `KNOWLEDGE_DB`, `OLLAMA_BASE_URL`; см. также `apps/assistant/.env.example`, `docs/dev/`.
