import { AppError } from './errors.js'

export const QUESTION_MAX_LENGTH = 2000

/** trim → 1..2000 символов, иначе AppError invalid_question (400). */
export function validateQuestion(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new AppError('invalid_question', 'Вопрос должен быть строкой — напишите его в поле ввода.')
  }
  const question = raw.trim()
  if (question.length === 0) {
    throw new AppError('invalid_question', 'Вопрос пустой — напишите его в поле ввода.')
  }
  if (question.length > QUESTION_MAX_LENGTH) {
    throw new AppError('invalid_question', `Вопрос длиннее ${QUESTION_MAX_LENGTH} символов — сократите его и задайте ещё раз.`)
  }
  return question
}
