import type { ChatMessage, Citation, GitContext } from './types'

/**
 * FR-8: локальная история чата в localStorage (plan.md) — только текущий чат,
 * последние 50 сообщений; восстанавливается при перезагрузке страницы.
 */
const STORAGE_KEY = 'assistant.chat.v1'
export const HISTORY_LIMIT = 50

export function loadHistory(storage: Pick<Storage, 'getItem'> = localStorage): ChatMessage[] {
  const raw = storage.getItem(STORAGE_KEY)
  if (raw === null) {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  }
  catch {
    return []
  }
  if (!Array.isArray(parsed)) {
    return []
  }
  const valid = parsed.filter(isChatMessage)
  return valid.slice(-HISTORY_LIMIT)
}

export function saveHistory(messages: ChatMessage[], storage: Pick<Storage, 'setItem'> = localStorage): void {
  const kept = messages.slice(-HISTORY_LIMIT)
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(kept))
  }
  catch {
    // Переполнение квоты не должно ломать чат (сообщения ≪ 1 МБ, но на всякий случай).
  }
}

/** «Новый вопрос» — полный сброс, включая локальную историю (AC-9). */
export function clearHistory(storage: Pick<Storage, 'removeItem'> = localStorage): void {
  try {
    storage.removeItem(STORAGE_KEY)
  }
  catch {
    // ту же логику молчания
  }
}

export function newMessage(
  role: ChatMessage['role'],
  text: string,
  citations?: Citation[],
  context?: GitContext,
): ChatMessage {
  return {
    id: makeId(),
    role,
    text,
    ...(citations !== undefined && citations.length > 0 ? { citations } : {}),
    ...(role === 'assistant' && context !== undefined ? { context } : {}),
    createdAt: new Date().toISOString(),
  }
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Record<string, unknown>
  return typeof record['id'] === 'string'
    && (record['role'] === 'user' || record['role'] === 'assistant')
    && typeof record['text'] === 'string'
    && typeof record['createdAt'] === 'string'
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`
}
