import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { resolve } from 'node:path'
import process from 'node:process'
import { DB_INCOMPATIBLE_MESSAGE, KnowledgeError } from './errors.js'
import type { Chunk } from './types.js'

export const DEFAULT_DB_PATH = '.data/knowledge.db'

export type Database = Database.Database

export interface InsertRow {
  chunk: Chunk
  embedding: number[]
  fileHash: string
}

export interface MatchRow {
  filePath: string
  fileType: string
  headingPath: string
  content: string
  distance: number
}

export type SchemaStatus = 'created' | 'recreated' | 'reused'

export interface SchemaResult {
  status: SchemaStatus
  previousDimension?: number
}

export function resolveDbPath(dbPath?: string): string {
  const raw = dbPath ?? process.env['KNOWLEDGE_DB'] ?? DEFAULT_DB_PATH
  return raw === ':memory:' ? raw : resolve(raw)
}

export function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  sqliteVec.load(db)
  return db
}

export function tableExists(db: Database.Database): boolean {
  const row = db.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', 'chunks')
  return row !== undefined
}

export function ensureSchema(db: Database.Database, dimension: number): SchemaResult {
  if (!tableExists(db)) {
    db.exec(createSql(dimension))
    db.pragma(`user_version = ${dimension}`)
    return { status: 'created' }
  }
  if (readStoredDimension(db) === dimension) {
    return { status: 'reused' }
  }
  const previousDimension = readStoredDimension(db)
  db.exec('DROP TABLE chunks')
  db.exec(createSql(dimension))
  db.pragma(`user_version = ${dimension}`)
  return {
    status: 'recreated',
    previousDimension: previousDimension ?? undefined,
  }
}

export function readStoredDimension(db: Database.Database): number | null {
  if (!tableExists(db)) {
    return null
  }
  const declared = db.pragma('user_version', { simple: true }) as number
  if (declared > 0) {
    return declared
  }
  const row = db.prepare('SELECT embedding FROM chunks LIMIT 1').get() as { embedding: Uint8Array } | undefined
  if (row !== undefined) {
    const dimension = row.embedding.byteLength / 4
    db.pragma(`user_version = ${dimension}`)
    return dimension
  }
  const candidates = [4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512, 768, 1024, 1536, 2048, 3072, 4096]
  for (const candidate of candidates) {
    const probed = probeDimension(db, candidate)
    if (probed !== null) {
      db.pragma(`user_version = ${probed}`)
      return probed
    }
  }
  return null
}

function probeDimension(db: Database.Database, dimension: number): number | null {
  db.exec('BEGIN')
  try {
    db.prepare('INSERT INTO chunks(embedding, file_path, file_type, heading_path, content, file_hash) VALUES (?, ?, ?, ?, ?, ?)')
      .run(toVector(new Array<number>(dimension).fill(0)), '\u0000probe\u0000', 'docs', '', '\u0000probe\u0000', '\u0000probe\u0000')
    const row = db.prepare('SELECT embedding FROM chunks LIMIT 1').get() as { embedding: Uint8Array } | undefined
    return row === undefined ? null : row.embedding.byteLength / 4
  }
  catch {
    return null
  }
  finally {
    db.exec('ROLLBACK')
  }
}

export function createSql(dimension: number): string {
  return `CREATE VIRTUAL TABLE chunks USING vec0(
  embedding float[${dimension}],
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  heading_path TEXT NOT NULL,
  content TEXT NOT NULL,
  file_hash TEXT NOT NULL
)`
}

export function existingFiles(db: Database.Database): Map<string, string> {
  const map = new Map<string, string>()
  if (!tableExists(db)) {
    return map
  }
  const rows = db.prepare('SELECT file_path, file_hash FROM chunks').all() as { file_path: string; file_hash: string }[]
  for (const row of rows) {
    map.set(row.file_path, row.file_hash)
  }
  return map
}

export function toVector(values: number[]): Buffer {
  return Buffer.from(new Float32Array(values).buffer)
}

export function readRowIds(db: Database.Database, filePath: string): number[] {
  const rows = db.prepare('SELECT rowid FROM chunks WHERE file_path = ?').all(filePath) as { rowid: number }[]
  return rows.map(row => row.rowid)
}

export function deleteFilePaths(db: Database.Database, paths: readonly string[]): number {
  if (!tableExists(db) || paths.length === 0) {
    return 0
  }
  const del = db.prepare('DELETE FROM chunks WHERE rowid = ?')
  let deleted = 0
  for (const path of paths) {
    for (const rowid of readRowIds(db, path)) {
      del.run(rowid)
      deleted += 1
    }
  }
  return deleted
}

export function upsertChunks(db: Database.Database, rows: readonly InsertRow[]): number {
  const insert = db.prepare(
    'INSERT INTO chunks(embedding, file_path, file_type, heading_path, content, file_hash) VALUES (?, ?, ?, ?, ?, ?)',
  )
  for (const row of rows) {
    insert.run(
      toVector(row.embedding),
      row.chunk.filePath,
      row.chunk.fileType,
      row.chunk.headingPath ?? '',
      row.chunk.content,
      row.fileHash,
    )
  }
  return rows.length
}

export function searchChunks(db: Database.Database, vector: number[], fetchK: number): MatchRow[] {
  const stored = readStoredDimension(db)
  if (stored !== null && vector.length !== stored) {
    throw new KnowledgeError('DB_INCOMPATIBLE', DB_INCOMPATIBLE_MESSAGE)
  }
  try {
    const rows = db.prepare(`
      SELECT c.file_path AS filePath, c.file_type AS fileType, c.heading_path AS headingPath, c.content AS content, m.distance AS distance
      FROM (SELECT rowid, distance FROM chunks WHERE embedding MATCH ? AND k = ?) m
      JOIN chunks c ON c.rowid = m.rowid
      ORDER BY m.distance
    `).all(toVector(vector), fetchK) as unknown as MatchRow[]
    return rows.map(row => ({
      filePath: row.filePath,
      fileType: row.fileType,
      headingPath: row.headingPath,
      content: row.content,
      distance: row.distance,
    }))
  }
  catch (error) {
    if (error instanceof Error && /dimension mismatch/i.test(error.message)) {
      throw new KnowledgeError('DB_INCOMPATIBLE', DB_INCOMPATIBLE_MESSAGE)
    }
    throw error
  }
}
