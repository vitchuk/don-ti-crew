# План реализации: MCP-сервер проектного контекста

Спецификация: [spec.md](spec.md). Задачи: [tasks.md](tasks.md).

## Подход

1. **Пакет** `services/mcp-server` (имя пакета `@don-ti/mcp-server`) в pnpm-workspace (ADR-0001). Сборка `tsc` → `dist/index.js` (ESM, NodeNext). Точка запуска — Node 22 LTS: `node ./services/mcp-server/dist/index.js`.
2. **Слои.** Адаптеры (чистые функции над `child_process.spawn` / fs) → реестр инструментов (zod-схемы аргументов + краткие описания) → bootstrap `McpServer` из `@modelcontextprotocol/sdk` с `StdioServerTransport`.
3. **Git** — только чтение, через `spawn` 'git' с массивом аргументов (без shell, Windows-safe: `-z`/NUL-разделители). Рабочая директория процесса сервера = корень репо; на старте проверяется наличие `.git` (иначе лог в stderr и exit 1).
4. **knowledge-зависимость** — через интерфейс `DocSearch` (см. Контракты), реализация подключается из `@don-ti/knowledge` (спека 003). До готовности 003 в тестах подставляется заглушка — это снимает жёсткую последовательность спек (только при сборке финальной версии пакет добавляется в зависимостях).
5. **Регистрация в OpenCode.** Файл `opencode.json` в корне репо, ключ `mcp`, локальный сервер. Формат подтверждён по документации https://opencode.ai/docs/mcp-servers/ (раздел «Local»: `type: "local"`, `command: string[]`, `cwd`, `environment`, `enabled`, `timeout`; варианты `.mcp.json` OpenCode не использует — в спеке фиксируется только `opencode.json`).

## Компоненты и файлы

| Файл | Назначение |
|---|---|
| `package.json` (root) | создаётся в M-001: private, `packageManager: "pnpm@10"`, workspace-скрипты |
| `pnpm-workspace.yaml` | packages: `apps/*`, `services/*` |
| `tsconfig.base.json` | общий строгий TS-конфиг (ESM, NodeNext, strict) |
| `.gitignore` | `node_modules/`, `dist/`, `.data/`, `coverage/` |
| `opencode.json` | регистрация MCP-сервера `don-ti-crew` (см. Контракты) |
| `services/mcp-server/package.json` | deps: `@modelcontextprotocol/sdk`, `zod`, `@don-ti/knowledge`; dev: `typescript`, `vitest` |
| `services/mcp-server/tsconfig.json` | extends base, outDir `dist` |
| `src/index.ts` | bootstrap: check `.git`, регистрация семи инструментов, `StdioServerTransport` |
| `src/lib/spawn.ts` | безопасный запуск `git` (массив аргументов, cwd, без shell), Windows-safe |
| `src/lib/truncate.ts` | утилиты обрезки (строки diff, символы excerpt с границей слова/пробела) |
| `src/adapters/git.ts` | `getCurrentBranch`, `gitStatus`, `getLastCommit`, `gitDiff` |
| `src/adapters/files.ts` | `listFiles` (с учётом `.gitignore` и исключений) |
| `src/adapters/docs.ts` | `searchProjectDocs` → вызов `DocSearch`, перевод ошибок knowledge в однофразовые сообщения |
| `src/tools/registry.ts` | zod-схемы аргументов, короткие описания, обёртка ошибок → `isError` |
| `tests/fixtures/mockRepo.ts` | создание мок-репо: `git init`, коммит, мутации рабочего дерева |
| `tests/unit/*.test.ts` | unit-тесты адаптеров на мок-репо |
| `tests/contract/tools.test.ts` | контракт-тесты ответов инструментов через `InMemoryTransport` SDK |

## Контракты (точные сигнатуры)

Источник истины — FR-2 спецификации; ниже их TypeScript-выражения (все имена — РОВНО как в спеке):

```ts
// Ответы инструментов (JSON-сериализуемые, без лишних полей)
type GetCurrentBranchResult = { branch: string };
type GitStatusResult = {
  clean: boolean;
  changes: { file: string; state: string }[]; // state: added|modified|deleted|renamed|untracked|conflict
  truncated: boolean;                          // режется при > 200 изменений (решение plan.md)
};
type GitDiffResult = { diff: string; totalLines: number; truncated: boolean };
type ListFilesResult = { files: { path: string; bytes: number }[]; truncated: boolean };
type GetContextResult = {
  branch: string;
  clean: boolean;
  changedFiles: { file: string; state: string }[];
  lastCommit: { sha: string; message: string; date: string }; // ISO 8601
  truncated: boolean; // true, если изменившихся файлов > 200 и список усечён
};
type SearchProjectDocsResult = {
  results: { file: string; heading?: string; excerpt: string; score: number }[];
  total: number;
};

// Адаптеры
function getCurrentBranch(): GetCurrentBranchResult;
function gitStatus(opts?: { maxChanges?: number /* default 200 */ }): GitStatusResult;
function getLastCommit(): GetContextResult['lastCommit']; // git log -1
function gitDiff(args: { target?: string; base?: string; head?: string; maxLines?: number /* default 400 */ }): GitDiffResult;
function changedFiles(args: { base: string; head: string }): { files: { path: string; state: string }[]; truncated: boolean };
function listFiles(args: { path?: string; limit?: number /* default 500 */ }): ListFilesResult;

// Знания: внедряемый интерфейс (реализация @don-ti/knowledge, спека 003)
interface DocSearchArgs { query: string; k?: number; type?: 'readme'|'docs'|'specs'|'adr'|'code'|'config' }
type DocSearch = (args: DocSearchArgs) => Promise<SearchProjectDocsResult>;
// Реализация из knowledge (подключается в src/adapters/docs.ts):
// import { query } from '@don-ti/knowledge' → query(text, { k, type })
```

Zod-схемы аргументов инструментов (реестр):

```ts
// Ref-аргументы не являются git-опциями: без ведущего `-` и пробелов
const refArg = z.string().min(1).regex(/^[A-Za-z0-9._~^/,+-]+$/, 'invalid ref');
const gitDiffArgs   = z.object({
  target: refArg.optional(),
  base: refArg.optional(),
  head: refArg.optional(),
  maxLines: z.number().int().min(1).max(4000).default(400),
}).refine(v => !(v.target && (v.base !== undefined || v.head !== undefined)), 'target и base/head взаимоисключимы');
const changedFilesArgs = z.object({ base: refArg, head: refArg });
const listFilesArgs = z.object({ path: z.string().min(1).optional(), limit: z.number().int().min(1).max(2000).default(500) });
const searchArgs    = z.object({
  query: z.string().min(1),
  k: z.number().int().min(1).max(5).default(3),
  type: z.enum(['readme','docs','specs','adr','code','config']).optional(),
});
// get_current_branch, git_status, get_context — без аргументов (z.object({}))
```

Тексты описаний инструментов (короткие, NFR-1) — фиксируются в реестре:

- `get_current_branch` — «Имя текущей ветки git.»
- `git_status` — «Статус рабочего дерева: чисто или список изменений.»
- `git_diff` — «Diff рабочего дерева против HEAD (или цели ref) либо между merge-base(base, head) и head; не более maxLines строк.»
- `changed_files` — «Файлы, изменённые между merge-base(base, head) и head, со статусами.»
- `list_files` — «Файлы репо с размерами; игнор .gitignore и служебных каталогов.»
- `get_context` — «Ветка, статус, изменённые файлы и последний коммит одним вызовом.»
- `search_project_docs` — «Поиск по индексу знаний проекта.»

Карта XY → state (`git status --porcelain -z`): `A`/`??` → untracked/added (`??` → untracked; `A` → added), `M` → modified, `D` → deleted, `R` → renamed, `UU/AA/DD` → conflict.

Регистрация в OpenCode (`opencode.json`, формат согласно документации от 2026-10):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "don-ti-crew": {
      "type": "local",
      "command": ["node", "./services/mcp-server/dist/index.js"],
      "cwd": ".",
      "enabled": true,
      "environment": { "KNOWLEDGE_DB": ".data/knowledge.db" }
    }
  }
}
```

Команда выполняется OpenCode с `cwd` рабочей области; сервер сам считает корнем репо свой cwd (см. Подход, п. 3).

## Модель данных

Собственного хранилища нет: все ответы формируются in-memory из вывода git и fs. Персистентное состояние единственное — БД **индекса знаний** (`.data/knowledge.db`), доступ к которой получает knowledge-пакет через env `KNOWLEDGE_DB` (схема данных — спека 003).

## Тест-план

1. **Unit (vitest), мок-репо** (`tests/fixtures/mockRepo.ts`: `git init -b main`, локальные `user.name/user.email` через `-c`-флаги, один коммит, сценарии мутаций):
   - чистое дерево → `git_status { clean: true }`; `get_current_branch { branch: 'main' }`;
   - изменён/добавлен/удалён/untracked → корректные `state` (AC-2), unborn-HEAD (репо без коммитов) — branch определяется, `git_diff` возвращает `{ diff: '', totalLines: 0, truncated: false }`;
   - `git_diff`: лимит строк `maxLines` (400 по умолчанию), `totalLines` полного diff, `truncated`, кастомный `target` (имя ветки/SHA); режим `base`/`head`: два коммита в ветке `feature` → diff только их, `changed_files { base, head }` → статусы added/modified (AC-11); ref с ведущим `-` (`--output=x`) → ошибка валидации, файл не создаётся (AC-12); `target` вместе с `base` → ошибка валидации;
   - `list_files`: `bytes`, реальные размеры; `.gitignore`-файлы и `node_modules`/`dist`/`.data`/`.git` исключены; `limit` / `truncated`; подфильтр `path`; попытка `path` вне репо (`..`) → валидационная ошибка;
   - `git log -1` → `lastCommit` корректен.
2. **Контракт-тесты (InMemoryTransport из SDK):** соединение клиент↔сервер в памяти; для каждого инструмента — точная структура ответа (ключи и типы из FR-2), дефолты аргументов (400/500/3), применение лимитов, поля `truncated`, `excerpt` ≤ 500; invalid arguments → `isError: true` (AC-10); процесс продолжает отвечать после ошибок.
3. **Search-ошибки (заглушка DocSearch):** отсутствие индекса и недоступность Ollama возвращают текст ровно из одного предложения (AC-7).
4. **Ручные проверки:** OpenCode smoke (AC-8) — инструменты видны и отвечают; связка с реальным knowledge (`pnpm rag:index` → `search_project_docs`) — после реализации спеки 003 (отдельный smoke-лист у 003/005).
5. **CI:** unit + contract-suite не требуют ни сети, ни Ollama, ни реального `git config` глобального (флаги `-c`); Windows-раннер валидирует кроссплатформенность.
