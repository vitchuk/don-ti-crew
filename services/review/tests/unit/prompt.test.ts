import { describe, expect, it } from 'vitest'
import { buildSystemPrompt, buildUserPrompt } from '../../src/prompt'

const INPUT = {
  base: 'abc000',
  head: 'def111',
  diff: 'diff --git a/a.ts b/a.ts\n+const x = 1',
  diffTruncated: false,
  files: [
    { file: 'apps/assistant/backend/a.ts', state: 'modified' as const },
  ],
  fragments: [
    { file: 'specs/005-ci-ai-review/spec.md', heading: 'FR-6', excerpt: 'обязательная фраза', score: 0.9 },
  ],
}

describe('системный промпт (FR-6)', () => {
  const system = buildSystemPrompt()

  it('уровни Critical/High/Medium/Low с ориентирами', () => {
    expect(system).toContain('Critical')
    expect(system).toContain('High')
    expect(system).toContain('Medium')
    expect(system).toContain('Low')
    expect(system).toContain('баги')
    expect(system).toContain('ADR')
    expect(system).toContain('безопасность')
    expect(system).toContain('тестов')
  })

  it('запрет выдумывания несуществующего кода', () => {
    expect(system).toContain('Запрещено ссылаться на код, которого нет')
    expect(system).toContain('выдумывать несуществующие')
  })

  it('явная фраза для отсутствия находок', () => {
    expect(system).toContain('«Находок нет»')
  })

  it('жёсткий формат блока находки: severity/файл/строка/описание/рекомендация', () => {
    expect(system).toContain('### <Уровень> —')
    expect(system).toContain('**Описание:**')
    expect(system).toContain('**Рекомендация:**')
  })
})

describe('пользовательский промпт', () => {
  it('содержит base/head, список файлов, диф, Цитаты: файл · заголовок', () => {
    const user = buildUserPrompt(INPUT)
    expect(user).toContain('`abc000`')
    expect(user).toContain('`def111`')
    expect(user).toContain('- modified apps/assistant/backend/a.ts')
    expect(user).not.toContain('pnpm-lock.yaml')
    expect(user).toContain('```diff')
    expect(user).toContain('+const x = 1')
    expect(user).toContain('`specs/005-ci-ai-review/spec.md` · FR-6')
    expect(user).toContain('обязательная фраза')
  })

  it('пометка усечённого дифа и пустые списки', () => {
    const user = buildUserPrompt({ ...INPUT, diffTruncated: true, files: [], fragments: [] })
    expect(user).toContain('усечён')
    expect(user).toContain('отсутствуют или отфильтрованы')
    expect(user).toContain('документация по изменённым областям не найдена')
  })
})
