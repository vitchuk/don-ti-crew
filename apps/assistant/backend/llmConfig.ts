import { AppError } from './errors.js'

export type LlmProvider = 'deepseek' | 'ollama'

export interface LlmConfig {
  provider: LlmProvider
  baseUrl: string
  model: string
  /** Ключ DeepSeek — только на backend, в frontend-бандл не попадает (FR-5, AC-10). */
  apiKey?: string
}

export const DEFAULT_PROVIDER: LlmProvider = 'deepseek'
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat'
export const OLLAMA_BASE_URL = 'http://localhost:11434/v1'
export const OLLAMA_MODEL = 'qwen3:1.7b'

/**
 * `ASSISTANT_LLM=deepseek|ollama` (по умолчанию deepseek) → baseUrl/model/apiKey.
 * Ключ берётся из env как есть, без обрезки (FR-5).
 */
export function resolveLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const raw = env['ASSISTANT_LLM']
  if (raw === undefined || raw.trim().length === 0) {
    return deepseekConfig(env)
  }
  const provider = raw.trim().toLowerCase()
  if (provider === 'deepseek') {
    return deepseekConfig(env)
  }
  if (provider === 'ollama') {
    return {
      provider: 'ollama',
      baseUrl: OLLAMA_BASE_URL,
      model: OLLAMA_MODEL,
    }
  }
  throw new AppError('internal_error', 'Переменная ASSISTANT_LLM задана неверно — используйте deepseek или ollama.')
}

function deepseekConfig(env: NodeJS.ProcessEnv): LlmConfig {
  const config: LlmConfig = {
    provider: 'deepseek',
    baseUrl: DEEPSEEK_BASE_URL,
    model: DEFAULT_DEEPSEEK_MODEL,
  }
  const key = env['DEEPSEEK_API_KEY']
  if (key !== undefined) {
    config.apiKey = key
  }
  const model = env['DEEPSEEK_MODEL']
  if (model !== undefined && model.trim().length > 0) {
    config.model = model
  }
  return config
}
