# CI и AI Code Review: как это работает и что делать при сбоях

Краткий обзор трёх workflow и ручных действий владельца. Решения зафиксированы
в ADR-0005…0007; установка раннера — `docs/dev/self-hosted-runner.md`, секрет —
`docs/dev/secrets.md`.

## Workflow'ы

| Workflow | Файл | Триггеры | Runner | Таймаут | Что делает / выход |
|---|---|---|---|---|---|
| CI | `.github/workflows/ci.yml` | `pull_request`, `push main` | `ubuntu-latest` (облако) | 15 мин | install → `pnpm lint` → `pnpm test` → `pnpm build`; локальные модели не нужны |
| Rag Index | `.github/workflows/rag-index.yml` | `push main`, `workflow_dispatch` | `self-hosted` (Windows) | 10 мин | guard `KNOWLEDGE_DB` → install → build (адресный: `knowledge`, `mcp-server`, `review`) → `pnpm rag:index` (Инкрементальная Индексация в стабильный путь вне workspace) |
| AI Review | `.github/workflows/ai-review.yml` | `pull_request [opened, synchronize, reopened]` | `self-hosted` (Windows) | 15 мин | guard `KNOWLEDGE_DB` → install → build (адресный) → `pnpm rag:index` → `pnpm review:run` + публикация одного комментария с якорем `<!-- ai-review-comment -->` и label `ai-review` (non-blocking) |

Заметки:

- `concurrency` у AI Review отменяет устаревший прогон того же PR
  (`group: ai-review-<номер>`, `cancel-in-progress: true`).
- Шаг `review:run` идёт с `continue-on-error: true`, публикация — с
  `if: always()`: при сбое ревью PR получает короткий комментарий о сбое, job
  остаётся зелёным.
- Публикация комментария идёт upsert'ом по якорю: опрашиваются все страницы
  комментариев PR (per_page 100), приоритет у последнего якорного комментария
  (сортировка по id по убыванию) — дубли не создаются.
- Build шагов self-hosted workflow'ов адресный (`pnpm --filter` только по
  нужным сервисам): быстрее полного `pnpm build` и не трогает клиент `vite`.
- Эмбеддинги: если Ollama не на `localhost:11434` — задайте переменную
  окружения раннера `OLLAMA_BASE_URL` (CLI review пробрасывает её в
  mcp-server вместе с `KNOWLEDGE_DB`).
- Известное поведение: шаг `pnpm rag:index` на PR временно «подмешивает»
  документацию PR-ветки в общий индекс машины; следующий push в `main`
  выправляет инкрементом.
- Проверка синтаксиса workflow'ов: `actionlint` (двоичный файл из GitHub
  releases `rhysd/actionlint`) прогоняется по всем трём файлам без замечаний;
  для повторной проверки достаточно запустить его исполняемый файл в корне
  репо.

## Если всё повисло/упало

**Job висит в очереди.** Машина с self-hosted runner'ом выключена: job остаётся
в очереди без ошибки (AC-7). Действия:

1. Включить машину и проверить сервис раннера Windows
   (`actions.runner.<имя>` в `services.msc`) — job стартует сам.
2. Либо отменить прогон вручную (Actions → прогон → **Cancel workflow**).

**Индекс знаний устарел, а workflow не мог прогнаться.** Fallback — выполнить
на машине раннера вручную:

```powershell
pnpm rag:index
```

**Сбой CI** (облако, `lint`/`test`/`build`): открыть логи упавшего шага во
вкладке Actions; красный прогон — повод чинить код (те же проверки доступны
локально через `pnpm lint`/`pnpm test`).

**Сбой AI Review** (комментарий `⚠️ AI review не выполнен…`, job зелёный):
- открыть логи job'а `review` — там будет причина: отсутствие
  `DEEPSEEK_API_KEY`, сбой HTTP либо таймаут LLM;
- исправить (завести/обновить секрет по `docs/dev/secrets.md`), следующий
  push в PR повторит ревью (устаревший прогон отменится по `concurrency`).

**Guard `KNOWLEDGE_DB`** уронил job быстро: переменная окружения раннера не
задана — задать по `docs/dev/self-hosted-runner.md` («Окружение»), файл БД не
в workspace (AC-8).

**ai-review не блокирует merge.** Workflow не является required check и
им никогда не станет: `ai-review` запрещено добавлять в required checks при
защите ветки (ADR-0007, AC-11) — решение о merge всегда за человеком.

## Подготовка репо (MANUAL M-01)

Перед первым прогоном AI Review создать label `ai-review` (workflow проставляет
его в try/catch — отсутствие label не уронит публикацию комментария):

```bash
gh label create ai-review --color "5319e7" --description "AI Code Review"
```

или вручную: Settings → Labels → **New label** → name `ai-review`.

## Напоминание про Windows/pwsh

Self-hosted runner'ы — Windows: все `run`-шаги написаны кроссплатформенно
(pnpm-скрипты без bash-специфики), а шаги `Guard KNOWLEDGE_DB` явно задают
`shell: pwsh`; pwsh должен быть установлен на машине раннера (см.
`docs/dev/self-hosted-runner.md`, «Предпосылки»).
