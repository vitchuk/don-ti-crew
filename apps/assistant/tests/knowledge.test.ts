import { describe, expect, it } from 'vitest'
import { createKnowledgeQuery, knowledgeIndexPresent } from '../backend/knowledge'
import { knowledgeErrorToAppError } from '../backend/errors'
import { KnowledgeError, ERROR_MESSAGES } from '@don-ti/knowledge'

describe('knowledge-интеграция (T-5, API спеки 003)', () => {
  it('KnowledgeError NOT_INDEXED → 422 index_missing с инструкцией «запустите pnpm rag:index»', () => {
    const appError = knowledgeErrorToAppError(new KnowledgeError('NOT_INDEXED', 'whatever'))
    expect(appError.code).toBe('index_missing')
    expect(appError.status).toBe(422)
    expect(appError.message).toContain('pnpm rag:index')
  })

  it('KnowledgeError OLLAMA_UNAVAILABLE → passthrough 503 с фразой спеки 003', () => {
    const appError = knowledgeErrorToAppError(new KnowledgeError('OLLAMA_UNAVAILABLE', ERROR_MESSAGES.OLLAMA_UNAVAILABLE))
    expect(appError.code).toBe('ollama_unavailable')
    expect(appError.status).toBe(503)
    expect(appError.message).toBe(ERROR_MESSAGES.OLLAMA_UNAVAILABLE)
  })

  it('MODEL_NOT_FOUND / DB_INCOMPATIBLE → passthrough с сообщениями библиотеки', () => {
    expect(
      knowledgeErrorToAppError(new KnowledgeError('MODEL_NOT_FOUND', ERROR_MESSAGES.MODEL_NOT_FOUND)).code,
    ).toBe('model_not_found')
    expect(
      knowledgeErrorToAppError(new KnowledgeError('DB_INCOMPATIBLE', ERROR_MESSAGES.DB_INCOMPATIBLE)).code,
    ).toBe('db_incompatible')
  })

  it('createKnowledgeQuery с отсутствующей БД (KNOWLEDGE_DB) → index_missing', async () => {
    const previous = process.env['KNOWLEDGE_DB']
    process.env['KNOWLEDGE_DB'] = 'tmp/assistant-absent-db.db'
    try {
      const queryFn = createKnowledgeQuery()
      await expect(queryFn('как работает таймер?')).rejects.toMatchObject({
        code: 'index_missing',
        status: 422,
      })
      expect(knowledgeIndexPresent()).toBe(false)
    }
    finally {
      if (previous === undefined) {
        delete process.env['KNOWLEDGE_DB']
      }
      else {
        process.env['KNOWLEDGE_DB'] = previous
      }
    }
  })
})

