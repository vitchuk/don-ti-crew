import { truncateExcerpt } from '../lib/truncate.js'
import {
  ERROR_MESSAGES,
  KnowledgeError,
  query as knowledgeQuery,
  type Embedder,
} from '@don-ti/knowledge'

export type DocType = 'readme' | 'docs' | 'specs' | 'adr' | 'code' | 'config'

export interface DocSearchArgs {
  query: string
  k?: number
  type?: DocType
}

export type DocsErrorKind
  = 'index-not-built'
  | 'ollama-unavailable'
  | 'model-not-found'
  | 'db-incompatible'
  | 'timeout'
  | 'unknown'

export class DocsError extends Error {
  kind: DocsErrorKind

  constructor(kind: DocsErrorKind, message: string) {
    super(message)
    this.name = 'DocsError'
    this.kind = kind
  }
}

export const INDEX_NOT_BUILT = ERROR_MESSAGES.NOT_INDEXED
export const OLLAMA_UNAVAILABLE = ERROR_MESSAGES.OLLAMA_UNAVAILABLE
export const MODEL_NOT_FOUND = ERROR_MESSAGES.MODEL_NOT_FOUND
export const DB_INCOMPATIBLE = ERROR_MESSAGES.DB_INCOMPATIBLE
export const SEARCH_TIMEOUT = 'Поиск по индексу знаний превысил таймаут — повторите запрос.'
export const SEARCH_UNKNOWN = 'Поиск по индексу знаний не выполнен'

export const MESSAGES: Record<DocsErrorKind, string> = {
  'index-not-built': INDEX_NOT_BUILT,
  'ollama-unavailable': OLLAMA_UNAVAILABLE,
  'model-not-found': MODEL_NOT_FOUND,
  'db-incompatible': DB_INCOMPATIBLE,
  'timeout': SEARCH_TIMEOUT,
  'unknown': SEARCH_UNKNOWN,
}

export interface SearchDocsOptions {
  timeoutMs?: number
}

export const DEFAULT_TIMEOUT_MS = 30_000

export function knowledgeDocSearch(options: {
  dbPath?: string
  embedder?: Embedder
} = {}): DocSearch {
  return async (args) => {
    try {
      const response = await knowledgeQuery(args.query, {
        k: args.k,
        type: args.type,
        dbPath: options.dbPath,
        embedder: options.embedder,
      })
      return response
    }
    catch (error) {
      throw translateKnowledgeError(error)
    }
  }
}

export function translateKnowledgeError(error: unknown): Error {
  if (error instanceof KnowledgeError) {
    return new DocsError(toDocsErrorKind(error.code), MESSAGES[toDocsErrorKind(error.code)])
  }
  return error instanceof Error ? error : new Error(String(error))
}

function toDocsErrorKind(code: KnowledgeError['code']): DocsErrorKind {
  switch (code) {
    case 'NOT_INDEXED':
      return 'index-not-built'
    case 'OLLAMA_UNAVAILABLE':
      return 'ollama-unavailable'
    case 'MODEL_NOT_FOUND':
      return 'model-not-found'
    case 'DB_INCOMPATIBLE':
      return 'db-incompatible'
    default:
      return 'unknown'
  }
}

export interface DocResult {
  file: string
  heading?: string
  excerpt: string
  score: number
}

export interface SearchProjectDocsResult {
  results: DocResult[]
  total: number
}

export type DocSearch = (args: DocSearchArgs) => Promise<SearchProjectDocsResult>

export function defaultDocSearch(): DocSearch {
  return async () => {
    throw new DocsError('index-not-built', INDEX_NOT_BUILT)
  }
}

export function makeSearchProjectDocs(
  search: DocSearch,
  options: SearchDocsOptions = {},
): (args: DocSearchArgs) => Promise<SearchProjectDocsResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return async (args) => {
    let result: SearchProjectDocsResult
    try {
      result = await withTimeout(search(args), timeoutMs)
    }
    catch (error) {
      throw translateDocsError(error)
    }
    return normalizeResult(result)
  }
}

function normalizeResult(result: SearchProjectDocsResult): SearchProjectDocsResult {
  return {
    results: result.results.map(result => ({
      file: result.file,
      heading: result.heading,
      excerpt: truncateExcerpt(result.excerpt),
      score: result.score,
    })),
    total: result.total,
  }
}

function translateDocsError(error: unknown): Error {
  if (error instanceof DocsError) {
    return new DocsError(error.kind, MESSAGES[error.kind])
  }
  const translated = translateKnowledgeError(error)
  if (translated instanceof DocsError) {
    return translated
  }
  return new DocsError('unknown', `${SEARCH_UNKNOWN}: ${describe(error)}`)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new DocsError('timeout', SEARCH_TIMEOUT))
    }, timeoutMs)
    timer.unref?.()
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
