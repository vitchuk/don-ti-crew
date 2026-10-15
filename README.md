# don-ti-crew

Приложение для **совместных тренировок родителя и ребёнка** на одном экране с Tabata-таймером, плюс собственная **AI-инфраструктура проекта**: «Помощник по проекту» (`/help`), MCP-сервер проектного контекста, RAG-поиск по документации и коду, автоматический AI Code Review пулл-реквестов.

Проект ведётся по **SDD** (Specification Driven Development, см. `AGENTS.md`): требования фиксируются спецификациями, решения — ADR.

## Документация

| Что | Где |
|---|---|
| Архитектура системы | [docs/architecture.md](docs/architecture.md) |
| Принятые решения | [docs/adr/](docs/adr/) |
| Термины | [GLOSSARY.md](GLOSSARY.md) |
| Спецификации | [specs/](specs/) |

## Структура

```
apps/        клиент-тренировки (PWA), Помощник по проекту
services/    knowledge (RAG), mcp-server, review
specs/       SDD-спецификации: spec.md + plan.md + tasks.md
docs/        архитектура и ADR
```

## Разработка

pnpm-workspace, TypeScript. Команды появятся по мере реализации фаз (см. [specs](specs/)).
