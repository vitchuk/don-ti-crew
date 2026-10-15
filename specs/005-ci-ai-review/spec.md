# Спецификация: CI и AI Code Review

Владелец контекста: `Automated Review` (см. [architecture.md](../../docs/architecture.md)). Статус: черновик.

## Цель

Автоматическая проверка и AI-ревью pull request'ов через GitHub Actions. Три workflow: `ci.yml` (облачный runner: lint, тесты, сборка — без локальных моделей), `rag-index.yml` (Self-hosted runner: Инкрементальное обновление Индекса знаний после push в `main`) и `ai-review.yml` (Self-hosted runner: AI Code Review — diff PR + RAG-контекст + DeepSeek → Находки одним обновляемым комментарием бота; non-blocking, ADR-0007). Установка runner'а и добавление секрета описаны пошаговой документацией для владельца (Windows). Решения зафиксированы в ADR-0004…0007.

## Сценарии использования

1. **CI на PR и push.** Разработчик пушит коммит в ветку и открывает PR — `ci.yml` на облачном runner'е прогоняет checkout → pnpm (Node 22 LTS, corepack) → install → lint (eslint) → test (vitest) → build (клиент + typecheck сервисов). Локальные модели не нужны: job проходит на любом GitHub-облаке.
2. **Актуальный Индекс знаний.** Разработчик мержит PR в `main` — `rag-index.yml` на Self-hosted runner'е выполняет Инкрементальную переиндексацию (`pnpm rag:index`) в стабильный путь вне workspace, поэтому Индекс знаний накапливается между прогонами, а не строится с нуля.
3. **AI-ревью PR.** Открыт PR (`opened`/`synchronize`/`reopened`) — `ai-review.yml` на Self-hosted runner'е обновляет Индекс знаний, CLI собирает diff + изменённые файлы + RAG-контекст, DeepSeek возвращает Находки, бот публикует **один** комментарий с якорем `<!-- ai-review-comment -->`, который обновляется при следующих push.
4. **Ошибка при ревью — не авария.** Из-за сбоя LLM или отсутствия ключа ревью не падает: публикуется короткий комментарий о сбое, workflow завершается успешно; merge PR не блокируется (workflow не required check).
5. **Раннер выключен.** Машина с Self-hosted runner офлайн: job остаётся в очереди и дожидается появления раннера (или отменяется вручную); страховки — `timeout-minutes` и ручной fallback `pnpm rag:index`.
6. **Локальный ручной прогон ревью.** Разработчик на своей машине запускает `pnpm review:run --base <ref> --head <ref> [--out <file>]` и читает markdown-отчёт; GitHub API из CLI не вызывается.
7. **Подключение инфраструктуры владельцем.** Владелец один раз выполняет MANUAL-шаги из `docs/dev/*`: ставит runner (Windows, как сервис), добавляет секрет `DEEPSEEK_API_KEY`, создаёт label `ai-review`.

## Требования

### Функциональные (FR)

- **FR-1.** Workflow `.github/workflows/ci.yml` — облачный runner `ubuntu-latest`; триггеры: `pull_request` и `push` в `main`. Шаги в порядке: checkout → pnpm через corepack (Node 22 LTS) → `pnpm install` → `pnpm lint` (eslint) → `pnpm test` (vitest) → `pnpm build` (сборка клиента + typecheck сервисов). Задача без локальных моделей: шагов с Ollama/эмбеддингами нет.
- **FR-2.** Workflow `.github/workflows/rag-index.yml` — Self-hosted runner; триггеры: `push` в `main` + `workflow_dispatch`; `timeout-minutes: 10`; шаги: checkout → `pnpm install` (`--frozen-lockfile`) → `pnpm rag:index`. Индекс знаний пишется в стабильный путь **вне** workspace через `env` `KNOWLEDGE_DB`, настроенный в окружении раннера, — инкремент выживает между прогонами.
- **FR-3.** Workflow `.github/workflows/ai-review.yml` — Self-hosted runner; триггеры: `pull_request` с типами `[opened, synchronize, reopened]`; `timeout-minutes: 15`; `concurrency` отменяет устаревший прогон по PR (группа по номеру PR, `cancel-in-progress: true`). Шаги: checkout с `fetch-depth: 0` → `pnpm install` (`--frozen-lockfile`) → `pnpm rag:index` (обновить Индекс знаний по состоянию PR) → `pnpm review:run --base <base-sha> --head <head-sha>` → публикация комментария через `actions/github-script`.
- **FR-4.** Комментарий ревью: `github-script` ищет существующий комментарий бота с якорем `<!-- ai-review-comment -->` и обновляет его, иначе создаёт (один комментарий на PR на любой момент — ADR-0007). Workflow проставляет label `ai-review` (label заведён заранее владельцем как MANUAL-шаг; невозможность проставить label не мешает публикации комментария).
- **FR-5.** Non-blocking: `ai-review` — не required check при защите ветки, не мешает merge при любом исходе (успех, сбой, таймаут).
- **FR-6.** Review CLI — пакет `services/review`, команда `pnpm review:run --base <ref> --head <ref> [--out <file>]`. CLI работает **MCP-клиентом** собственного MCP-сервера (spawn `services/mcp-server`, как backend Помощника, [спека 002](../002-mcp-server/)):
  - diff и список изменённых файлов — через MCP-инструменты `git_diff { base, head }` и `changed_files { base, head }` (контракт спеки 002);
  - RAG-контекст — через MCP-инструмент `search_project_docs`: для каждой изменённой области фокусный запрос (малое k, 2..5), фильтр `type` по уместности (specs/adr/docs/code), Цитаты: файл + заголовок;
  - промпт LLM (`deepseek-chat`, `env` `DEEPSEEK_API_KEY`): Находки по уровням Critical/High/Medium/Low; ориентация ревью: потенциальные баги; архитектурные несоответствия (сверка с ADR/спеками через переданный контекст); безопасность; отсутствие тестов;
  - каждая Находка: severity, файл, строка (если применимо), описание, рекомендация;
  - запрещено выдумывать несуществующий код — вывод строится только по фактическому diff и контексту из Индекса знаний;
  - если Находок нет — явно сказать «находок нет»;
  - вывод: markdown-файл (при `--out <file>`, иначе stdout); **CLI не постит в GitHub** — публикация только в workflow.
- **FR-7.** Секрет `DEEPSEEK_API_KEY` задаётся только как GitHub Actions secret и передаётся только шагу с `review:run`; в репозитории, логах и комментариях его быть не должно.
- **FR-8.** Безопасность Self-hosted runner: на нём выполняется только код данного репозитория; PR из форков по умолчанию **не выполняются** на Self-hosted runner'е — этот факт и остальные предостережения отмечены в `docs/dev/self-hosted-runner.md` и `docs/dev/ci.md`.
- **FR-9.** Отказоустойчивость:
  - раннер офлайн — job остаётся в очереди и не падает немедленно (практические лимиты ожидания: `timeout-minutes` с момента старта job'а и ручная отмена — см. `docs/dev/ci.md`);
  - workflow ревью не падает сам: ошибка LLM (или недоступность ключа) → короткий комментарий о сбое в PR, workflow успешен;
  - fallback переиндексации — ручной `pnpm rag:index`.
- **FR-10.** Каталог `docs/dev/`:
  - `docs/dev/self-hosted-runner.md` — пошаговая установка runner на Windows (GitHub Settings → Actions → Runners → New self-hosted runner; скачать, config, запуск как сервиса) + чек-лист проверки работоспособности;
  - `docs/dev/secrets.md` — как добавить `DEEPSEEK_API_KEY` (Settings → Secrets and variables → Actions);
  - `docs/dev/ci.md` — краткое описание всех трёх workflow и что делать, если всё повисло/упало (включая fallback переиндексации и подготовку репо: label `ai-review`).

### Нефункциональные (NFR)

- **NFR-1.** Наименьшие привилегии: `permissions` в каждом workflow минимальны (`ci.yml` и `rag-index.yml` — `contents: read`; `ai-review.yml` — `contents: read` + `pull-requests: write`); секрет передаётся единственному шагу.
- **NFR-2.** Бюджеты времени: `rag-index.yml` укладывается в 10 мин, `ai-review.yml` — в 15 мин (таймауты FR-2/FR-3 включая Инкрементальную Индексацию и вызовы LLM); `ci.yml` укладывается в ~15 мин на облаке.
- **NFR-3.** Читаемость результата: комментарий — единообразный markdown: якорь, заголовок, сводка по уровням Critical/High/Medium/Low (или явная фраза «Находок нет»), каждая Находка отдельным блоком (severity, файл:строка, описание, рекомендация), Цитаты контекста (файл + заголовок), футер с моделью и коммитами base/head.
- **NFR-4.** Идемпотентность: повторные прогоны не дублируют комментарии (один с якорем) и не пересчитывают неизменённые Фрагменты знаний (инкремент по хешу файла — спека 003).
- **NFR-5.** Понятные отказы: без `KNOWLEDGE_DB` (в CI) или без `DEEPSEEK_API_KEY` job/CLI завершаются быстро с сообщением, что именно настроить (проверяется по докам, без чтения кода).
- **NFR-6.** Внешние зависимости — только оправданные: официальные actions (`actions/checkout`, `actions/setup-node`, `actions/github-script`) и runtime-клиент DeepSeek, уже выбранный ADR-0005. Новых сервисов/серверов не появляется.

## Вне объёма

- Блокирующие защиты веток: `ai-review` никогда не включается как required check (требований «merge только при зелёном ревью» нет).
- Авто-исправления коммитами (autofix/format-commit из ревью).
- Проверка секретов сканерами (secret scanning, gitleaks и т.п.).
- Мульти-GitHub-среда (несколько раннеров, группы раннеров, матрицы, стейджинг).

## Критерии приёмки

- **AC-1.** Дано: открыт PR или push в `main`. Когда запускается `ci.yml`. Тогда job на `ubuntu-latest` выполняет шаги checkout → pnpm (Node 22 LTS, corepack) → install → lint → test → build (клиент + typecheck сервисов) и завершается успешно; на чистой ветке ни один шаг не требует Ollama/локальных моделей; падение lint/test/build красит прогон.
- **AC-2.** Дано: настроенный Self-hosted runner (чек-лист из `docs/dev/self-hosted-runner.md` пройден). Когда push в `main` или ручной `workflow_dispatch`. Тогда `rag-index.yml` завершается ≤ 10 мин, Индекс знаний обновлён по стабильному пути вне workspace; повторный прогон без изменений завершается существенно быстрее первого (инкремент).
- **AC-3.** Дано: открыт PR (`opened`). Когда `ai-review.yml` завершён. Тогда в PR есть **один** комментарий бота с якорем `<!-- ai-review-comment -->` (сводка + Находки либо явная фраза «Находок нет»), проставлен label `ai-review`, workflow зелёный, merge не заблокирован.
- **AC-4.** Дано: комментарий ревью от предыдущего прогона существует. Когда в тот же PR добавлен новый push. Тогда устаревший прогон отменён по `concurrency`, обновлён существующий комментарий (комментарий по-прежнему один, дублей нет).
- **AC-5.** Дано: diff без замечаний, LLM вернула пустой список Находок. Когда ревью опубликовано. Тогда комментарий явно содержит «Находок нет» (не молчание и не пустое тело).
- **AC-6.** Дано: `DEEPSEEK_API_KEY` отсутствует/невалиден или произошла ошибка LLM. Когда выполняется `ai-review.yml`. Тогда в PR появляется короткий комментарий о сбое, workflow завершается успешно, merge не блокирован; секрет не упомянут ни в логах, ни в комментарии.
- **AC-7.** Дано: Self-hosted runner выключен. Когда push в `main` или открытие PR. Тогда workflow отображается в состоянии очереди без ошибки; после включения раннера job выполняется до конца; либо владелец отменяет прогон вручную и/или делает ручной `pnpm rag:index` (fallback).
- **AC-8.** Дано: в окружении раннера `KNOWLEDGE_DB` не задан. Когда стартует job с `pnpm rag:index`. Тогда job падает быстро с понятным сообщением «что настроить» (по докам), при этом файл индекса в workspace не создаётся и не используется (иначе инкремент терялся бы между прогонами).
- **AC-9.** Дано: чистая машина с Windows. Когда владелец дословно выполняет `docs/dev/self-hosted-runner.md`. Тогда runner появляется в разделе Idle и чек-лист проверки работоспособности проходит (тестовый `workflow_dispatch` на `rag-index.yml` успешен).
- **AC-10.** Дано: локальный checkout репозитория с двумя ref'ами (base/head). Когда запущено `pnpm review:run --base <ref> --head <ref> --out <file>`. Тогда файл содержит markdown-отчёт (сводка/Находки/фраза «находок нет»), CLI не обращается к GitHub API; при несуществующем ref — ненулевой выход и понятное сообщение.
- **AC-11.** Дано: любой исход `ai-review` (успех, сбой, отмена). Когда проверены настройки защиты ветки и сам PR. Тогда `ai-review` не required check, решение об merge остаётся за человеком (ADR-0007).

## Ссылки

- `docs/adr/0004-mcp-single-context-provider.md` — MCP как единый провайдер проектного контекста для всех AI-потребителей (в т.ч. AI Code Review через соглашения контракта).
- `docs/adr/0005-rag-stack-ollama-sqlite-vec-deepseek.md` — Ollama (qwen3-embedding) + sqlite-vec + DeepSeek как генератор для AI Code Review.
- `docs/adr/0006-self-hosted-runner.md` — ревью и Индексация только на Self-hosted runner'е; таймауты и ручной fallback `pnpm rag:index`.
- `docs/adr/0007-ai-review-non-blocking.md` — один обновляемый комментарий, уровни Critical/High/Medium/Low, non-blocking.
- `docs/architecture.md` — контекст `Automated Review`, потоки 3 (Индексация) и 4 (AI Code Review).
- `specs/002-mcp-server/` — контракт MCP-инструментов `git_diff` и `list_files` (соглашения, которые повторяет CLI; спека в разработке).
- `specs/003-knowledge-rag/` — Индексация (`pnpm rag:index`), `knowledge.query`, хеш-инкремент, путь Индекса знаний.
- `specs/004-project-assistant/` — пример AI-потребителя, работающего с тем же контекстом.
- `GLOSSARY.md` — «AI Code Review», «AI-потребитель», «Находка», «Фрагмент знаний», «Индекс знаний», «Индексация», «Цитата», «MCP-инструмент», «Self-hosted runner».

## Открытые вопросы

_Нет._ Все спорные точки зафиксированы в требованиях: триггеры/таймауты/шаги трёх workflow, контракт CLI `review:run`, уровни Находок, якорь и label комментария, non-blocking, механизмы fallback, состав `docs/dev/*` и MANUAL-задачи владельца. Координационные зависимости (соглашения `git_diff`/`list_files` из спеки 002 и скрипты `lint`/`test`/`build`/`rag:index` из скелета репо 001–004) отражены в [плане](plan.md) как предусловия, а не неопределённость.
