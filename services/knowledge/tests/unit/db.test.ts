import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, tableExists, ensureSchema, existingFiles, searchChunks, readStoredDimension, createSql, toVector, resolveDbPath, DEFAULT_DB_PATH } from '../../src/db.js'
import { repoRoot } from '../../src/repoRoot.js'
import { KnowledgeError } from '../../src/errors.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'knowledge-db-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('resolveDbPath', () => {
  it('resolves a relative path against the repository root (not the package cwd)', () => {
    expect(resolveDbPath('.data/knowledge.db')).toBe(join(repoRoot(), '.data', 'knowledge.db'))
  })

  it('keeps :memory: and absolute paths as-is', () => {
    expect(resolveDbPath(':memory:')).toBe(':memory:')
    expect(resolveDbPath(join(dir, 'custom.db'))).toBe(join(dir, 'custom.db'))
  })
})

describe('ensureSchema on :memory:', () => {
  it('creates the chunks virtual table with the stored dimension', () => {
    const db = openDatabase(':memory:')
    expect(tableExists(db)).toBe(false)
    const result = ensureSchema(db, 8)
    expect(result.status).toBe('created')
    expect(tableExists(db)).toBe(true)
    expect(readStoredDimension(db)).toBe(8)
    db.close()
  })

  it('reuses the schema when the dimension matches', () => {
    const db = openDatabase(':memory:')
    ensureSchema(db, 8)
    const result = ensureSchema(db, 8)
    expect(result.status).toBe('reused')
    db.close()
  })

  it('AC-9 base: recreates on dimension mismatch', () => {
    const db = openDatabase(':memory:')
    ensureSchema(db, 8)
    const result = ensureSchema(db, 4)
    expect(result.status).toBe('recreated')
    expect(result.previousDimension).toBe(8)
    expect(tableExists(db)).toBe(true)
    db.close()
  })

  it('probe leaves no rows behind (AC-11 base)', () => {
    const db = openDatabase(':memory:')
    ensureSchema(db, 8)
    const probe = ensureSchema(db, 8)
    expect(probe.status).toBe('reused')
    const rows = db.prepare('SELECT count(*) AS total FROM chunks').get() as { total: number }
    expect(rows.total).toBe(0)
    db.close()
  })
})

describe('file database', () => {
  it('persists schema across reopen and reuses dimensions', () => {
    mkdirSync(join(dir, 'sub'), { recursive: true })
    const path = join(dir, 'sub', 'knowledge.db')
    const first = openDatabase(path)
    expect(first).not.toBeNull()
    ensureSchema(first, 8)
    first.close()
    expect(existsSync(path)).toBe(true)
    const second = openDatabase(path)
    expect(tableExists(second)).toBe(true)
    expect(ensureSchema(second, 8).status).toBe('reused')
    expect(ensureSchema(second, 6).status).toBe('recreated')
    expect(readStoredDimension(second)).toBe(6)
    second.close()
  })
})

describe('rows', () => {
  it('existingFiles maps file hashes; replacement by path works', () => {
    const db = openDatabase(':memory:')
    ensureSchema(db, 4)
    const insert = db.prepare('INSERT INTO chunks(embedding, file_path, file_type, heading_path, content, file_hash) VALUES (?, ?, ?, ?, ?, ?)')
    db.transaction(() => {
      insert.run(toVector([1, 0, 0, 0]), 'a.md', 'docs', 'A', 'content a', 'hash-a1')
      insert.run(toVector([0, 1, 0, 0]), 'a.md', 'docs', 'A', 'content a2', 'hash-a1')
      insert.run(toVector([0, 0, 1, 0]), 'b.md', 'docs', '', 'content b', 'hash-b')
    })()
    const files = existingFiles(db)
    expect(files.get('a.md')).toBe('hash-a1')
    expect(files.get('b.md')).toBe('hash-b')
    expect(existingFiles(openDatabase(':memory:')).size).toBe(0)
    expect(existingFiles(db).size).toBe(2)
    db.close()
  })

  it('searchChunks returns ordered matches and maps dimension mismatch', () => {
    const db = openDatabase(':memory:')
    ensureSchema(db, 4)
    const insert = db.prepare('INSERT INTO chunks(embedding, file_path, file_type, heading_path, content, file_hash) VALUES (?, ?, ?, ?, ?, ?)')
    insert.run(toVector([1, 0, 0, 0]), 'a.md', 'docs', 'A', 'content a', 'h1')
    insert.run(toVector([0, 1, 0, 0]), 'b.md', 'docs', '', 'content b', 'h2')
    const rows = searchChunks(db, [0.9, 0.1, 0, 0], 2)
    expect(rows[0]?.filePath).toBe('a.md')
    expect(rows[0]?.headingPath).toBe('A')
    expect(rows[1]?.filePath).toBe('b.md')
    expect(rows.length).toBe(2)
    expect(() => searchChunks(db, [1, 1, 1, 1, 1, 1, 1, 1], 2)).toThrowError(/Размерность/)
    let thrown: unknown
    try {
      searchChunks(db, [1, 1, 1, 1, 1, 1, 1, 1], 2)
    }
    catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(KnowledgeError)
    expect((thrown as KnowledgeError).code).toBe('DB_INCOMPATIBLE')
    db.close()
  })

  it('createSql embeds the given dimension (no hardcode)', () => {
    expect(createSql(16)).toContain('float[16]')
    expect(readStoredDimension(openDatabase(':memory:'))).toBeNull()
  })
})

describe('defaults', () => {
  it('DEFAULT_DB_PATH is .data/knowledge.db', () => {
    expect(DEFAULT_DB_PATH).toBe('.data/knowledge.db')
  })
})
