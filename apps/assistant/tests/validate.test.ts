import { describe, expect, it } from 'vitest'
import { QUESTION_MAX_LENGTH, validateQuestion } from '../backend/validate'
import { AppError } from '../backend/errors'

describe('validateQuestion (T-2)', () => {
  it('пустая строка → invalid_question (400)', () => {
    try {
      validateQuestion('')
      expect.unreachable('должен выбросить AppError')
    }
    catch (error) {
      expect(error).toBeInstanceOf(AppError)
      const appError = error as AppError
      expect(appError.code).toBe('invalid_question')
      expect(appError.status).toBe(400)
    }
  })

  it('только пробелы → invalid_question', () => {
    expect(() => validateQuestion('   \t\n')).toThrowError(AppError)
  })

  it('не строка → invalid_question', () => {
    expect(() => validateQuestion(undefined)).toThrowError(AppError)
    expect(() => validateQuestion(42)).toThrowError(AppError)
  })

  it(`ровно ${QUESTION_MAX_LENGTH} символов — проходит и обрезана по краям`, () => {
    const question = `  ${'а'.repeat(QUESTION_MAX_LENGTH - 1)} `
    expect(validateQuestion(question)).toHaveLength(QUESTION_MAX_LENGTH - 1)
  })

  it(`длиннее ${QUESTION_MAX_LENGTH} символов → invalid_question`, () => {
    expect(() => validateQuestion('а'.repeat(QUESTION_MAX_LENGTH + 1))).toThrowError(AppError)
  })

  it('STD формат trim: пробел по краям срезается', () => {
    expect(validateQuestion('  как работает таймер?  ')).toBe('как работает таймер?')
  })
})
