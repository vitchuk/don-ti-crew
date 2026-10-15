// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { ERROR_TEXTS, errorText } from '../src/api'

describe('маппинг кодов ошибок в одну русскую фразу с инструкцией (T-11, FR-6)', () => {
  it.each([
    'invalid_question',
    'index_missing',
    'mcp_unavailable',
    'deepseek_key_missing',
    'ollama_unavailable',
    'llm_error',
  ] as const)('код %s имеет фразы-инструкцию', (code) => {
    const phrase = errorText(code)
    expect(phrase).toBe(ERROR_TEXTS[code])
    expect(phrase.length).toBeGreaterThan(10)
  })

  it('index_missing и ollama/deepseek фразы содержат конкретную инструкцию', () => {
    expect(ERROR_TEXTS.index_missing).toContain('pnpm rag:index')
    expect(ERROR_TEXTS.ollama_unavailable).toContain('Ollama')
    expect(ERROR_TEXTS.deepseek_key_missing).toContain('DeepSeek')
    // В собранном бандле не должно быть литерала имени ключа (AC-10)
    expect(ERROR_TEXTS.deepseek_key_missing).not.toContain('DEEPSEEK_API_KEY')
  })

  it('passthrough-коды знаний (спека 003) также покрыты', () => {
    for (const code of ['model_not_found', 'db_incompatible', 'embed_failed', 'walk_failed']) {
      expect(ERROR_TEXTS[code]?.length ?? 0).toBeGreaterThan(10)
    }
  })

  it('незнакомый код → текст от backend, иначе fallback-фраза', () => {
    expect(errorText('developer_custom', 'Что-то пошло не так')).toBe('Что-то пошло не так')
    expect(errorText('?')).toBe('Неизвестная ошибка — повторите вопрос позже.')
  })
})
