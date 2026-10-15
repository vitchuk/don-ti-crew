export type KnowledgeErrorCode
  = 'NOT_INDEXED'
  | 'OLLAMA_UNAVAILABLE'
  | 'MODEL_NOT_FOUND'
  | 'DB_INCOMPATIBLE'
  | 'EMBED_FAILED'
  | 'WALK_FAILED'

export class KnowledgeError extends Error {
  readonly code: KnowledgeErrorCode

  constructor(code: KnowledgeErrorCode, message: string) {
    super(message)
    this.name = 'KnowledgeError'
    this.code = code
  }
}

export const NOT_INDEXED_MESSAGE = 'Индекс знаний не построен — запустите `pnpm rag:index`.'
export const OLLAMA_UNAVAILABLE_MESSAGE = 'Ollama недоступна — запустите её на http://localhost:11434.'
export const MODEL_NOT_FOUND_MESSAGE = 'Модель qwen3-embedding не найдена — запустите `ollama pull qwen3-embedding`.'
export const DB_INCOMPATIBLE_MESSAGE = 'Размерность эмбеддингов не совпадает с индексом — запустите `pnpm rag:index --force`.'
export const EMBED_FAILED_MESSAGE = 'Сервис эмбеддингов вернул ошибку — проверьте Ollama и модель qwen3-embedding.'
export const WALK_FAILED_MESSAGE = 'Не удалось обойти источники индексации — проверьте доступность файлов репозитория.'

export const ERROR_MESSAGES: Record<KnowledgeErrorCode, string> = {
  NOT_INDEXED: NOT_INDEXED_MESSAGE,
  OLLAMA_UNAVAILABLE: OLLAMA_UNAVAILABLE_MESSAGE,
  MODEL_NOT_FOUND: MODEL_NOT_FOUND_MESSAGE,
  DB_INCOMPATIBLE: DB_INCOMPATIBLE_MESSAGE,
  EMBED_FAILED: EMBED_FAILED_MESSAGE,
  WALK_FAILED: WALK_FAILED_MESSAGE,
}
