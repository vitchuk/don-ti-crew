import type { LlmMessage } from './llm.js'
import type { Citation, GitContext } from '../src/types.js'
import { DEFAULT_DIFF_MAX_LINES } from './mcpClient.js'

/** Бюджеты экономного промпта (plan.md / NFR-2, ADR-0004). */
export const GIT_CONTEXT_BUDGET = 400
export const EXCERPT_BUDGET = 600
/** Лимит строк diff, запрашиваемого у MCP-инструмента git_diff (FR-3). */
export const DIFF_MAX_LINES = DEFAULT_DIFF_MAX_LINES
/** Символьный бюджет diff-блока после обрезки по строкам (NFR-2). */
export const DIFF_CHAR_BUDGET = 4000

export const SYSTEM_PROMPT = [
  'Ты — Помощник по проекту don-ti-crew. Отвечай ТОЛЬКО на основе переданного контекста.',
  'Кратко, на русском языке. Указывай пути файлов-цитаты из переданного контекста.',
  'Если контекста недостаточно — честно напиши, что не нашёл ответа в документации проекта, и не выдумывай.',
].join(' ')

export interface PromptDiff {
  diff: string
  truncated: boolean
}

export interface PromptFragment {
  file: string
  heading?: string
  excerpt: string
}

export interface PromptInput {
  question: string
  context: GitContext
  /** Diff рабочего дерева против HEAD; задаётся только для вопросов об изменениях (FR-9). */
  diff?: PromptDiff | null
  fragments: PromptFragment[]
}

export interface PromptResult {
  messages: LlmMessage[]
  citations: Citation[]
  context: GitContext
}

export function buildPrompt(input: PromptInput): PromptResult {
  const citations: Citation[] = input.fragments.map(fragment => ({
    file: fragment.file,
    ...(fragment.heading !== undefined ? { heading: fragment.heading } : {}),
  }))
  const user = buildUserMessage(input)
  const messages: LlmMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ]
  return { messages, citations, context: input.context }
}

function buildUserMessage(input: PromptInput): string {
  const lines: string[] = [
    '[Вопрос]',
    input.question,
    '',
    '[Контекст git]',
    truncateText(gitContextLine(input.context), GIT_CONTEXT_BUDGET),
  ]
  if (input.diff !== null && input.diff !== undefined) {
    lines.push('')
    lines.push('[Diff (до 200 строк)]')
    lines.push(truncateDiff(input.diff.diff))
    if (input.diff.truncated) {
      lines.push('…(diff обрезан по лимиту строк)')
    }
  }
  if (input.fragments.length > 0) {
    lines.push('')
    lines.push('[Фрагменты знаний]')
    input.fragments.forEach((fragment, index) => {
      const heading = fragment.heading !== undefined && fragment.heading.length > 0
        ? ` — ${fragment.heading}`
        : ''
      lines.push(`${index + 1}. Файл: ${fragment.file}${heading}`)
      lines.push(`Отрывок: ${truncateText(fragment.excerpt, EXCERPT_BUDGET)}`)
    })
  }
  return lines.join('\n')
}

export function gitContextLine(context: GitContext): string {
  const state = context.clean ? 'чистый' : 'с изменениями'
  return `ветка=${context.branch}; рабочий каталог ${state}; изменено файлов: ${context.changedFilesCount}`
}

/** Обрезка до max символов, по возможности по границе слова. */
export function truncateText(text: string, max: number): string {
  if (text.length <= max) {
    return text
  }
  const cut = text.slice(0, max)
  const breakAt = cut.lastIndexOf(' ')
  return breakAt > max / 2 ? cut.slice(0, breakAt) : cut
}

const DIFF_TRUNCATION_SUFFIX = '\n…(diff усечён)'

export function truncateDiff(diff: string): string {
  if (diff.length <= DIFF_CHAR_BUDGET) {
    return diff
  }
  return diff.slice(0, DIFF_CHAR_BUDGET - DIFF_TRUNCATION_SUFFIX.length) + DIFF_TRUNCATION_SUFFIX
}
