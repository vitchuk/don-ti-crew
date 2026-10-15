import type { ChangedFile } from './collect.js'
import type { CitedFragment } from './context.js'

export interface PromptInput {
  base: string
  head: string
  diff: string
  diffTruncated: boolean
  files: ChangedFile[]
  fragments: CitedFragment[]
}

export const SYSTEM_PROMPT = `Ты — опытный ревьюер кода проекта don-ti-crew. Тебе дают дифа pull request'а и контекст из Индекса знаний проекта (спеки, ADR, документация, исходный код).
Направления проверки:
- потенциальные баги в новой логике;
- архитектурные несоответствия решениям из ADR и спецификаций, переданных в контексте;
- безопасность: секреты в коде, инъекции, небезопасные вызовы;
- отсутствие тестов для новой логики.
Уровни находок:
- Critical — потеря данных, утечка секретов, уязвимость, блокирующий баг;
- High — вероятная ошибка логики или нарушение решений ADR/спек;
- Medium — потенциальная проблема, слабая обработка ошибок, отсутствие тестов;
- Low — качество кода и стилистика.
Каждую находку оформи блоком строго в формате:
### <Уровень> — \`<файл>\`[:<строка>]
**Описание:** <что и почему>
**Рекомендация:** <что сделать>
Правила:
- Опирайся только на фактический диф и переданный контекст. Запрещено ссылаться на код, которого нет в дифе или контексте, и выдумывать несуществующие файлы, строки или фрагменты.
- Если замечаний нет, ответь ровно одной строкой: «Находок нет».
- Не добавляй текста, кроме блоков находок или фразы «Находок нет».`

export function buildSystemPrompt(): string {
  return SYSTEM_PROMPT
}

export function buildPrompt(input: PromptInput): { system: string; user: string } {
  return { system: SYSTEM_PROMPT, user: buildUserPrompt(input) }
}

export function buildUserPrompt(input: PromptInput): string {
  const lines: string[] = []
  lines.push('## Задача')
  lines.push(`Ревью изменений между base \`${input.base}\` и head \`${input.head}\`.`)
  lines.push('')
  lines.push('## Изменённые файлы')
  if (input.files.length === 0) {
    lines.push('(_изменённые файлы отсутствуют или отфильтрованы_)')
  }
  else {
    for (const file of input.files) {
      lines.push(`- ${file.state} ${file.file}`)
    }
  }
  lines.push('')
  lines.push('## Диф (merge-base(base, head) → head)')
  if (input.diffTruncated) {
    lines.push('_Диф усечён лимитом строк._')
  }
  lines.push('```diff')
  lines.push(input.diff)
  lines.push('```')
  lines.push('')
  lines.push('## Контекст из Индекса знаний (Цитаты: файл · заголовок)')
  if (input.fragments.length === 0) {
    lines.push('(_документация по изменённым областям не найдена_)')
  }
  else {
    for (const fragment of input.fragments) {
      const heading = fragment.heading === undefined ? '' : ` · ${fragment.heading}`
      lines.push(`- \`${fragment.file}\`${heading}: ${fragment.excerpt}`)
    }
  }
  return `${lines.join('\n')}\n`
}
