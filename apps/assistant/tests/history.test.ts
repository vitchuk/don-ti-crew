// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import {
  HISTORY_LIMIT,
  clearHistory,
  loadHistory,
  newMessage,
  saveHistory,
} from '../src/history'
import type { Citation, GitContext } from '../src/types'

const CITATIONS: Citation[] = [{ file: 'docs/adr/0004-mcp-single-context-provider.md', heading: 'MCP' }]
const CONTEXT: GitContext = { branch: 'main', clean: true, changedFilesCount: 0 }

describe('history: localStorage (T-10, FR-8, AC-9)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('пустая история → пустой массив', () => {
    expect(loadHistory()).toEqual([])
  })

  it('save/load round-trip с цитатами и контекстом', () => {
    const messages = [
      newMessage('user', 'как работает таймер?'),
      newMessage('assistant', 'Кратко: фазы, раунды, циклы.', CITATIONS, CONTEXT),
    ]
    saveHistory(messages)
    expect(loadHistory()).toEqual(messages)
    expect(localStorage.getItem('assistant.chat.v1')).not.toBeNull()
  })

  it('лимит 50: старые сообщения отбрасываются (FR-8)', () => {
    const messages = Array.from({ length: HISTORY_LIMIT + 7 }, (_, i) => newMessage('user', `вопрос ${i}`))
    saveHistory(messages)
    const loaded = loadHistory()
    expect(loaded).toHaveLength(HISTORY_LIMIT)
    expect(loaded[0]?.text).toBe(`вопрос ${7}`)
    expect(loaded[HISTORY_LIMIT - 1]?.text).toBe(`вопрос ${HISTORY_LIMIT + 6}`)
  })

  it('новый вопрос: clearHistory удаляет ключ, reload даёт пустой чат (AC-9)', () => {
    saveHistory([newMessage('user', 'q'), newMessage('assistant', 'a')])
    clearHistory()
    expect(loadHistory()).toEqual([])
    expect(localStorage.getItem('assistant.chat.v1')).toBeNull()
  })

  it('битый JSON в localStorage → пустой чат вместо падения', () => {
    localStorage.setItem('assistant.chat.v1', '{oops')
    expect(loadHistory()).toEqual([])
  })

  it('мусорные записи отфильтровываются', () => {
    localStorage.setItem('assistant.chat.v1', JSON.stringify([
      42,
      { id: 'x', role: 'admin', text: 'no', createdAt: '' },
      newMessage('user', 'ok'),
    ]))
    expect(loadHistory()).toHaveLength(1)
  })

  it('без механизма crypto.randomUUID id генерируется', () => {
    const message = newMessage('user', 'q')
    expect(message.id.length).toBeGreaterThan(8)
  })
})
