export const LLM_TIMEOUT_MS = 60_000
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
export const DEEPSEEK_MODEL = 'deepseek-chat'
export const MAX_ATTEMPTS = 2

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export class LlmError extends Error {
  readonly retryable: boolean

  constructor(message: string, retryable = false) {
    super(message)
    this.name = 'LlmError'
    this.retryable = retryable
  }
}

export interface LlmMessage {
  role: 'system' | 'user'
  content: string
}

export interface LlmConfig {
  baseUrl: string
  model: string
  apiKey: string
}

export interface AskOptions {
  timeoutMs?: number
  attempts?: number
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[]
}

export function resolveLlmConfig(env: NodeJS.ProcessEnv): LlmConfig {
  const apiKey = env['DEEPSEEK_API_KEY']
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new LlmError('Ключ DEEPSEEK_API_KEY не задан — добавьте секрет в GitHub Actions (docs/dev/secrets.md) или переменную окружения локально.')
  }
  return { baseUrl: DEEPSEEK_BASE_URL, model: DEEPSEEK_MODEL, apiKey }
}

export async function askDeepSeek(
  messages: LlmMessage[],
  config: LlmConfig,
  fetchImpl: FetchLike = fetch,
  options: AskOptions = {},
): Promise<string> {
  const attempts = options.attempts ?? MAX_ATTEMPTS
  const timeoutMs = options.timeoutMs ?? LLM_TIMEOUT_MS
  let lastError: LlmError | null = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await callOnce(messages, config, fetchImpl, timeoutMs)
    }
    catch (error) {
      lastError = error instanceof LlmError ? error : new LlmError(describe(error), true)
      if (!lastError.retryable) {
        throw lastError
      }
    }
  }
  throw lastError ?? new LlmError('LLM-вызов не удался', true)
}

async function callOnce(messages: LlmMessage[], config: LlmConfig, fetchImpl: FetchLike, timeoutMs: number): Promise<string> {
  const apiKey = config.apiKey
  if (apiKey.trim().length === 0) {
    throw new LlmError('Ключ DEEPSEEK_API_KEY не задан — вызов LLM невозможен.')
  }
  let response: Response
  try {
    response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: false,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  }
  catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new LlmError(`LLM не ответила за ${Math.round(timeoutMs / 1000)} с`, true)
    }
    throw new LlmError(`LLM недоступна: ${describe(error)}`, true)
  }
  if (!response.ok) {
    if (response.status === 402 || response.status === 429) {
      throw new LlmError('DeepSeek вернул ошибку лимитов/оплаты — проверьте баланс и лимиты.', true)
    }
    if (response.status < 500) {
      throw new LlmError(`LLM отклонила запрос (HTTP ${response.status}) — проверьте ключ DEEPSEEK_API_KEY.`)
    }
    throw new LlmError(`LLM вернула HTTP ${response.status}`, true)
  }
  let payload: ChatCompletionResponse
  try {
    payload = await response.json() as ChatCompletionResponse
  }
  catch {
    throw new LlmError('LLM вернула некорректный JSON', true)
  }
  const content = payload.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new LlmError('LLM вернула пустой ответ', true)
  }
  return content
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
