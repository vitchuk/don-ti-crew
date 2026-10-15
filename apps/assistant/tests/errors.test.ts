import { describe, expect, it } from 'vitest'
import { AppError, STATUS_BY_CODE, toErrorOutcome } from '../backend/errors'

describe('AppError → HTTP (план, таблица ошибок)', () => {
  it.each([
    ['invalid_question', 400],
    ['index_missing', 422],
    ['mcp_unavailable', 502],
    ['deepseek_key_missing', 503],
    ['ollama_unavailable', 503],
    ['llm_error', 500],
  ] as const)('%s → %i', (code, status) => {
    expect(new AppError(code).status).toBe(status)
    expect(STATUS_BY_CODE[code]).toBe(status)
  })

  it('тело ошибки: { error: { code, message } }', () => {
    const outcome = toErrorOutcome(new AppError('index_missing'))
    expect(outcome.status).toBe(422)
    expect(outcome.body).toEqual({
      error: {
        code: 'index_missing',
        message: 'Индекс знаний не построен — запустите `pnpm rag:index`.',
      },
    })
  })

  it('кастомная фраза сохраняется в сообщении ошибки', () => {
    const outcome = toErrorOutcome(new AppError('deepseek_key_missing', 'Другая фраза'))
    expect(outcome.body.error.code).toBe('deepseek_key_missing')
    expect(outcome.body.error.message).toBe('Другая фраза')
  })

  it('непредвиденная ошибка → 500 internal_error без деталей', () => {
    const outcome = toErrorOutcome(new TypeError('cannot read x of y'))
    expect(outcome.status).toBe(500)
    expect(outcome.body.error.code).toBe('internal_error')
    expect(outcome.body.error.message).not.toContain('cannot read')
  })
})
