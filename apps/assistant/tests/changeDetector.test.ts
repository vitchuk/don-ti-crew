import { describe, expect, it } from 'vitest'
import { wantsDiff } from '../backend/changeDetector'

describe('changeDetector — эвристика FR-9 (T-7)', () => {
  it.each([
    'что изменилось в этой ветке?',
    'какие изменения внесены?',
    'что изменилось в diff?',
    'какие файлы изменены в ветке?',
    'сравни с веткой dev',
    'покажи git diff',
    'последний коммит',
    'опиши свой commit',
    'что в PR?',
    'был ли merge?',
    'ветках вообще где мы',
  ])('вопрос про изменения → diff: %s', (question) => {
    expect(wantsDiff(question)).toBe(true)
  })

  it.each([
    'как работает таймер?',
    'какие ADR приняты?',
    'какая погода в Лондоне?',
    'опиши протокол Табаты',
    'что такое фрагмент знаний?',
  ])('обычный вопрос — без diff: %s', (question) => {
    expect(wantsDiff(question)).toBe(false)
  })
})
