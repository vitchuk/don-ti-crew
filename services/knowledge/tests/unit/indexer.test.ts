import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { index } from '../../src/indexer.js'
import { query } from '../../src/query.js'
import { FakeEmbedder, type Embedder } from '../../src/embeddings.js'
import { openDatabase, ensureSchema } from '../../src/db.js'
import { buildRepo, type TmpRepo } from '../helpers/testRepo.js'

let repo: TmpRepo

beforeEach(() => {
  repo = buildRepo()
})

afterEach(() => {
  repo.dispose()
})

function crashingEmbedder(allowedCalls: number, fallback: FakeEmbedder): Embedder {
  let calls = 0
  return {
    async embed(texts: string[]): Promise<number[][]> {
      calls += 1
      if (calls > allowedCalls) {
        throw new Error('simulated ctrl+c')
      }
      return await fallback.embed(texts)
    },
  }
}

function rowsStats(dbPath: string): { total: number; dupes: number } {
  const db = openDatabase(dbPath)
  ensureSchema(db, 8)
  const total = db.prepare('SELECT count(*) AS total FROM chunks').get() as { total: number }
  const dupes = db.prepare(
    'SELECT max(CASE WHEN dfn > 1 THEN 1 ELSE 0 END) AS flagged FROM (SELECT count(*) AS dfn FROM chunks GROUP BY content, file_path, heading_path)',
  ).get() as { flagged: number | null }
  db.close()
  return { total: total.total, dupes: dupes.flagged ?? 0 }
}

describe('index', () => {
  it('AC-1: first run indexes all sources with the embedder dimension', async () => {
    const embedder = new FakeEmbedder()
    const summary = await index({ repoRoot: repo.dir, dbPath: repo.dbPath, embedder })
    expect(summary.filesTotal).toBe(13)
    expect(summary.filesIndexed).toBe(summary.filesTotal)
    expect(summary.filesSkipped).toBe(0)
    expect(summary.dimension).toBe(8)
    expect(summary.chunksUpserted).toBeGreaterThan(0)
    expect(summary.chunksUpserted).toBe(embedder.texts.length)
  })

  it('unchanged rerun skips files and embeds nothing', async () => {
    await index({ repoRoot: repo.dir, dbPath: repo.dbPath, embedder: new FakeEmbedder() })
    const embedder = new FakeEmbedder()
    const summary = await index({ repoRoot: repo.dir, dbPath: repo.dbPath, embedder })
    expect(summary.filesIndexed).toBe(0)
    expect(summary.filesSkipped).toBe(summary.filesTotal)
    expect(summary.filesDeleted).toBe(0)
    expect(summary.chunksUpserted).toBe(0)
    expect(embedder.texts).toEqual(['knowledge dimension probe'])
    const embedder2 = new FakeEmbedder()
    const rerun = await index({ repoRoot: repo.dir, dbPath: repo.dbPath, embedder: embedder2 })
    expect(rerun.chunksUpserted).toBe(0)
    expect(embedder2.texts).toEqual(['knowledge dimension probe'])
  })

  it('AC-9 early: unchanged repo with a different embedder dimension still rebuilds fully', async () => {
    await index({ repoRoot: repo.dir, dbPath: repo.dbPath, embedder: new FakeEmbedder(8) })
    const summary = await index({ repoRoot: repo.dir, dbPath: repo.dbPath, embedder: new FakeEmbedder(4) })
    expect(summary.dimensionChanged).toBe(true)
    expect(summary.dimension).toBe(4)
    expect(summary.filesIndexed).toBe(summary.filesTotal)
    expect(summary.chunksUpserted).toBeGreaterThan(0)
  })

  it('AC-9 force: --force with a changed embedder dimension reports the dimension change', async () => {
    await index({ repoRoot: repo.dir, dbPath: repo.dbPath, embedder: new FakeEmbedder(8) })
    const summary = await index({ repoRoot: repo.dir, dbPath: repo.dbPath, embedder: new FakeEmbedder(4), force: true })
    expect(summary.dimensionChanged).toBe(true)
    expect(summary.dimension).toBe(4)
    expect(summary.filesIndexed).toBe(summary.filesTotal)
    expect(summary.chunksUpserted).toBeGreaterThan(0)
  })

  it('AC-9 force: --force with the same dimension does not claim the change', async () => {
    await index({ repoRoot: repo.dir, dbPath: repo.dbPath, embedder: new FakeEmbedder(8) })
    const summary = await index({ repoRoot: repo.dir, dbPath: repo.dbPath, embedder: new FakeEmbedder(8), force: true })
    expect(summary.dimensionChanged).toBe(false)
  })

  it('M-3: schema re-creation after the cursor advanced re-indexes the passed files too', async () => {
    await index({ repoRoot: repo.dir, dbPath: repo.dbPath, embedder: new FakeEmbedder(8) })
    repo.write('docs/guide.md', 'Переписанный текст гайда про интервалы и отдых.\n')
    const summary = await index({ repoRoot: repo.dir, dbPath: repo.dbPath, embedder: new FakeEmbedder(4) })
    expect(summary.dimensionChanged).toBe(true)
    expect(summary.filesIndexed).toBe(summary.filesTotal)
    expect(summary.filesSkipped).toBe(0)
    expect(summary.chunksUpserted).toBeGreaterThan(0)
  })

  it('AC-2: only the changed file is recomputed, the deleted one is cleaned up', async () => {
    await index({ repoRoot: repo.dir, dbPath: repo.dbPath, embedder: new FakeEmbedder() })
    repo.remove('docs/adr/0005-x.md')
    repo.write('docs/guide.md', 'Полностью новый текст гайда про отдых и интервалы.\n')
    const embedder = new FakeEmbedder()
    const summary = await index({ repoRoot: repo.dir, dbPath: repo.dbPath, embedder })
    expect(summary.filesDeleted).toBe(1)
    expect(summary.filesIndexed).toBe(1)
    expect(embedder.texts.some(text => text.includes('новый текст гайда'))).toBe(true)
    expect(embedder.texts.some(text => text.includes('Раунды идут'))).toBe(false)
    const gone = await query('qwen3-embedding через Ollama', { dbPath: repo.dbPath, embedder: new FakeEmbedder() })
    expect(gone.results.some(result => result.file === 'docs/adr/0005-x.md')).toBe(false)
  })

  it('AC-3: --force rebuilds everything', async () => {
    await index({ repoRoot: repo.dir, dbPath: repo.dbPath, embedder: new FakeEmbedder() })
    const embedder = new FakeEmbedder()
    const summary = await index({ repoRoot: repo.dir, dbPath: repo.dbPath, embedder, force: true })
    expect(summary.filesIndexed).toBe(summary.filesTotal)
    expect(summary.filesSkipped).toBe(0)
    expect(summary.chunksUpserted).toBeGreaterThan(0)
    expect(embedder.texts.some(text => text.includes('Проект: приложение'))).toBe(true)
  })

  it('AC-9: dimension change recreates the index fully', async () => {
    await index({ repoRoot: repo.dir, dbPath: repo.dbPath, embedder: new FakeEmbedder(8) })
    const summary = await index({ repoRoot: repo.dir, dbPath: repo.dbPath, embedder: new FakeEmbedder(4) })
    expect(summary.dimensionChanged).toBe(true)
    expect(summary.dimension).toBe(4)
    expect(summary.filesIndexed).toBe(summary.filesTotal)
    const after = await query('раунды и циклы', { dbPath: repo.dbPath, embedder: new FakeEmbedder(4) })
    expect(after.results.every(result => result.score > 0)).toBe(true)
  })

  it('AC-11: interruption between batches keeps the index consistent; rerun completes without duplicates', async () => {
    const big = Array.from({ length: 2000 }, (_, i) => `export const v${i} = () => ${i} small body here`).join('\n\n')
    repo.write('services/extra/src/big.ts', big)
    const abort = crashingEmbedder(1, new FakeEmbedder())
    await expect(index({ repoRoot: repo.dir, dbPath: repo.dbPath, embedder: abort })).rejects.toThrowError('simulated ctrl+c')
    const before = rowsStats(repo.dbPath)
    expect(before.dupes).toBe(0)
    expect(before.total).toBeGreaterThan(0)
    const done = await index({ repoRoot: repo.dir, dbPath: repo.dbPath, embedder: new FakeEmbedder() })
    expect(done.filesIndexed).toBeGreaterThanOrEqual(done.filesTotal - 1)
    expect(done.filesDeleted).toBe(0)
    const after = rowsStats(repo.dbPath)
    expect(after.dupes).toBe(0)
    const reference = join(repo.dir, '.data', 'reference.db')
    await index({ repoRoot: repo.dir, dbPath: reference, embedder: new FakeEmbedder(), force: true })
    expect(after.total).toBe(rowsStats(reference).total)
    expect(after.total).toBeGreaterThan(before.total)
  })
})
