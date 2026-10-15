import { describe, expect, it } from 'vitest'
import {
  DIFF_CHAR_BUDGET,
  EXCERPT_BUDGET,
  GIT_CONTEXT_BUDGET,
  SYSTEM_PROMPT,
  buildPrompt,
  gitContextLine,
  truncateDiff,
  truncateText,
} from '../backend/prompt'
import type { GitContext } from '../src/types'

const CONTEXT: GitContext = {
  branch: 'session-42',
  clean: false,
  changedFilesCount: 3,
}

function fragment(index: number, excerptLength = 100) {
  return {
    file: `docs/adr/000${index}-example.md`,
    heading: `ADR-000${index}`,
    excerpt: `фрагмент-${index} `.repeat(excerptLength).trim(),
  }
}

describe('buildPrompt (T-7, NFR-2)', () => {
  it('system + user с вопросом, git-контекстом и фрагментами знаний', () => {
    const result = buildPrompt({
      question: 'как работает таймер?',
      context: CONTEXT,
      fragments: [fragment(1)],
    })
    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]?.role).toBe('system')
    expect(result.messages[0]?.content).toBe(SYSTEM_PROMPT)
    expect(SYSTEM_PROMPT).toContain('ТОЛЬКО на основе')
    expect(SYSTEM_PROMPT).toContain('не нашёл')

    const user = result.messages[1]?.content ?? ''
    expect(result.messages[1]?.role).toBe('user')
    expect(user).toContain('[Вопрос]')
    expect(user).toContain('как работает таймер?')
    expect(user).toContain('[Контекст git]')
    expect(user).toContain('ветка=session-42')
    expect(user).toContain('с изменениями')
    expect(user).toContain('изменено файлов: 3')
    expect(user).toContain('[Фрагменты знаний]')
    expect(user).toContain('docs/adr/0001-example.md')
  })

  it('git-контекст укладывается в бюджет 400 символов', () => {
    const long: GitContext = {
      branch: 'очень-очень-длинная-ветка-'.repeat(20),
      clean: true,
      changedFilesCount: 0,
    }
    const result = buildPrompt({ question: 'q', context: long, fragments: [] })
    const user = result.messages[1]?.content ?? ''
    expect(gitContextLine(long).length).toBeGreaterThan(GIT_CONTEXT_BUDGET)
    const contextBlock = user
      .split('[Контекст git]')[1]
      ?.split('[Фрагменты знаний]')[0]
      ?.trim() ?? ''
    expect(contextBlock.length).toBeLessThanOrEqual(GIT_CONTEXT_BUDGET)
  })

  it('diff попадает в промпт пометкой [Diff (до 200 строк)]', () => {
    const result = buildPrompt({
      question: 'что изменилось?',
      context: CONTEXT,
      diff: { diff: 'diff --git a/x.ts b/x.ts\n+x = 1', truncated: true },
      fragments: [],
    })
    const user = result.messages[1]?.content ?? ''
    expect(user).toContain('[Diff (до 200 строк)]')
    expect(user).toContain('diff --git')
    expect(user).toContain('…(diff обрезан по лимиту строк)')
  })

  it('4 отрывка — с file/heading, длинный отрывок обрезан до бюджета 600', () => {
    const fragments = [
      ...[1, 2, 3].map(i => fragment(i, 30)),
      { file: 'docs/adr/0004-mcp-single-context-provider.md', heading: 'MCP', excerpt: 'с'.repeat(2000) },
    ]
    const result = buildPrompt({ question: 'q', context: CONTEXT, fragments })
    const user = result.messages[1]?.content ?? ''
    expect(result.citations).toHaveLength(4)
    expect(result.citations[0]).toEqual({ file: fragments[0]!.file, heading: fragments[0]!.heading })
    for (const item of [fragments[0], fragments[1], fragments[2]]) {
      expect(user).toContain(`Файл: ${item?.file} — ${item?.heading}`)
    }
    const cut = truncateText('с'.repeat(2000), EXCERPT_BUDGET)
    expect(cut.length).toBeLessThanOrEqual(EXCERPT_BUDGET)
    expect(user).toContain(`Отрывок: ${cut}`)
  })

  it('без фрагментов знания секция [Фрагменты знаний] отсутствует, citations пуст', () => {
    const result = buildPrompt({ question: 'q', context: CONTEXT, fragments: [] })
    const user = result.messages[1]?.content ?? ''
    expect(user).not.toContain('[Фрагменты знаний]')
    expect(result.citations).toEqual([])
  })

  it('diff короче бюджета 4000 символов проходит без усечения', () => {
    const diff = 'diff --git a/x b/x\n'.padEnd(DIFF_CHAR_BUDGET, '+')
    expect(diff.length).toBe(DIFF_CHAR_BUDGET)
    expect(truncateDiff(diff)).toBe(diff)
  })

  it('diff длиннее бюджета усечён до ≤4000 символов с пометкой «diff усечён»', () => {
    const diff = 'x'.repeat(6000)
    const truncated = truncateDiff(diff)
    expect(truncated.length).toBeLessThanOrEqual(DIFF_CHAR_BUDGET)
    expect(truncated.startsWith('x')).toBe(true)
    expect(truncated.endsWith('\n…(diff усечён)')).toBe(true)
    const result = buildPrompt({
      question: 'что изменилось?',
      context: CONTEXT,
      diff: { diff: 'x'.repeat(6000), truncated: false },
      fragments: [],
    })
    const user = result.messages[1]?.content ?? ''
    expect(user).toContain('…(diff усечён)')
    const diffBlock = user.split('[Diff (до 200 строк)]')[1]?.split('\n\n')[0] ?? ''
    expect(diffBlock.length).toBeLessThanOrEqual(DIFF_CHAR_BUDGET + 1)
  })
})
