# План реализации: spec 005 — CI и AI Code Review

Реализация под [spec.md](spec.md). Порядок: workflows → CLI `services/review` → docs/dev → MANUAL-шаги владельца → ручной проверочный PR (QA). Никакой производственный код вне перечисленных ниже компонентов не создаётся.

## Подход

1. **Разделение контуров.** Облачный runner не знает про модели (быстрый lint/test/build; Ollama ему недоступна — ADR-0006); всё, что связано с эмбеддингами и LLM, живёт на Self-hosted runner'е в двух workflow (`rag-index.yml`, `ai-review.yml`).
2. **Толстый CLI — тонкий workflow.** Вся логика ревью в CLI `services/review`: он получил фактический base/head, собрал diff + список изменённых файлов (соглашения контракта MCP-инструментов спеки 002: `git_diff`, `list_files`), запросил RAG-контекст (`knowledge.query`, спека 003, k = 2..5) и вызвал `deepseek-chat` (ADR-0005). Workflow только актуализирует Индекс знаний, запускает CLI и публикует комментарий (`github-script`). CLI **не знает про GitHub API** — легко тестируется локально и в unit-тестах.
3. **Non-blocking по конструкции.** (a) `ai-review` не требуется как required check; (b) шаг `review:run` помечен `continue-on-error: true`, а шаг публикации выполняется с `if: always()` — при любой ошибке CLI публикуется короткий комментарий о сбое, job остаётся зелёным (FR-5, FR-9, ADR-0007).
4. **Один комментарий.** Идемпотентность через якорь `<!-- ai-review-comment -->` в теле: `github-script` ищет его среди комментариев PR и делает update, иначе create (FR-4). Дубли исключены; при `synchronize` устаревший прогон отменяет `concurrency` (FR-3).
5. **Индекс знаний — машинный актив.** Путь БД задаётся только окружением раннера (`KNOWLEDGE_DB`, вне workspace): инкремент по хешу файла (спека 003) переживает чекауты. Guard — **шаг workflow**, не CLI: шаг `rag:index` для `rag-index.yml`/`ai-review.yml` начинается с проверки `KNOWLEDGE_DB` (пусто → fail-fast с подсказкой настроить окружение раннера; NFR-5/FR-2); локальная разработка knowledge работает со своим дефолтом `.data/knowledge.db` (спека 003 FR-8).
6. **Секрет.** `DEEPSEEK_API_KEY` объявлен только в env шага `review:run` (`${{ secrets.DEEPSEEK_API_KEY }}`); на машину раннера ключ не выкладывается (FR-7).
7. **Безопасность self-hosted.** Репо приватное/owner-only: на runner'е крутится только код этого репозитория. Прогоны от `pull_request` из форков на Self-hosted runner по умолчанию не попадают (политика репозитория; секреты форкам недоступны) — документируется и проверяется в чек-листах (FR-8).
8. **Предусловия (координационные, вне объёма T-задач этой спеки):**
   - корневой pnpm-воркспейс со скриптами `lint`, `test`, `build`, `rag:index` и полем `packageManager` (скелет ADR-0001, спеки 001–004);
   - соглашения контракта `git_diff`/`list_files` (спека 002, в разработке): имена инструментов/параметров могут уточняться при её финализации — задача ревьюера проверить сверку (задача R-01);
   - `services/knowledge` с `knowledge.query` (спека 003) доступен как workspace-зависимость.
   Если на момент реализации что-то отсутствует — не молча копировать чужую зону ответственности, а согласовать (правило «не модифицировать несвязанное»).
9. **Риски и меры:**
   - review CLI — MCP-интеграция: spawn `services/mcp-server` (SDK `StdioClientTransport`), инструменты `git_diff { base, head }` / `changed_files` / `search_project_docs` (FR-6); в unit-тестах — mock MCP-сессия (как в спеке 004);
   - `rag:index` на PR временно «подмешивает» документацию PR в общий индекс машины; следующий push в `main` инкрементом это выправляет (для MVP приемлемо, фиксируется в `docs/dev/ci.md` как известное поведение);
   - большой diff может вылезти за 15 мин / бюджет токенов → лимиты усечения в CLI (см. Контракты) + Инкремент обычно быстрый;
   - очередь при выключенной машине → таймауты job'ов, ручная отмена, ручной `pnpm rag:index` (FR-9);
   - на Windows-раннере дефолтный shell — pwsh: все `run`-шаги формулируются кросс-платформенно (команды через pnpm-скрипты и переменные окружения, без bash-специфики).

## Компоненты и файлы

| Файл / пакет | Назначение | Владелец задачи |
|---|---|---|
| `.github/workflows/ci.yml` | CI на облачном runner'е | T-01 |
| `.github/workflows/rag-index.yml` | Инкрементальная Индексация на self-hosted | T-02 |
| `.github/workflows/ai-review.yml` | AI Code Review + публикация комментария | T-03 |
| `services/review/` (пакет `@don-ti/review`) | Review CLI (MCP-клиент): diff/файлы, RAG-контекст, LLM, markdown | T-04…T-07 |
| корневой `package.json` | скрипт `review:run` (апгрейд существующего воркспейса) | T-07 |
| `docs/dev/self-hosted-runner.md` | установка runner на Windows + чек-лист | T-08 |
| `docs/dev/secrets.md` | добавление `DEEPSEEK_API_KEY` | T-09 |
| `docs/dev/ci.md` | обзор workflow + «если всё повисло/упало» + label `ai-review` | T-10 |
| MANUAL-действия владельца | runner, секрет, label | M-01…M-03 |

### 1. `.github/workflows/ci.yml` — полная сигнатура job'а

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  verify:
    name: lint · test · build
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Enable pnpm (corepack)
        run: corepack enable
      - name: Node 22 LTS (pnpm cache)
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'
      - name: Install
        run: pnpm install --frozen-lockfile
      - name: Lint (eslint)
        run: pnpm lint
      - name: Test (vitest)
        run: pnpm test
      - name: Build (клиент) + typecheck (сервисы)
        run: pnpm build
```

Примечания: порядок `corepack enable` до `setup-node` с `cache: 'pnpm'` обязателен (кэш вызывает `pnpm store path`); версия pnpm берётся из поля `packageManager` корневого `package.json`.

### 2. `.github/workflows/rag-index.yml` — полная сигнатура job'а

```yaml
name: Rag Index
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
jobs:
  index:
    name: Индексация (self-hosted, инкремент)
    runs-on: self-hosted
    timeout-minutes: 10
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Enable pnpm (corepack)
        run: corepack enable
      - name: Node 22 LTS
        uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Install
        run: pnpm install --frozen-lockfile
      - name: RAG-индексация
        run: pnpm rag:index
        # KNOWLEDGE_DB задаётся в окружении машины-раннера (M-02), Ollama запущена на машине;
        # workflow путь не хардкодит; отсутствие переменной = быстрый failure (AC-8)
```

### 3. `.github/workflows/ai-review.yml` — полная сигнатура job'а

```yaml
name: AI Review
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
  pull-requests: write
concurrency:
  group: ai-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true
jobs:
  review:
    name: AI Code Review (self-hosted, non-blocking)
    runs-on: self-hosted
    timeout-minutes: 15
    steps:
      - name: Checkout (полная история для merge-base)
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Enable pnpm (corepack)
        run: corepack enable
      - name: Node 22 LTS
        uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Install
        run: pnpm install --frozen-lockfile
      - name: Актуализировать индекс знаний по PR
        run: pnpm rag:index
      - name: Review CLI
        id: review
        continue-on-error: true
        env:
          DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
        run: >
          pnpm review:run
          --base ${{ github.event.pull_request.base.sha }}
          --head ${{ github.event.pull_request.head.sha }}
          --out "$env:RUNNER_TEMP/ai-review.md"
      - name: Публикация комментария (upsert)
        if: always()
        uses: actions/github-script@v7
        env:
          REVIEW_FILE: ${{ runner.temp }}/ai-review.md
          REVIEW_OK: ${{ steps.review.outcome == 'success' }}
        with:
          script: |
            // 1. ПРОЧИТАТЬ: если REVIEW_OK = 'true' и fs.readFileSync(REVIEW_FILE) удался —
            //    тело = содержимое файла; иначе тело = короткий текст сбоя
            //    («⚠️ AI Code Review не выполнен: см. логи job review»).
            // 2. ЯКОРЬ: префикс '<!-- ai-review-comment -->'.
            // 3. UPSERT: github.rest.issues.listComments({ issue_number }) → найти
            //    комментарий с якорем → updateComment, иначе createComment.
            // 4. LABEL: github.rest.issues.addLabels({ issue_number, labels: ['ai-review'] })
            //    в try/catch (отсутствие label не уронит публикацию; label создаётся M-01).
            // 5. В логи ключ/секрет не выводятся.
```

### 4. Пакет `services/review` (`@don-ti-crew/review`)

```
services/review/
  package.json        # pnpm workspace-пакет; scripts: build (tsc -b), test (vitest), review:run
  tsconfig.json
  src/
    cli.ts            # точка входа: разбор аргументов/exit-кодов, оркестрация
    collect.ts        # gitDiff(...) + listChangedFiles(...) — соглашения спеки 002
    context.ts        # ragContext(...) — группы областей → knowledge.query (k: 2..5)
    llm.ts            # askDeepSeek(...) — HTTPS к api.deepseek.com, модель deepseek-chat
    prompt.ts         # buildPrompt(...) — системный промпт + diff + контекст
    render.ts         # renderFindings(...) / renderNoFindings() / renderFailure() → markdown
  test/               # vitest: cli, collect (temp git fixture), render, prompt, llm (mock)
```

Ключевые сигнатуры модулей (для developer'а, не финальный код):

```ts
// collect.ts — повторяет соглашения git_diff / list_files спецификации 002
export interface ChangedFile { path: string; status: 'added'|'modified'|'renamed'|'deleted' }
export async function gitDiff(from: string, to: string): Promise<string>;        // merge-base(from,to)..to
export async function listChangedFiles(base: string, head: string): Promise<ChangedFile[]>;
// context.ts — контракт knowledge.query спецификации 003
export async function ragContext(files: ChunkedFile[], k: number): Promise<CitedFragment[]>;
// llm.ts
export async function askDeepSeek(prompt: string, apiKey: string): Promise<string>;
// cli.ts
export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<ExitCode>;
```

Группировка «изменённых областей» для RAG: по первым двум уровням пути изменённых файлов (`apps/*`, `services/*`, `docs/*`, `specs/*`, корень); для каждой области — 1..2 запроса (путь области + ключевые слова имён/заголовков изменённых файлов), k по умолчанию 3, зажимается в 2..5; суммарный контекстный бюджет ~40 КБ текста — при превышении области отсекаются в порядке приоритета (docs/specs/ADR первыми: из Цитат модель сверяет архитектурные несоответствия с ADR/спеками, FR-6).

### 5. Корневой `package.json` (дополнение существующего)

```json
{
  "scripts": {
    "review:run": "pnpm -C services/review build && node services/review/dist/cli.js"
  }
}
```

Форма допускает замену на `pnpm --filter @don-ti/review …` — важно лишь, что `pnpm review:run --base … --head … [--out …]` работает с корня (FR-6) и аргументы пробрасываются дословно (`pnpm run` передаёт хвост argv как есть после `--`, либо оставить проброс argv в пакетном скрипте).

### 6. `docs/dev/*` (содержание, сокращённо — полное тело пишут задачи T-08…T-10)

- `self-hosted-runner.md`: разделы «Предпосылки» (Windows x64, Git, Node 22 LTS, corepack/pnpm, Ollama с моделью qwen3-embedding, включённая машина) → «Регистрация» (порядок: Settings → Actions → Runners → New self-hosted runner → Windows x64 → скачать/распаковать → `./config.cmd --url https://github.com/vitchuk/don-ti-crew --token …` → `./svc.cmd install && ./svc.cmd start`) → «Окружение» (env `KNOWLEDGE_DB` — стабильный путь вне workspace, напр. `C:\runner\knowledge\knowledge.db`; Ollama в списке автозапуска) → «Безопасность» (FR-8: только код данного репо; PR из форков по умолчанию не выполняются на self-hosted; секреты форкам недоступны) → «Чек-лист работоспособности» (runner 'Idle' в UI; ручной `workflow_dispatch` rag-index; файл БД появился по пути; повторный прогон быстрее; тест-PR с ai-review — комментарий появился).
- `secrets.md`: Settings → Secrets and variables → Actions → New repository secret → имя `DEEPSEEK_API_KEY`; предупреждение: ключ не в `.env` репо и не в workflow-файле; форковые PR ключа не получают; ротация — просто отредактировать secret.
- `ci.md`: таблица трёх workflow (триггеры/раннер/таймаут/выход); раздел «Если всё повисло/упало» (job ждёт в очереди — включить машину/сервис `actions.runner.*` либо отменить вручную; Индекс устарел — ручной `pnpm rag:index`; ошибка ревью — открыть логи job `review`, пересмотреть secret; merge блокировать ai-review запрещено — не делать required check); раздел «Подготовка репо» (создать label `ai-review`, MANUAL M-01); напоминание про Windows pwsh.

## Контракты CLI review

### Интерфейс команды

```
pnpm review:run --base <ref> --head <ref> [--out <файл>]

  --base   обязательный. Git ref/sha базовой стороны (в workflow: github.event.pull_request.base.sha)
  --head   обязательный. Git ref/sha головной стороны (в workflow: github.event.pull_request.head.sha)
  --out    необязательный. Путь markdown-файла отчёта. Если не задан — отчёт пишется в stdout.
```

### Семантика

1. Валидация: оба ref существуют (`git rev-parse`) иначе exit 1 с подсказкой; среда: `DEEPSEEK_API_KEY` обязателен к моменту вызова LLM (без ключа — exit 3, до GitHub ничего не постит).
2. Сбор данных (соглашения спеки 002): `gitDiff(base, head)` — unified diff между merge-base(`base`,`head`) и `head` (три точки — чужие коммиты base в diff не попадают); `listChangedFiles(base, head)` — статус A/M/D/R; бинарные файлы и генерируемые lock-файлы исключаются из diff; diff усекается до ~150 КБ с явной пометкой «усечено».
3. RAG-контекст (соглашение спеки 003): области изменённых файлов → `knowledge.query` k=3 (допустимо 2..5 константой), Цитаты формат «файл · заголовок».
4. LLM: системный промпт `buildPrompt` фиксирует: роль ревьюера; уровни Critical/High/Medium/Low и что к ним относить; ориентиры (баги / архит. несоответствия против ADR+спек из контекста / безопасность / отсутствие тестов); извлечение Находки строго `{severity, file, line?, message, recommendation}` (контракт модели данных из architecture.md); запрет ссылаться на код, которого нет в diff/контексте; при отсутствии находок — явная фраза «Находок нет» отдельной частью отчёта; ответ запрашивается строго в разметке, которую умеет парсить `render.ts` (устойчивый разбор: неизвестный уровень → Low + пометка).
5. Выход: markdown-файл (только отчёт, без якоря — якорь добавляет публикатор); `stdout` — краткая сводка (число Находок/Critical…Low/путь файла); при ошибке — причина на stderr.

### Коды выхода

| Код | Значение |
|---|---|
| 0 | отчёт готов (включая «Находок нет») |
| 1 | ошибка аргументов/окружения (несуществующий ref, git недоступен) |
| 2 | ошибка сбора данных: git-сбой, пустой diff, недоступность Ollama/индекса |
| 3 | ошибка LLM: нет `DEEPSEEK_API_KEY`, сеть/HTTP/API (один retry с таймаутом ~60 с, без молчаливых зависаний) |

Workflow трактует любой ненулевой код одинаково: `continue-on-error` → шаг публикации печатает короткий «сбой ревью» (AC-6), job зелёный (FR-5/FR-9).

### Формат отчёта (тело без якоря; якорь добавляет публикатор)

```markdown
## 🔍 AI Code Review
**base** `<sha>` → **head** `<sha>` · модель `deepseek-chat` · раннер self-hosted

### Сводка: Critical 0 · High 1 · Medium 2 · Low 1
_Нон-блокирующее ревью: решает человек (ADR-0007). Контекст: спеки/ADR из Индекса знаний._

### High — `apps/client/src/timer.ts:42`
**Описание:** …
**Рекомендация:** …

### Medium — `services/review/src/cli.ts`
…
```

Отсутствие находок → явная фраза «Находок нет» отдельной строкой (FR-6/AC-5); короткий комментарий сбоя (публикатор):

```markdown
<!-- ai-review-comment -->
## ⚠️ AI Code Review не выполнен
Ревью не завершено из-за сбоя (код выхода `3`). Подробности в логах job `review`. Merge не блокируется.
```

## Отклонения, согласованные при реализации (rev. 2026-10-15)

- Self-hosted workflows включают шаг «адресный build» (`pnpm --filter @don-ti/knowledge --filter @don-ti/mcp-server --filter @don-ti/review run build`) после install — иначе `rag:index`/review-CLI без `dist/` (вне git) падают на чистом клоне; не включая client/vite (экономия бюджета NFR-2). Отражено в `docs/dev/ci.md`.
- Diff в CLI: `git_diff maxLines = 4000` (cap MCP) + символьный кап 150 КБ; hunks по exclude-файлам (lock/бинарные) выкалываются из diff до передачи в LLM (спека «исключаются из diff» реализована в CLI, MCP-контракт diff не фильтрует).
- Отчёт содержит секцию «Опора на знания (цитаты)» (≤10 записей `file — heading`, без excerpt) — детализация NFR-3.
- Публикация комментария: пагинация listComments (все страницы), выбор последнего якорного по id — единственный upsert гарантируется и при >100 комментариях PR.
- Корневой `review:run`: форма `pnpm -C services/review build && node dist/cli.js` — сохраняет exit-коды 0/1/2/3 (pnpm recursive-run коллапсирует их в 1).
- LLM: 402/429 — retryable с сообщением о лимитах/оплате; fail-fast: конфиг LLM проверяется до RAG-запросов.
- Env-проброс в spawned mcp-server: `KNOWLEDGE_DB` + `OLLAMA_BASE_URL` (если задан).
- Пометка в отчёте при `changed_files.truncated` (cap 200).
- `actionlint` в среде разработчика недоступен — парсинг js-yaml + ручная сверка; официальная проверка — первый прогон CI.

## Тест-план

### Статическая проверка YAML

- **actionlint** — целевой инструмент проверки `.github/workflows/*.yml`. Установка без новых npm-зависимостей в репо: скачать готовый исполнимый файл из GitHub releases `rhysd/actionlint` или запустить через Docker `docker run --rm -v "%cd%:/repo" -w /repo rhysd/actionlint:latest -color`. Итог на QA-01: `actionlint` отработал по всем трём файлам без замечаний (шаблоны `${{ }}`, тайминги, concurrency-выражения проверяются им). Как повторно проверить — приложение в `docs/dev/ci.md`.

### Юнит-тесты (vitest, попадают в облачный `ci.yml`)

| Область | Кейс | Ожидание |
|---|---|---|
| `cli.ts` | нет `--base`/`--head`, ref не существует | exit 1, сообщение |
| `cli.ts` | без `DEEPSEEK_API_KEY`, до LLM | exit 3, сообщение |
| `collect.ts` | temp git-репо: добавление/изменение/переименование/удаление; бинарный и lock-файл | список статусов верен, diff без бинарных/lock |
| `context.ts` | заглушка `knowledge.query` по 3 областям | вызов ≤ areas, k=3 в базе 2..5, бюджет обрезает |
| `prompt.ts` | системные ограничения в тексте | уровни/запрет выдумывания кода/«находок нет»/отсутствие тестов |
| `render.ts` | Находки всех уровней; пустой список; «сбой» | сводка-порядок; явная фраза; якорь только у публикатора |
| `llm.ts` | mock fetch 200/4xx/таймаут | норм. разбор; exit 3; retry один |

### Ручной приёмочный PR (QA, qa-агент в поддержку)

Матрица, маппинг на AC:

| # | Действие | Проверяемый AC |
|---|---|---|
| QA-PR-1 | создать тестовую ветку, открыть PR | AC-1, AC-3 |
| QA-PR-2 | второй push в тот же PR | AC-4 (отмена + upsert без дубликатов) |
| QA-PR-3 | push в `main`, затем второй без изменений | AC-2 (инкремент по времени) |
| QA-PR-4 | временно сломать secret/переименовать Ref | AC-6 (сбой-комментарий, job зелёный, merge не заблокирован) |
| QA-PR-5 | остановить сервис runner'а, открыть PR | AC-7 (очередь без ошибки), затем включить/отменить |
| QA-PR-6 | снять `KNOWLEDGE_DB` с окружения раннера (кратко) | AC-8 (быстрый понятный failure) |
| QA-PR-7 | локальный `pnpm review:run` на тестовой ветке | AC-10 |
| QA-PR-8 | проверить, что метод защиты ветки не тронут | AC-11 |

Возврат состояния после QA-PR-4/QA-PR-6 (секрет/переменную восстановить) — обязательный шаг, отражён в tasks.md.

### Приёмка MANUAL-документации

По свежей машине пройти `docs/dev/self-hosted-runner.md` чек-листом (AC-9), секрет завести строго по `docs/dev/secrets.md`, label — по `docs/dev/ci.md`.
