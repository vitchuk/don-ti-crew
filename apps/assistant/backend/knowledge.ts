import { existsSync } from 'node:fs'
import {
  KnowledgeError,
  query as knowledgeQuery,
  type SearchResponse,
} from '@don-ti/knowledge'
import { AppError, knowledgeErrorToAppError } from './errors.js'
import { knowledgeDbPath } from './paths.js'

/**
 * Знания — прямой импорт `@don-ti/knowledge` (plan.md): Помощник локален и уже
 * имеет прямой доступ к библиотеке; путь к БД — `KNOWLEDGE_DB` или
 * `.data/knowledge.db` в корне репо (спека 003).
 */

/** FR-3: поиск top-4 фрагментов знаний на вопрос. */
export const KNOWLEDGE_K = 4

export type KnowledgeQuery = (question: string) => Promise<SearchResponse>

export function knowledgeIndexPresent(): boolean {
  const dbPath = knowledgeDbPath()
  return dbPath === ':memory:' ? true : existsSync(dbPath)
}

function assertIndexPresent(): void {
  if (!knowledgeIndexPresent()) {
    throw new AppError('index_missing')
  }
}

/** Ранний детерминированный гейт пайплайна (plan.md: при отсутствии индекса LLM-вызова нет). */
export const checkIndex = assertIndexPresent

export function createKnowledgeQuery(): KnowledgeQuery {
  return async (question) => {
    try {
      return await knowledgeQuery(question, {
        k: KNOWLEDGE_K,
        dbPath: knowledgeDbPath(),
      })
    }
    catch (error) {
      if (error instanceof KnowledgeError) {
        throw knowledgeErrorToAppError(error)
      }
      throw error
    }
  }
}
