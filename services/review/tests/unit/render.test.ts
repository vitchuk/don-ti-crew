import { describe, expect, it } from 'vitest'
import {
  parseFindings,
  renderReport,
  summarizeCounts,
  SEVERITY_ORDER,
} from '../../src/render'

const MD_FINDINGS = `### Medium — \`services/cli.ts\`
**Описание:** нет проверки аргумента.
**Рекомендация:** добавить parseArgs с валидацией.

### High — \`apps/client/src/timer.ts:42\`
**Описание:** возможен null.
**Рекомендация:** проверить на null перед вызовом.

### Critical — \`apps/server/auth.ts\`
**Описание:** секрет в коде.
**Рекомендация:** перенести в env.`

describe('parseFindings', () => {
  it('блоки находок разбираются с файлом и строкой', () => {
    const findings = parseFindings(MD_FINDINGS)
    expect(findings).toHaveLength(3)
    expect(findings.find(f => f.file === 'apps/client/src/timer.ts')).toMatchObject({ severity: 'High', line: 42 })
    expect(findings.find(f => f.file === 'apps/server/auth.ts')).toMatchObject({ severity: 'Critical' })
    expect(findings.every(f => f.recommendation.length > 0)).toBe(true)
  })

  it('ответ «Находок нет» → пустой список', () => {
    expect(parseFindings('Находок нет')).toEqual([])
  })

  it('нераспознанный уровень → Low с пометкой', () => {
    const findings = parseFindings('### Severe — a.ts\n**Описание:** хм.\n**Рекомендация:** проверить.')
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('Low')
    expect(findings[0]?.note).toContain('нераспознанный уровень')
  })

  it('ответ без разметки → одиночная находка Low', () => {
    const findings = parseFindings('Что-то выглядит подозрительно в цикле')
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('Low')
    expect(findings[0]?.message).toContain('подозрительно')
    expect(findings[0]?.note).toContain('без ожидаемой разметки')
  })

  it('пустой ответ → пустой список (разводится как отсутствие)', () => {
    expect(parseFindings('')).toEqual([])
  })
})

describe('summarizeCounts', () => {
  it('счётчики по уровням в порядке Critical..Low', () => {
    const findings = parseFindings(MD_FINDINGS)
    expect(SEVERITY_ORDER).toEqual(['Critical', 'High', 'Medium', 'Low'])
    expect(summarizeCounts(findings)).toBe('Critical 1 · High 1 · Medium 1 · Low 0')
  })
})

describe('renderReport', () => {
  it('отчёт: заголовок, base/head, сводка, блоки по уровням от Critical к Low', () => {
    const findings = parseFindings(MD_FINDINGS)
    const report = renderReport({ base: 'abc111', head: 'def222', model: 'deepseek-chat', findings })
    expect(report).toContain('## 🔍 AI Code Review')
    expect(report).toContain('**base** `abc111` → **head** `def222`')
    expect(report).toContain('· модель `deepseek-chat`')
    expect(report).toContain('### Сводка: Critical 1 · High 1 · Medium 1 · Low 0')
    expect(report.indexOf('### Critical — `apps/server/auth.ts`')).toBeLessThan(report.indexOf('### High — `apps/client/src/timer.ts:42`'))
    expect(report).not.toContain('<!-- ai-review-comment -->')
  })

  it('нет находок → явная фраза отдельной частью отчёта', () => {
    const report = renderReport({ base: 'a', head: 'b', model: 'deepseek-chat', findings: [] })
    expect(report).toContain('**Находок нет**')
    expect(report).toContain('### Сводка: Critical 0 · High 0 · Medium 0 · Low 0')
  })

  it('усечённый диф отмечается в отчёте', () => {
    const report = renderReport({ base: 'a', head: 'b', model: 'm', findings: [], diffTruncated: true })
    expect(report).toContain('усечён')
  })
})
