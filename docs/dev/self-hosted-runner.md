# Установка Self-hosted runner на Windows

Пошаговая инструкция для владельца (MANUAL M-02). Runner нужен workflow'ам
`rag-index.yml` и `ai-review.yml` — локальные модели (Ollama с эмбеддингами)
на облачных runner'ах недоступны (ADR-0006). Базовая машина: Windows x64.

## Предпосылки

На машине должны быть установлены и доступны в `PATH`:

- Git (клон репозитория и `git merge-base` в CLI ревью);
- Node.js 22 LTS;
- corepack/pnpm (проверка: `pnpm --version`, иначе `corepack enable`);
- PowerShell 7+ (`pwsh`) — шаг `Guard KNOWLEDGE_DB` в workflow'ах выполняется с
  `shell: pwsh`;
- Ollama с моделью эмбеддингов (`ollama pull qwen3-embedding`) и в автозапуске.

## Регистрация runner'а

1. GitHub → репозиторий → **Settings → Actions → Runners → New self-hosted runner**.
2. Выберите **Windows x64** — откроется пошаговая страница с одноразовым
   токеном и готовыми командами.
3. Создайте каталог, например `C:\runner`, и скачайте/распакуйте туда архив
   actions-runner из шагов страницы.
4. В PowerShell в каталоге раннера выполните из страницы GitHub:

   ```powershell
   ./config.cmd --url https://github.com/vitchuk/don-ti-crew --token <TOKEN_ИЗ_СТРАНИЦЫ>
   ```

   Вопросы мастера оставляйте по умолчанию (run group: `default`,  
   имя раннера — имя машины).
5. Запустите как сервис Windows, чтобы runner жил без сессии пользователя:

   ```powershell
   ./svc.cmd install
   ./svc.cmd start
   ```

6. Проверьте: Settings → Actions → Runners → runner в состоянии **Idle**.

## Окружение раннера

env-переменные должны быть видны сервису раннера (системные переменные машины,
а не пользовательские): System Properties → Environment Variables → System
variables → New (или `setx /M`), затем перезапустите сервис (`./svc.cmd stop`
и `./svc.cmd start`).

- `KNOWLEDGE_DB` — стабильный путь **вне** workspace, например:

  ```text
  C:\runner\knowledge\knowledge.db
  ```

  Он должен переживать checkout'ы — так инкрементальная Индексация (спека 003)
  не перестраивает неизменённые Фрагменты знаний. Без этой переменной
  workflow'а падают быстро на шаге `Guard KNOWLEDGE_DB` с подсказкой (AC-8).
- Ollama в списке автозапуска Windows (services.msc или автозагрузка) с
  загруженной моделью `qwen3-embedding`.

## Безопасность

- На self-hosted runner'е выполняется только код данного репозитория (репо
  приватное/owner-only, ADR-0006).
- PR из форков по умолчанию **не выполняются** на self-hosted runner'е
  (политика репозитория; секреты форкам недоступны) — на новой машине это
  ничего дополнительно настраивать не требует, но проверяется перед открытием
  репозитория.
- Секрет `DEEPSEEK_API_KEY` на машину раннера не выкладывается — он передаётся
  только шагу `review:run` через GitHub secret (см. `docs/dev/secrets.md`).

## Чек-лист работоспособности

1. Settings → Actions → Runners → runner показывает **Idle**.
2. Actions → Rag Index → Run workflow (**workflow_dispatch**) → прогон
   успешен; шаг `Guard KNOWLEDGE_DB` зелёный.
3. Файл БД появился по `KNOWLEDGE_DB`-пути (например
   `C:\runner\knowledge\knowledge.db`).
4. Повторный `workflow_dispatch` без изменений репо завершается существенно
   быстрее первого (инкремент по хешу файла, AC-2).
5. Тестовая ветка с PR: workflow `AI Review` публикует в PR один комментарий
   с якорем `<!-- ai-review-comment -->` и label `ai-review` (AC-3);
   требуется заранее созданный label и секрет — см. `docs/dev/ci.md` и
   `docs/dev/secrets.md`.
