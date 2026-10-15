// Общие DTO Помощника (спека 004, plan.md) — единый источник для frontend и backend.

export interface AskRequest {
  question: string
}

export interface Citation {
  /** Путь от корня репо, разделитель `/`, напр. "docs/adr/0004-mcp-single-context-provider.md". */
  file: string
  heading?: string
}

export interface GitContext {
  branch: string
  clean: boolean
  changedFilesCount: number
}

export interface AskAnswer {
  answer: string
  citations: Citation[]
  context: GitContext
}

export type LlmProvider = 'deepseek' | 'ollama'

export interface HealthResponse {
  status: 'ok'
  llm: { provider: LlmProvider; ready: boolean }
  knowledge: { indexPresent: boolean }
}

/** Тело ответа при ошибке: { error: { code, message } }, message — одна фраза на русском. */
export interface ErrorBody {
  error: {
    code: string
    message: string
  }
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  citations?: Citation[]
  /** Только у role = assistant. */
  context?: GitContext
  createdAt: string
}
