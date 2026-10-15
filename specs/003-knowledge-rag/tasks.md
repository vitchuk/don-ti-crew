# Задачи: Знания проекта — RAG-индексация и поиск

Спецификация: [spec.md](spec.md) · План: [plan.md](plan.md).

| ID | Задача | Исполнитель | Артефакт | Готовность | Зависимости |
|----|--------|-------------|----------|------------|-------------|
| K-001 | Инициализация пакета `services/knowledge`: `package.json` (имя `@don-ti/knowledge`; deps `better-sqlite3`, `sqlite-vec`; dev `typescript`, `vitest`; скрипты CLI), `tsconfig.json` (extends base), заглушки `src/index.ts`, `src/types.ts` с базовыми типами | developer | Готовый к сборке пакет | `pnpm --filter @don-ti/knowledge build` и `test` проходят | M-001 (workspace спеки 002) |
| K-002 | Обход репо: `src/walk.ts` — состав FR-3, карта `file_type` FR-5 (приоритет adr > docs), исключения FR-4, чтение `.gitignore`, POSIX-пути; fixtures + unit-тесты | developer | `src/walk.ts`, `tests/fixtures/repo/`, `tests/unit/walk.test.ts` | Тесты: полный список источников и типов; `node_modules/dist/.data/.git` и gitignored отсутствуют | K-001 |
| K-003 | Чанкирование: `src/chunker.ts` — markdown по заголовкам (≤ 800, разбиение длинных абзацев), код ≤ 1200 целиком / блоки, `headingPath` « > »; unit-тесты | developer | `src/chunker.ts`, `tests/unit/chunker.test.ts` | Тесты AC-7, AC-8; путь и заголовок сохранены на каждом фрагменте | K-001 |
| K-004 | Хранилище: `src/db.ts` — better-sqlite3 + загрузка sqlite-vec, `ensureSchema(dimension)`, детект/пересоздание при несовпадении размерности; unit-тесты на `:memory:` | developer | `src/db.ts`, `tests/unit/db.test.ts` | Тесты: схема создаётся под dim 8; повторное открытие — без конфликтов; смена dim → пересоздание (база AC-9) | K-001 |
| K-005 | Эмбеддинги: интерфейс `Embedder`, `FakeEmbedder` (dim 8), `createOllamaEmbedder` (batch 32, `qwen3-embedding`, env `OLLAMA_BASE_URL`, встроенный `fetch`), маппинг → `KnowledgeError`; тесты с mock-сервером fetch | developer | `src/embeddings.ts`, `tests/unit/embeddings.test.ts` | Тесты: батч-запросы, размерность из ответа; ошибки OLLAMA_UNAVAILABLE / MODEL_NOT_FOUND — одно предложение | K-001 |
| K-006 | Отладочный CLI-скелет + `KnowledgeError`: `src/cli.ts` (parse argv, команды index/query, коды выхода, stderr) — каркас без логики индексации | developer | `src/cli.ts`, `tests/unit/cli.test.ts` | `knowledge query` без БД печатает ошибку «запустите `pnpm rag:index`» (AC-5, exit 1) | K-005 |
| K-007 | Индексатор: `src/indexer.ts` — sha256, diff с БД, чанки, батчи эмбеддингов, транзакция записи, `IndexSummary`, `--force`; unit-тесты (FakeEmbedder, подсчёт вызовов) | developer | `src/indexer.ts`, `tests/unit/indexer.test.ts` | Тесты AC-1, AC-2, AC-3, AC-9, AC-11 (на `:memory:`) | K-002…K-005 |
| K-008 | Поиск: `src/query.ts` — эмбеддинг запроса, top-k (×4 при фильтре + фильтр в JS), `score = 1/(1+dist)`, `excerpt` ≤ 500 с обрезкой по слову; unit-тесты | developer | `src/query.ts`, `tests/unit/query.test.ts` | Тесты: релевантность на fixtures, фильтр `type`, excerpt ≤ 500, `NOT_INDEXED` (AC-6, фрагменты AC-4/AC-5) | K-004, K-005, K-006 |
| K-009 | Публичный API и README пакета: экспорты `index`/`query`/типов, `services/knowledge/README.md` (примеры для 002/004/005, чек-лист ручной проверки с Ollama) | developer | `src/index.ts`, `services/knowledge/README.md` | Тайпчек-тест контракта; примеры компилируются | K-007, K-008 |
| K-010 | Workspace-интеграция: root-скрипты `rag:index`/`rag:query` (делегирование `--filter`), `.data/` в `.gitignore` (если ещё нет), передача аргументов `--force`/`--k`/`--type` | developer | Обновления root `package.json`, `.gitignore` | `pnpm rag:query "тест"` без БД работает и даёт подсказку; `pnpm rag:index --force` делает полный прогон (только после K-007) | K-006 |
| K-011 | Полный прогон unit/contract-набора CI (без Ollama), включая Windows-режим; отчёт о прохождении AC с фейковым эмбеддером | qa | Отчёт QA (vitest-run + матрица AC) | Все AC 1–11, автоматизируемые на FakeEmbedder, отмечены зелёными | K-010 |
| K-012 | Ручной сценарий с реальным Ollama (по чек-листу README): индексация этого репо, 3–4 отладочных запроса, время индексации < 10 мин, `KNOWLEDGE_DB` вне репо | qa | Чек-лист с фактическими результатами | AC-1, AC-4, AC-10 подтверждены локально (self-hosted) | K-010, Ollama с `qwen3-embedding` |
| K-013 | Проверка интеграции потребителя: mcp-server `search_project_docs` против реального `query()` (сквозной smoke со спекой 002) | qa | Smoke-заметки | AC-6 спеки 002 зелёный против реального индекса | K-012, M-008 |
| K-014 | Ревью: соответствие spec/plan, ADR-0005 (стек), приватность (NFR-2), отказ от лишних зависимостей, качество чанкирования | reviewer | Ревью-заметки | Замечания закрыты или отклонены с обоснованием | K-011, K-012 |

Примечания:

- K-002…K-005 независимы друг от друга (после K-001) и могут идти параллельно.
- Сценарии с настоящей Ollama (K-012, K-013) не блокируют CI-автоматизацию — они выполняются локально/self-hosted (ADR-0006).
