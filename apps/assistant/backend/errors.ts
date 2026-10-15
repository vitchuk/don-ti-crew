import { ERROR_MESSAGES, type KnowledgeError, type KnowledgeErrorCode } from '@don-ti/knowledge'

/**
 * Коды ошибок Помощника (план, спека 004 — таблица HTTP/code/когда).
 * `model_not_found` / `db_incompatible` / `embed_failed` / `walk_failed` —
 * passthrough деградаций поиска знаний из спеки 003 (все 503); `internal_error` —
 * непредвиденные 500, которые нельзя приписать ни одному из кодов таблицы.
 */
export type ErrorCode
  = 'invalid_question'
  | 'index_missing'
  | 'mcp_unavailable'
  | 'deepseek_key_missing'
  | 'ollama_unavailable'
  | 'llm_error'
  | 'model_not_found'
  | 'db_incompatible'
  | 'embed_failed'
  | 'walk_failed'
  | 'internal_error'

export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  invalid_question: 400,
  index_missing: 422,
  mcp_unavailable: 502,
  deepseek_key_missing: 503,
  ollama_unavailable: 503,
  llm_error: 500,
  model_not_found: 503,
  db_incompatible: 503,
  embed_failed: 503,
  walk_failed: 503,
  internal_error: 500,
}

export const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  invalid_question: 'Вопрос пустой или длиннее 2000 символов — задайте вопрос ещё раз.',
  index_missing: 'Индекс знаний не построен — запустите `pnpm rag:index`.',
  mcp_unavailable: 'MCP-сервер недоступен — соберите его (`pnpm --filter @don-ti/mcp-server build`) и повторите вопрос.',
  deepseek_key_missing: 'Ключ DEEPSEEK_API_KEY не задан — укажите его в файле .env или переключитесь на Ollama (`ASSISTANT_LLM=ollama`).',
  ollama_unavailable: 'Ollama недоступна — запустите её на http://localhost:11434 или укажите DEEPSEEK_API_KEY в .env.',
  llm_error: 'LLM-провайдер вернул ошибку — повторите вопрос позже.',
  model_not_found: ERROR_MESSAGES.MODEL_NOT_FOUND,
  db_incompatible: ERROR_MESSAGES.DB_INCOMPATIBLE,
  embed_failed: ERROR_MESSAGES.EMBED_FAILED,
  walk_failed: ERROR_MESSAGES.WALK_FAILED,
  internal_error: 'Внутренняя ошибка — повторите вопрос позже.',
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number

  constructor(code: ErrorCode, message: string = DEFAULT_MESSAGES[code]) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = STATUS_BY_CODE[code]
  }
}

export interface ErrorOutcome {
  status: number
  body: { error: { code: string; message: string } }
}

/** HTTP-представление любой ошибки; непредвиденные ошибки уходят как internal_error без деталей. */
export function toErrorOutcome(error: unknown): ErrorOutcome {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: { error: { code: error.code, message: error.message } },
    }
  }
  return {
    status: STATUS_BY_CODE.internal_error,
    body: {
      error: {
        code: 'internal_error',
        message: DEFAULT_MESSAGES.internal_error,
      },
    },
  }
}

/** Деградации поиска знаний (спека 003) → AppError: NOT_INDEXED → index_missing, остальное — passthrough. */
export function knowledgeErrorToAppError(error: KnowledgeError): AppError {
  const code: KnowledgeErrorCode = error.code
  switch (code) {
    case 'NOT_INDEXED':
      return new AppError('index_missing')
    case 'OLLAMA_UNAVAILABLE':
      return new AppError('ollama_unavailable', ERROR_MESSAGES.OLLAMA_UNAVAILABLE)
    case 'MODEL_NOT_FOUND':
      return new AppError('model_not_found', ERROR_MESSAGES.MODEL_NOT_FOUND)
    case 'DB_INCOMPATIBLE':
      return new AppError('db_incompatible', ERROR_MESSAGES.DB_INCOMPATIBLE)
    case 'EMBED_FAILED':
      return new AppError('embed_failed', ERROR_MESSAGES.EMBED_FAILED)
    case 'WALK_FAILED':
      return new AppError('walk_failed', ERROR_MESSAGES.WALK_FAILED)
    default:
      return new AppError('internal_error', DEFAULT_MESSAGES.internal_error)
  }
}
