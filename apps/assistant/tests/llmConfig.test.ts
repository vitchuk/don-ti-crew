import { describe, expect, it } from 'vitest'
import { resolveLlmConfig } from '../backend/llmConfig'

describe('resolveLlmConfig (T-6)', () => {
  it('нет ASSISTANT_LLM → deepseek с OpenAI-совместимым baseUrl', () => {
    const config = resolveLlmConfig({})
    expect(config.provider).toBe('deepseek')
    expect(config.baseUrl).toBe('https://api.deepseek.com')
    expect(config.model).toBe('deepseek-chat')
  })

  it('ASSISTANT_LLM=deepseek → ключ из env как есть (без обрезки)', () => {
    const config = resolveLlmConfig({ ASSISTANT_LLM: 'deepseek', DEEPSEEK_API_KEY: ' sk-key ' })
    expect(config.provider).toBe('deepseek')
    expect(config.apiKey).toBe(' sk-key ')
  })

  it('DEEPSEEK_MODEL переопределяет модель', () => {
    const config = resolveLlmConfig({ DEEPSEEK_MODEL: 'deepseek-flash' })
    expect(config.model).toBe('deepseek-flash')
  })

  it('ASSISTANT_LLM=ollama → локальный OpenAI-совместимый endpoint, без ключа', () => {
    const config = resolveLlmConfig({ ASSISTANT_LLM: 'OLLAMA' })
    expect(config.provider).toBe('ollama')
    expect(config.baseUrl).toBe('http://localhost:11434/v1')
    expect(config.model).toBe('qwen3:1.7b')
    expect(config.apiKey).toBeUndefined()
  })

  it('недопустимое значение → ошибка конфигурации', () => {
    expect(() => resolveLlmConfig({ ASSISTANT_LLM: 'claude' })).toThrowError(/deepseek или ollama/)
  })

  it('ключ DeepSeek не задан — apiKey отсутствует, решение о 503 остаётся за llm.ts', () => {
    expect(resolveLlmConfig({}).apiKey).toBeUndefined()
  })
})
