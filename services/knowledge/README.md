# @don-ti/knowledge

Библиотека RAG-индексации репозитория и сервис поиска по индексу знаний
(спека 003). Стек: Ollama `qwen3-embedding` + `better-sqlite3` + `sqlite-vec`
(ADR-0005). Имя модели переопределяется env `KNOWLEDGE_EMBED_MODEL` (например,
`qwen3-embedding:0.6b`, если модель установлена с тегом); базовый URL — `OLLAMA_BASE_URL`.

## Публичный API

```ts
import { index, query, KnowledgeError, FakeEmbedder } from '@don-ti/knowledge'

const summary = await index({
  repoRoot: process.env.REPO_ROOT,        // default — корень репо (поиск .git вверх)
  dbPath: process.env.KNOWLEDGE_DB,       // default .data/knowledge.db в корне репо
  embedder: createOllamaEmbedder(),       // или своя реализация Embedder
  force: false,                           // --force: полная переиндексация
})

const response = await query('как задаются раунды и циклы', {
  k: 5,
  type: 'docs',                           // readme|docs|specs|adr|code|config
}) // → { results: [{ file, heading?, excerpt, score }], total }
```

Потребители:
- mcp-server — инструмент `search_project_docs` (спека 002);
- backend Помощника (/help) — цитаты с файлом и заголовком (спека 004);
- review-CLI — контекст для ревью (спека 005).

## CLI

```
pnpm rag:index [--force]
pnpm rag:query "<текст>" [--k 5] [--type docs]
```

Итоги индексации и прогресс выводятся в stderr; ошибка — одно предложение,
exit-код 1. CLI читает `.env` из корня репо, а относительный путь БД и обход
репозитория считаются от корня (не от каталога пакета).

## Ошибки

`KnowledgeError.code` → `message` (экспортируются как `ERROR_MESSAGES`):

| code                 | message                                                                              |
|----------------------|--------------------------------------------------------------------------------------|
| `NOT_INDEXED`        | «Индекс знаний не построен — запустите `pnpm rag:index`.»                            |
| `OLLAMA_UNAVAILABLE` | «Ollama недоступна — запустите её на http://localhost:11434.»                        |
| `MODEL_NOT_FOUND`    | «Модель <имя> не найдена — запустите `ollama pull <имя>` или задайте KNOWLEDGE_EMBED_MODEL с фактическим тегом.» |
| `DB_INCOMPATIBLE`    | «Размерность эмбеддингов не совпадает с индексом — запустите `pnpm rag:index --force`.» |
| `EMBED_FAILED`       | «Сервис эмбеддингов вернул ошибку — проверьте Ollama и выбранную модель (KNOWLEDGE_EMBED_MODEL).»      |
| `WALK_FAILED`        | «Не удалось обойти источники индексации — проверьте доступность файлов репозитория.» |

## Тесты без Ollama

`FakeEmbedder` (детерминированные векторы dim 8 из sha256 токенов) + БД
`:memory:`, `KNOWLEDGE_FAKE_EMBEDDER=1` заставляет CLI использовать
FakeEmbedder.

## Чек-лист ручной проверки с Ollama (self-hosted, ADR-0006)

1. `ollama serve` (порт 11434) и `ollama pull qwen3-embedding` (либо укажите
   тег установленной модели в `.env`: `KNOWLEDGE_EMBED_MODEL=qwen3-embedding:0.6b`).
2. `pnpm install && pnpm --filter @don-ti/knowledge build`.
3. `pnpm rag:index` — файловая БД `.data/knowledge.db`; stderr-итоги: файлы,
   пересчитано, фрагменты, размерность.
4. Повторный `pnpm rag:index` — «пересчитано 0» (инкрементальность по sha256).
5. `pnpm rag:query "как хранится шаблон тренировки"` — top-k с file, heading,
   excerpt, score.
6. `KNOWLEDGE_DB="$TMPDIR/know.db" pnpm rag:index` — БД вне репо.
7. `pnpm rag:index --force` — полная переиндексация.
8. Остановка `ollama serve` и `pnpm rag:query ...` — одно предложение
   «Ollama недоступна…», exit 1.
