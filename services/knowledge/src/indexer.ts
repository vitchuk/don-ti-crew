import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  deleteFilePaths,
  ensureSchema,
  existingFiles,
  openDatabase,
  readStoredDimension,
  resolveDbPath,
  tableExists,
  upsertChunks,
  type Database,
  type InsertRow,
} from './db.js'
import { chunkCode, chunkMarkdown } from './chunker.js'
import { KnowledgeError, WALK_FAILED_MESSAGE } from './errors.js'
import { collectFiles } from './walk.js'
import type { Chunk, FileType, IndexSummary, IndexerOptions } from './types.js'
import type { SourceFile } from './walk.js'

interface FileMeta {
  filePath: string
  fileType: FileType
  hash: string
  content: string
}

const DIMENSION_PROBE_TEXT = 'knowledge dimension probe'

export async function index(options: IndexerOptions): Promise<IndexSummary> {
  const repoRoot = options.repoRoot ?? process.cwd()
  const dbPath = resolveDbPath(options.dbPath)
  let sources: SourceFile[]
  try {
    sources = await collectFiles(repoRoot)
  }
  catch (error) {
    if (error instanceof KnowledgeError) {
      throw error
    }
    throw new KnowledgeError('WALK_FAILED', WALK_FAILED_MESSAGE)
  }

  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true })
  }
  const db = openDatabase(dbPath)
  try {
    return await runIndexing(db, repoRoot, sources, options)
  }
  finally {
    db.close()
  }
}

async function runIndexing(
  db: Database,
  repoRoot: string,
  sources: SourceFile[],
  options: IndexerOptions,
): Promise<IndexSummary> {
  const force = options.force === true
  let forcePreviousDimension: number | null = null
  if (force && tableExists(db)) {
    forcePreviousDimension = readStoredDimension(db)
    db.exec('DROP TABLE chunks')
  }
  const before = existingFiles(db)
  const files = await readSources(repoRoot, sources)
  const fileByPath = new Map(files.map(file => [file.filePath, file]))
  const deleted = force
    ? []
    : [...before.keys()].filter(path => !fileByPath.has(path))

  let queue: FileMeta[] = force
    ? [...files]
    : files.filter(file => before.get(file.filePath) !== file.hash)

  let dimension = 0
  let dimensionChanged = false
  let schemaEnsured = false
  let upserted = 0
  const written = new Set<string>()

  if (!force && queue.length === 0 && tableExists(db)) {
    const stored = readStoredDimension(db)
    if (stored !== null) {
      const probes = await options.embedder.embed([DIMENSION_PROBE_TEXT])
      const probe = probes[0]
      if (probe !== undefined && probe.length > 0 && probe.length !== stored) {
        db.exec('DROP TABLE chunks')
        dimensionChanged = true
        queue = [...files]
      }
    }
  }

  const flush = async (rows: InsertRow[]): Promise<void> => {
    if (rows.length === 0) {
      return
    }
    const texts = rows.map(row => row.chunk.content)
    const embeddings = await options.embedder.embed(texts)
    if (embeddings.length !== texts.length) {
      throw new KnowledgeError('EMBED_FAILED', 'Сервис эмбеддингов вернул неверное число векторов — проверьте Ollama.')
    }
    const first = embeddings[0]
    if (first === undefined) {
      return
    }
    for (let i = 0; i < rows.length; i += 1) {
      const values = embeddings[i]
      const row = rows[i]
      if (row !== undefined && values !== undefined) {
        row.embedding = values
      }
    }
    if (!schemaEnsured) {
      dimension = first.length
      const schema = ensureSchema(db, dimension)
      schemaEnsured = true
      if (schema.status === 'recreated') {
        dimensionChanged = true
        upserted = 0
        written.clear()
        deleted.length = 0
        queue = [...files]
        cursor = 0
      }
      else if (forcePreviousDimension !== null && forcePreviousDimension !== dimension) {
        dimensionChanged = true
      }
    }
    upserted += writeFlush(db, rows)
    markWritten(rows)
  }

  const markWritten = (rows: readonly InsertRow[]): void => {
    for (const row of rows) {
      written.add(row.chunk.filePath)
    }
  }

  let cursor = 0
  while (cursor < queue.length) {
    const file = queue[cursor]
    cursor += 1
    if (file === undefined) {
      continue
    }
    await flush(chunksOf(file))
  }

  if (deleted.length > 0) {
    db.transaction(() => {
      deleteFilePaths(db, deleted)
    })()
  }

  const currentDimension = dimension !== 0 ? dimension : readStoredDimension(db) ?? 0
  return {
    filesTotal: files.length,
    filesIndexed: written.size,
    filesSkipped: Math.max(0, files.length - written.size),
    filesDeleted: deleted.length,
    chunksUpserted: upserted,
    dimension: currentDimension,
    dimensionChanged,
  }

  function chunksOf(file: FileMeta): InsertRow[] {
    return chunkSource(file.content, file.filePath, file.fileType)
      .map(chunk => ({ chunk, embedding: [], fileHash: file.hash }))
  }
}

function writeFlush(db: Database, rows: readonly InsertRow[]): number {
  const paths = new Set(rows.map(row => row.chunk.filePath))
  db.transaction(() => {
    deleteFilePaths(db, [...paths])
    upsertChunks(db, rows)
  })()
  return rows.length
}

async function readSources(repoRoot: string, sources: SourceFile[]): Promise<FileMeta[]> {
  const files: FileMeta[] = []
  for (const source of sources) {
    let content: string
    try {
      content = await readFile(join(repoRoot, ...source.filePath.split('/')), 'utf8')
    }
    catch {
      throw new KnowledgeError('WALK_FAILED', WALK_FAILED_MESSAGE)
    }
    files.push({
      filePath: source.filePath,
      fileType: source.fileType,
      hash: createHash('sha256').update(content, 'utf8').digest('hex'),
      content,
    })
  }
  return files
}

function chunkSource(content: string, filePath: string, fileType: FileType): Chunk[] {
  return chunkMarkdownLike(fileType)
    ? chunkMarkdown(content, filePath)
    : chunkCode(content, filePath, fileType)
}

function chunkMarkdownLike(fileType: FileType): boolean {
  return fileType === 'readme' || fileType === 'docs' || fileType === 'specs' || fileType === 'adr'
}
