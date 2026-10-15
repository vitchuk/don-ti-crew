import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { index } from '../../src/indexer.js'
import { query } from '../../src/query.js'
import { FakeEmbedder } from '../../src/embeddings.js'
import { KnowledgeError, ERROR_MESSAGES } from '../../src/errors.js'
import { buildRepo, type TmpRepo } from '../helpers/testRepo.js'

let repo: TmpRepo

beforeEach(() => {
  repo = buildRepo()
})

afterEach(() => {
  repo.dispose()
})

const LONG_PARAGRAPH = Array.from({ length: 30 }, (_, i) => `Пресет табата состоит из интервалов номер ${i} длительностью двадцать секунд работы и десять секунд отдыха.`).join(' ')

async function seed(embedder = new FakeEmbedder()): Promise<void> {
  repo.write('docs/intervals.md', `# Интервалы\n\n## Пресеты\n\n${LONG_PARAGRAPH}\n`)
  await index({ repoRoot: repo.dir, dbPath: repo.dbPath, embedder })
}

describe('query', () => {
  it('AC-5: missing database → NOT_INDEXED with the canonical one-sentence text', async () => {
    const missing = join(repo.dir, '.data', 'absent.db')
    const error = await query('тест', { dbPath: missing, embedder: new FakeEmbedder() }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(KnowledgeError)
    expect((error as KnowledgeError).code).toBe('NOT_INDEXED')
    expect((error as KnowledgeError).message).toBe(ERROR_MESSAGES.NOT_INDEXED)
  })

  it('AC-5 base: database without the chunks table → NOT_INDEXED', async () => {
    const emptyDb = join(repo.dir, 'empty.db')
    const { openDatabase } = await import('../../src/db.js')
    openDatabase(emptyDb).close()
    const error = await query('тест', { dbPath: emptyDb, embedder: new FakeEmbedder() }).catch((e: unknown) => e)
    expect((error as KnowledgeError).code).toBe('NOT_INDEXED')
  })

  it('AC-4: returns hits with file, heading, excerpt and score', async () => {
    await seed()
    const response = await query('как идут раунды и отдых внутри циклов', { dbPath: repo.dbPath, embedder: new FakeEmbedder() })
    expect(response.total).toBe(response.results.length)
    expect(response.results.length).toBeGreaterThan(0)
    expect(response.results.length).toBeLessThanOrEqual(5)
    const first = response.results[0]
    expect(first?.file).toBe('docs/guide.md')
    expect(first?.heading).toBe('Гайд по тренировке > Раунды и циклы')
    expect(first?.excerpt.length).toBeLessThanOrEqual(500)
    expect(first?.score).toBeGreaterThan(0)
    expect(first?.score).toBeLessThanOrEqual(1)
  })

  it('excerpt ≤ 500 chars even for oversized content', async () => {
    await seed()
    const response = await query('пресет табата интервалы', { dbPath: repo.dbPath, embedder: new FakeEmbedder() })
    const hit = response.results.find(result => result.file === 'docs/intervals.md')
    expect(hit).toBeDefined()
    expect(hit?.excerpt.length ?? 0).toBeLessThanOrEqual(500)
  })

  it('AC-6: type filter returns only that file_type', async () => {
    await seed()
    const response = await query('эмбеддинги считаются локально', { dbPath: repo.dbPath, embedder: new FakeEmbedder(), type: 'adr' })
    expect(response.results.length).toBeGreaterThan(0)
    expect(response.results.every(result => result.file === 'docs/adr/0005-x.md')).toBe(true)
    const unfiltered = await query('эмбеддинги считаются локально', { dbPath: repo.dbPath, embedder: new FakeEmbedder() })
    expect(unfiltered.results.some(result => result.file !== 'docs/adr/0005-x.md')).toBe(true)
  })

  it('DB_INCOMPATIBLE: different embedder dimension is machine-classified', async () => {
    await seed()
    const error = await query('тест', { dbPath: repo.dbPath, embedder: new FakeEmbedder(4) }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(KnowledgeError)
    expect((error as KnowledgeError).code).toBe('DB_INCOMPATIBLE')
    expect((error as KnowledgeError).message).toBe(ERROR_MESSAGES.DB_INCOMPATIBLE)
  })

  it('k controls the number of hits', async () => {
    await seed()
    const response = await query('раунды циклы интервалы отдых пресет', { dbPath: repo.dbPath, embedder: new FakeEmbedder(), k: 3 })
    expect(response.results.length).toBeLessThanOrEqual(3)
  })
})
