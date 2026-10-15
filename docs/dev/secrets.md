# Секрет DEEPSEEK_API_KEY

Пошаговый порядок для владельца (MANUAL M-03). Ключ нужен шагу `review:run`
workflow'а `ai-review.yml` — модель `deepseek-chat` (ADR-0005).

## Добавление

1. Получите API-ключ в личном кабинете DeepSeek (platform.deepseek.com).
2. GitHub → репозиторий → **Settings → Secrets and variables → Actions**.
3. Вкладка **Secrets** → **New repository secret**.
4. Поле **Name**: `DEEPSEEK_API_KEY` (ровно это имя, workflow ссылается на
   `${{ secrets.DEEPSEEK_API_KEY }}`).
5. Поле **Secret**: значение ключа → **Add secret**.

## Правила обращения

- Ключ живёт только в GitHub secret: не в коде репозитория, не в `.env`,
  не в workflow-файлах и не в issue/комментариях.
- На машину self-hosted runner'а ключ не выкладывается — он попадает в
  окружение только через env шага `review:run` (FR-7).
- PR из форков секрет не получают.
- Ротация: отредактируйте secret с тем же именем (**Update**) — workflow'ы на
  следующем прогоне возьмут новое значение, правок кода не нужно.
- Если ключ протёк — удалите его в кабинете DeepSeek и замените секрет тем же
  шагом `Update`.

## Проверка

- Settings → Secrets and variables → Actions содержит строку
  `DEEPSEEK_API_KEY` (значение скрыто).
- Тестовый PR: если ключ сбойный/отсутствует, PR получает короткий комментарий
  `⚠️ AI review не выполнен…`, workflow `AI Review` остаётся зелёным
  (non-blocking, AC-6), а в логах job'а `review` видна причина (без значения
  ключа).
