# План реализации: Знания проекта — RAG-индексация и поиск

Спецификация: [spec.md](spec.md). Задачи: [tasks.md](tasks.md).

## Подход

1. **Пакет** `services/knowledge` (имя `@don-ti/knowledge`) в pnpm-workspace (ADR-0001). ESM, сборка `tsc` → `dist/`. Две точки входа: библиотечная `src/index.ts` (экспорт API для спек 002/004/005) и CLI `src/cli.ts` (бинарь в `package.json`).
2. **Dependency injection для эмбеддингов.** Определяется интерфейс `Embedder`; продакшн-реализация — `createOllamaEmbedder()` (Ollama, встроенный `fetch`); в тестах CI — `FakeEmbedder` (детерминированный вектор из хеша текста, dim = 8) и БД `:memory:` — без сети и Ollama.
3. **sqlite-vec через better-sqlite3**: расширение `sqlite-vec` грузится в существующее соединение; единственная виртуальная таблица `vec0` `chunks`, измерение (`float[dim]`) фиксировано при `CREATE`. Размерность берётся из первого батча эмбеддингов; `--force` и несовпадение размерности → `DROP` + пересоздание + полная переиндексация.
4. **Фильтр `type` без зависимости от возможностей конкретной версии sqlite-vec:** выборка top-k × 4 без фильтра по `file_type`, фильтрация в JS, усечение до `k` — устойчиво и просто. Расширенный фильтр в SQL — оптимизация на потом (вне объёма).
5. **Score:** sqlite-vec возвращает L2-дистанцию; `score = 1 / (1 + distance)` ∈ (0; 1], больше — лучше (контракт FR-10).
6. **Инкрементальность:** на прогоне — sha256 всех файлов из обхода (FR-3) → сравнение с таблицей → список changed/new/deleted → чанкование и эмбеддинги только changed/new → одна транзакция `DELETE` удалённых + `INSERT/UPSERT` пересчитанных (AC-11).
7. **Дефолты:** `k = 5` в библиотеке (MCP-инструмент спеки 002 накладывает свой дефолт 3), excerpt — первые ≤ 500 символов content с обрезкой до границы слова.

## Компоненты и файлы

| Файл | Назначение |
|---|---|
| `services/knowledge/package.json` | deps: `better-sqlite3`, `sqlite-vec`; dev: `typescript`, `vitest`; `bin`/scripts CLI |
| `services/knowledge/tsconfig.json` | extends базовый, outDir `dist` |
| `src/index.ts` | публичный экспорт API (FR-1): `index`, `query`, типы, `KnowledgeError` |
| `src/types.ts` | `FileType`, `Chunk`, `Embedder`, summary/response/error-типы (см. Контракты) |
| `src/walk.ts` | `collectFiles(repoRoot)`: список источников FR-3 с `file_type`; исключения FR-4 (уважает `.gitignore`; читает его сам, git-зависимость не нужна) |
| `src/chunker.ts` | `chunkMarkdown`, `chunkCode` (FR-6: ≤ 800 / ≤ 1200 символов, `headingPath`, разбиение по абзацам/крупным блокам) |
| `src/embeddings.ts` | `createOllamaEmbedder` (batch, `qwen3-embedding`, `OLLAMA_BASE_URL`), маппинг ошибок → `KnowledgeError` |
| `src/db.ts` | `openDatabase(dbPath)`: better-sqlite3 + загрузка sqlite-vec; `ensureSchema(dimension)`, детект несовпадения размерности |
| `src/indexer.ts` | `index(options)`: обход → sha256 → diff с БД → чанки → батчи эмбеддингов → транзакция записи; `IndexSummary` |
| `src/query.ts` | `query(text, options)`: эмбеддинг запроса → top-k (×4 при фильтре) → excerpt 500 → `score` = 1/(1+dist) |
| `src/cli.ts` | `index`/`query` команды, parse argv (FR-2), прогресс в stderr, коды выхода |
| `services/knowledge/README.md` | примеры API для потребителей; чек-лист проверки с реальным Ollama |
| root `package.json` + `.gitignore` | scripts `rag:index`/`rag:query` (делегирование с `--filter`), `.data/` уже в `.gitignore` (M-001 спеки 002) |

## Контракты (точные сигнатуры)

```ts
// src/types.ts
export type FileType = 'readme' | 'docs' | 'specs' | 'adr' | 'code' | 'config';

// эмбеддинги
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}
export function createOllamaEmbedder(opts?: {
  baseUrl?: string;   // http://localhost:11434 (env OLLAMA_BASE_URL)
  model?: string;     // 'qwen3-embedding'
  batchSize?: number; // 32
}): Embedder;

// чанкирование
export interface Chunk {
  filePath: string;      // POSIX-относительный, например docs/adr/0005-....md
  fileType: FileType;
  headingPath?: string;  // 'Спецификация > Сценарии', только markdown
  content: string;
}
export function chunkMarkdown(content: string, filePath: string): Chunk[];
export function chunkCode(content: string, filePath: string, fileType: FileType): Chunk[];

// индексация
export interface IndexerOptions {
  repoRoot?: string;  // cwd по умолчанию
  dbPath?: string;    // env KNOWLEDGE_DB (default .data/knowledge.db)
  embedder: Embedder; // инъекция (см. Подход, п. 2)
  force?: boolean;    // из CLI --force
}
export interface IndexSummary {
  filesTotal: number;
  filesIndexed: number;
  filesSkipped: number;  // без изменений
  filesDeleted: number;
  chunksUpserted: number;
  dimension: number;
}
export function index(options: IndexerOptions): Promise<IndexSummary>;

// поиск
export interface SearchHit { file: string; heading?: string; excerpt: string; score: number }
export interface SearchResponse { results: SearchHit[]; total: number }
export interface QueryOptions {
  k?: number;         // default 5
  type?: FileType;
  dbPath?: string;
  embedder?: Embedder; // default createOllamaEmbedder()
}
export function query(text: string, options?: QueryOptions): Promise<SearchResponse>;

// ошибки (FR-11, machine-readable)
export class KnowledgeError extends Error {
  code: 'NOT_INDEXED' | 'OLLAMA_UNAVAILABLE' | 'MODEL_NOT_FOUND' | 'DB_INCOMPATIBLE' | 'WALK_FAILED';
}
```

CLI:

```
knowledge index [--force]                       → итог в stderr, exit 0/1
knowledge query "<text>" [--k 5] [--type adr]   → печатная выдача находок, exit 0/1
```

Workspace-скрипты: `pnpm rag:index [--force]`, `pnpm rag:query "<текст>" [...]` (делегирование `pnpm --filter @don-ti/knowledge run index|query`, аргументы транслируются pnpm).

## Модель данных

Единственная таблица — виртуальная `vec0` (sqlite-vec), соответствует FR-8:

```sql
CREATE VIRTUAL TABLE chunks USING vec0(
  embedding   float[{dim}],  -- dimension из первого батча, НЕ хардкод
  file_path   TEXT NOT NULL,      -- POSIX-относительный
  file_type   TEXT NOT NULL,      -- 'readme'|'docs'|'specs'|'adr'|'code'|'config'
  heading_path TEXT,              -- 'Раздел > Подраздел', NULL для code/config
  content     TEXT NOT NULL,      -- текст фрагмента
  file_hash   TEXT NOT NULL       -- sha256 hex исходного файла
);
-- id = rowid виртуальной таблицы
```

Соответствие модели architecture.md (`IndexedChunk { id, filePath, fileType, headingPath, content, embedding, fileHash }`) сохранено. Поиск:

```sql
-- fetchK вычисляется в JS (k * 4) — overload для пост-фильтра file_type
SELECT c.rowid, c.file_path, c.heading_path, c.content, m.distance
FROM (SELECT rowid, distance FROM chunks WHERE embedding MATCH :queryVec AND k = :fetchK) m
JOIN chunks c ON c.rowid = m.rowid
ORDER BY m.distance;
-- score = 1 / (1 + distance); фильтр file_type — в JS; лишние строки отсекаются до k результатов
```

## Отклонения, согласованные при реализации (rev. 2026-10-15)

- sqlite-vec 0.1.9: metadata-колонки vec0 не принимают NULL → `heading_path` хранится как `''` (наружу `heading: undefined` отдаётся как было).
- `IndexSummary.dimensionChanged?: boolean` — добавленное поле (для AC-9/CLI-сообщения); при `--force` старая размерность читается из `user_version` до DROP.
- Probe-эмбеддинг `['knowledge dimension probe']` на прогоне без изменений — ловит смену размерности модели (отступ от «не гоняет Ollama вообще»; 1 текст, задокументировано).
- devDeps `@types/better-sqlite3`, `@types/node` (необходимы для tsc под NodeNext strict).
- В обходе индексируется только корневой `package.json` (FR-3 трактован «корневые конфиги»).
- Транзакции per-file + delete-before-insert (AC-11 без потерянных чанков); эмбеддинги батчатся внутри файла (≤32 текстов на HTTP-вызов).
- gitignore-парсер — только корневой `.gitignore` (FR-4 сужено: подкаталоговые `.gitignore`/`git ls-files` не используются; для данного репо эквивалентно, зафиксировано ревью).
- Гранулярность выборки: пер-файловые HTTP-батчи — потенциальное констан时间去 для больших репо (NFR-1 имеет запас ~10 мин; backlog — аккумулирование батчей между транзакциями).
- `total` в `SearchResponse` = `results.length`.
- Подсчёт dimension-чистый: сравнение `vector.length` с `user_version` до MATCH (fallback regex остался).
- **Корень репозитория и путь БД (исправление после первого живого прогона):** CLI при запуске через pnpm имеет cwd = `services/knowledge`; поэтому `index()` по умолчанию берёт корень репо (поиск `.git` вверх), а `resolveDbPath` резолвит относительный `KNOWLEDGE_DB`/`.data/knowledge.db` от корня репо, не от cwd. Абсолютные пути и `:memory:` — как есть.
- **Env `KNOWLEDGE_EMBED_MODEL`:** имя модели эмбеддингов настраивается (дефолт `qwen3-embedding`); тексты MODEL_NOT_FOUND/EMBED_FAILED используют фактическое имя. Текст `MODEL_NOT_FOUND` пропагируется через mcp-server (`translateKnowledgeError`/`translateDocsError` сохраняют динамическое имя для kind `model-not-found`, остальные kinds нормализуются к каноническому тексту).
- **Загрузка `.env`:** knowledge-CLI читает `.env` из корня репозитория (простейший парсер, без зависимостей); уже заданные переменные окружения приоритетнее.

## Тест-план

1. **Unit (vitest, CI без Ollama):** `FakeEmbedder` (детерминированный вектор dim = 8 из sha256 текста) + БД `:memory:`:
   - `walk`: fixtures-каталог — состав источников (FR-3), типы (FR-5), исключения `node_modules`/`dist`/`.data`/`.git` + `.gitignore` (FR-4);
   - `chunker`: markdown по заголовкам → `headingPath` « > », абзац > 800 → разбиение (AC-7), код > 1200 → блоки (AC-8), фрагмент ≤ 1200 остаётся целиком;
   - `indexer`: первый прогон (AC-1), повторный без изменений (0 пересчитанных), изменение 1 файла + удаление 1 (AC-2, подсчёт вызовов `Embedder`), `--force` (AC-3), несовпадение размерности (AC-9), целостность после прерывания (AC-11);
   - `query`: релевантность на фиксированных fixtures (правильный файл в top-k), фильтр `type` (AC-6), `excerpt` ≤ 500, `NOT_INDEXED` до первой индексации (AC-5).
2. **Контракт:** экспорты соответствуют Контрактам (типы тайпчекаются в тесте); потребители-обёртки спеки 002 ориентируются на эти же сигнатуры.
3. **Ручной сценарий с реальным Ollama** (self-hosted/local, чек-лист в `services/knowledge/README.md`): `pnpm rag:index` на этом репо (AC-1) → `pnpm rag:query` по 3–4 вопросам (AC-4) → `KNOWLEDGE_DB` вне репо (AC-10); время полной индексации < 10 мин (NFR-1).
4. **CI:** весь vitest-suite зелёный на Node 26 + Windows и на ubuntu без Ollama; нативные модули (`better-sqlite3`, `sqlite-vec`) валидируются сборкой и `:memory:`-тестами.
