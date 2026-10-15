import type { AskAnswer, AskRequest, ErrorBody, HealthResponse } from './types'

/** FR-6: каждая деградация — одна русская фраза с инструкцией, что сделать. */
export const ERROR_TEXTS: Record<string, string> = {
  invalid_question: 'Вопрос пустой или длиннее 2000 символов — задайте вопрос ещё раз.',
  index_missing: 'Индекс знаний не построен — запустите `pnpm rag:index`.',
  mcp_unavailable: 'MCP-сервер недоступен — соберите его (`pnpm --filter @don-ti/mcp-server build`) и повторите вопрос.',
  // Имя переменной окружения ключа здесь не упоминается: в собранном бандле
  // её не должно быть вовсе (AC-10) — frontend сам ключ никогда не читает.
  deepseek_key_missing: 'Ключ генерации DeepSeek не задан — укажите его в файле .env или переключитесь на Ollama (`ASSISTANT_LLM=ollama`).',
  ollama_unavailable: 'Ollama недоступна — запустите её на http://localhost:11434 или переключитесь на DeepSeek (ключ в .env).',
  llm_error: 'LLM-провайдер вернул ошибку — повторите вопрос позже.',
  model_not_found: 'Модель qwen3-embedding не найдена — запустите `ollama pull qwen3-embedding`.',
  db_incompatible: 'Размерность эмбеддингов не совпадает с индексом — запустите `pnpm rag:index --force`.',
  embed_failed: 'Сервис эмбеддингов вернул ошибку — проверьте Ollama и модель qwen3-embedding.',
  walk_failed: 'Не удалось обойти источники индексации — проверьте доступность файлов репозитория.',
  internal_error: 'Внутренняя ошибка — повторите вопрос позже.',
  network: 'Backend недоступен — проверьте, что запущен `pnpm assistant:dev`.',
}

export class ApiError extends Error {}

/** Маппинг кода ошибки в одну фразу-инструкцию; незнакомый код — текст от backend, иначе общий fallback. */
export function errorText(code: string, message?: string): string {
  const known = ERROR_TEXTS[code]
  if (known !== undefined) {
    return known
  }
  return message !== undefined && message.length > 0 ? message : 'Неизвестная ошибка — повторите вопрос позже.'
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export async function askQuestion(question: string, fetchImpl: FetchLike = defaultFetch): Promise<AskAnswer> {
  let response: Response
  try {
    response = await fetchImpl('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question } satisfies AskRequest),
    })
  }
  catch {
    throw new ApiError(ERROR_TEXTS.network!)
  }
  if (!response.ok) {
    throw new ApiError(await toErrorPhrase(response))
  }
  return await toData<AskAnswer>(response)
}

export async function fetchHealth(fetchImpl: FetchLike = defaultFetch): Promise<HealthResponse | null> {
  try {
    const response = await fetchImpl('/api/health')
    if (!response.ok) {
      return null
    }
    return await toData<HealthResponse>(response)
  }
  catch {
    return null
  }
}

async function toErrorPhrase(response: Response): Promise<string> {
  let body: ErrorBody | null = null
  try {
    body = await response.json() as ErrorBody
  }
  catch {
    // тело не JSON — ниже общий fallback
  }
  const code = body?.error?.code ?? ''
  return errorText(code, body?.error?.message)
}

async function toData<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T
  }
  catch {
    throw new ApiError('Ответ не распознан — повторите вопрос позже.')
  }
}

function defaultFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init)
}
