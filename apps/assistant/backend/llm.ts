import { AppError } from './errors.js'
import type { LlmConfig } from './llmConfig.js'

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type LlmCall = (messages: LlmMessage[]) => Promise<string>

/** Таймаут одного LLM-обращения: полный ответ без стриминга, NFR-1 ~15 с, поэтому ~60 с. */
export const LLM_TIMEOUT_MS = 60_000

/** Пинг доступности Ollama (health / ensure-проверки). Дешёвый локальный вызов. */
export const OLLAMA_PING_URL = 'http://localhost:11434/api/tags'
export const OLLAMA_PING_TIMEOUT_MS = 2_000

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[]
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/**
 * Единый клиент OpenAI-совместимого `POST {baseUrl}/chat/completions`
 * для deepseek и ollama (plan.md: отличается только baseUrl/model/apiKey).
 */
export function createLlm(config: LlmConfig, fetchImpl: FetchLike = defaultFetch): LlmCall {
  return async (messages) => {
    if (config.provider === 'deepseek' && (config.apiKey === undefined || config.apiKey.length === 0)) {
      throw new AppError('deepseek_key_missing')
    }
    let response: Response
    try {
      response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.provider === 'deepseek' ? { authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          stream: false,
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      })
    }
    catch (error) {
      throw toAppError(error, config)
    }
    if (!response.ok) {
      if (config.provider === 'deepseek' && (response.status === 401 || response.status === 403)) {
        throw new AppError('deepseek_key_missing', 'Ключ DEEPSEEK_API_KEY отклонён (401/403) — проверьте его в .env.')
      }
      throw new AppError('llm_error', `LLM-провайдер вернул ошибку ${response.status} — повторите вопрос позже.`)
    }
    return await extractContent(config, response)
  }
}

async function extractContent(config: LlmConfig, response: Response): Promise<string> {
  let payload: ChatCompletionResponse
  try {
    payload = await response.json() as ChatCompletionResponse
  }
  catch {
    throw new AppError('llm_error', 'LLM-провайдер вернул некорректный ответ — повторите вопрос позже.')
  }
  const content = payload.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new AppError('llm_error', 'LLM-провайдер вернул пустой ответ — повторите вопрос позже.')
  }
  return content
}

function toAppError(error: unknown, config: LlmConfig): AppError {
  // ollama: сеть недоступна почти всегда значит «не запущена» → ollama_unavailable (AC-5);
  // deepseek: это внешний API → сетевой сбой трактуем как llm_error.
  if (config.provider === 'ollama') {
    throw new AppError('ollama_unavailable')
  }
  const detail = error instanceof Error ? error.message : String(error)
  throw new AppError('llm_error', `LLM-провайдер недоступен (${detail}) — повторите вопрос позже.`)
}

function defaultFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, init)
}

/** Дешёвая проверка готовности LLM до боевого вызова (health, pipeline-gate — plan.md). */
export async function ensureLlmAvailable(config: LlmConfig, fetchImpl: FetchLike = defaultFetch): Promise<void> {
  if (config.provider === 'deepseek') {
    if (config.apiKey === undefined || config.apiKey.length === 0) {
      throw new AppError('deepseek_key_missing')
    }
    return
  }
  let response: Response
  try {
    response = await fetchImpl(OLLAMA_PING_URL, { signal: AbortSignal.timeout(OLLAMA_PING_TIMEOUT_MS) })
  }
  catch {
    throw new AppError('ollama_unavailable')
  }
  if (!response.ok) {
    throw new AppError('ollama_unavailable')
  }
}
