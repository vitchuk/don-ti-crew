import { existsSync } from 'node:fs'
import { openDatabase, resolveDbPath, searchChunks, tableExists } from './db.js'
import { createOllamaEmbedder } from './embeddings.js'
import { KnowledgeError, NOT_INDEXED_MESSAGE } from './errors.js'
import { DEFAULT_K } from './constants.js'
import type { SearchResponse, QueryOptions } from './types.js'

export const EXCERPT_LIMIT = 500

export async function query(text: string, options: QueryOptions = {}): Promise<SearchResponse> {
  const k = options.k ?? DEFAULT_K
  const dbPath = resolveDbPath(options.dbPath)
  if (dbPath !== ':memory:' && !existsSync(dbPath)) {
    throw new KnowledgeError('NOT_INDEXED', NOT_INDEXED_MESSAGE)
  }
  const embedder = options.embedder ?? createOllamaEmbedder()
  const db = openDatabase(dbPath)
  try {
    if (!tableExists(db)) {
      throw new KnowledgeError('NOT_INDEXED', NOT_INDEXED_MESSAGE)
    }
    const vectors = await embedder.embed([text])
    const vector = vectors[0]
    if (vector === undefined || vector.length === 0) {
      throw new KnowledgeError('EMBED_FAILED', 'Сервис эмбеддингов вернул пустой вектор — проверьте Ollama.')
    }
    const fetchK = options.type === undefined ? k : k * 4
    const rows = searchChunks(db, vector, fetchK)
    const filtered = options.type === undefined
      ? rows
      : rows.filter(row => row.fileType === options.type)
    const results = filtered.slice(0, k).map(row => ({
      file: row.filePath,
      heading: row.headingPath.length > 0 ? row.headingPath : undefined,
      excerpt: truncateExcerpt(row.content, EXCERPT_LIMIT),
      score: 1 / (1 + row.distance),
    }))
    return { results, total: results.length }
  }
  finally {
    db.close()
  }
}

export function truncateExcerpt(text: string, max: number): string {
  if (text.length <= max) {
    return text
  }
  const cut = text.slice(0, max)
  const breakAt = cut.lastIndexOf(' ')
  if (breakAt > max / 2) {
    return cut.slice(0, breakAt)
  }
  return cut
}
