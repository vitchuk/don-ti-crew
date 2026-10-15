import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DocsError,
  INDEX_NOT_BUILT,
  OLLAMA_UNAVAILABLE,
  DB_INCOMPATIBLE,
  MODEL_NOT_FOUND,
  SEARCH_TIMEOUT,
  SEARCH_UNKNOWN,
  defaultDocSearch,
  makeSearchProjectDocs,
  knowledgeDocSearch,
  type DocSearchArgs,
  type SearchProjectDocsResult,
} from '../../src/adapters/docs'
import { index as knowledgeIndex, FakeEmbedder, KnowledgeError, ERROR_MESSAGES } from '@don-ti/knowledge'

function stubSearch(results: SearchProjectDocsResult, calls: DocSearchArgs[] = []): (args: DocSearchArgs) => Promise<SearchProjectDocsResult> {
  return async (args) => {
    calls.push(args)
    return results
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('makeSearchProjectDocs', () => {
  it('AC-6: results with file, heading, score, total; excerpt ≤ 500', async () => {
    const calls: DocSearchArgs[] = []
    const search = makeSearchProjectDocs(stubSearch({
      results: [
        { file: 'specs/001/spec.md', heading: 'Фаза отдыха', excerpt: 'x'.repeat(900), score: 0.93 },
      ],
      total: 7,
    }, calls))
    const result = await search({ query: 'фаза отдыха', k: 2 })
    expect(calls).toEqual([{ query: 'фаза отдыха', k: 2 }])
    expect(result.total).toBe(7)
    expect(result.results).toHaveLength(1)
    expect(result.results[0]?.file).toBe('specs/001/spec.md')
    expect(result.results[0]?.heading).toBe('Фаза отдыха')
    expect(result.results[0]?.score).toBe(0.93)
    expect(result.results[0]?.excerpt.length).toBeLessThanOrEqual(500)
  })

  it('short excerpt is passed as is, heading is optional', async () => {
    const search = makeSearchProjectDocs(stubSearch({
      results: [{ file: 'GLOSSARY.md', excerpt: 'слово', score: 0.5 }],
      total: 1,
    }))
    const result = await search({ query: 'слово' })
    expect(result.results[0]).toEqual({ file: 'GLOSSARY.md', heading: undefined, excerpt: 'слово', score: 0.5 })
  })

  it('AC-7: index not built → exactly one sentence «запустите pnpm rag:index»', async () => {
    const search = makeSearchProjectDocs(async () => {
      throw new DocsError('index-not-built', 'some internal text')
    })
    await expect(search({ query: 'фаза' })).rejects.toThrow(INDEX_NOT_BUILT)
  })

  it('Ollama unavailable → one sentence with http://localhost:11434', async () => {
    const search = makeSearchProjectDocs(async () => {
      throw new DocsError('ollama-unavailable', 'ECONNREFUSED')
    })
    await expect(search({ query: 'фаза' })).rejects.toThrow(OLLAMA_UNAVAILABLE)
  })

  it('timeout → one-sentence message (NFR-2)', async () => {
    const search = makeSearchProjectDocs(async () => {
      await new Promise<void>(() => undefined)
      throw new Error('unreachable')
    }, { timeoutMs: 20 })
    await expect(search({ query: 'фаза' })).rejects.toThrow(SEARCH_TIMEOUT)
  })

  it('unknown error is translated into a single-sentence text with the original', async () => {
    const search = makeSearchProjectDocs(async () => {
      throw new Error('broken pipe')
    })
    const error = await search({ query: 'фаза' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DocsError)
    const message = (error as DocsError).message
    expect(message).toContain('broken pipe')
    expect(message.startsWith(SEARCH_UNKNOWN)).toBe(true)
  })

  it('defaultDocSearch: index is not built', async () => {
    const search = defaultDocSearch()
    await expect(search({ query: 'фаза' })).rejects.toThrow(INDEX_NOT_BUILT)
  })
})

describe('knowledgeDocSearch (real @don-ti/knowledge integration)', () => {
  let repo: string
  let dbPath: string

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'mcp-docs-repo-'))
    dbPath = join(repo, '.data', 'knowledge.db')
    await mkdir(join(repo, 'docs'), { recursive: true })
    await writeFile(join(repo, 'GLOSSARY.md'), '# Глоссарий\n\n## Раунд\n\nКак задаются раунды и циклы: раунды идут внутри циклов.\n', 'utf8')
    await writeFile(join(repo, 'README.md'), '# Проект\n\nПресет Табата двадцать секунд работы.\n', 'utf8')
    await writeFile(join(repo, 'docs/guide.md'), '# Гайд\n\nШаблон тренировки задаёт интервалы и отдых.\n', 'utf8')
    await writeFile(join(repo, 'package.json'), '{ "name": "fixture" }\n', 'utf8')
  })

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true })
  })

  it('returns real top-k hits after indexing with FakeEmbedder', async () => {
    await knowledgeIndex({ repoRoot: repo, dbPath, embedder: new FakeEmbedder() })
    const search = makeSearchProjectDocs(knowledgeDocSearch({ dbPath, embedder: new FakeEmbedder() }))
    const result = await search({ query: 'как задаются раунды и циклы' })
    expect(result.total).toBeGreaterThan(0)
    expect(result.results[0]?.file).toBe('GLOSSARY.md')
    expect(result.results[0]?.heading).toBe('Глоссарий > Раунд')
    expect(result.results[0]?.excerpt.length).toBeLessThanOrEqual(500)
    expect(result.results[0]?.score).toBeGreaterThan(0)
    expect(result.results[0]?.score).toBeLessThanOrEqual(1)
  })

  it('type filter reaches the library (AC-6 spec 002)', async () => {
    await knowledgeIndex({ repoRoot: repo, dbPath, embedder: new FakeEmbedder() })
    const search = knowledgeDocSearch({ dbPath, embedder: new FakeEmbedder() })
    const result = await search({ query: 'пресет табата работа', type: 'readme' })
    expect(result.results.length).toBeGreaterThan(0)
    expect(result.results.every(result => result.file === 'README.md')).toBe(true)
  })

  it('missing index → canonical one-sentence message', async () => {
    const search = makeSearchProjectDocs(knowledgeDocSearch({ dbPath: join(repo, 'absent.db'), embedder: new FakeEmbedder() }))
    await expect(search({ query: 'тест' })).rejects.toThrow(INDEX_NOT_BUILT)
  })

  it('KnowledgeError codes are mapped onto DocsError kinds', async () => {
    await knowledgeIndex({ repoRoot: repo, dbPath, embedder: new FakeEmbedder() })
    const search = makeSearchProjectDocs(knowledgeDocSearch({
      dbPath,
      embedder: throwingEmbedder('DB_INCOMPATIBLE'),
    }))
    const error = await search({ query: 'тест' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DocsError)
    expect((error as DocsError).kind).toBe('db-incompatible')
    expect((error as DocsError).message).toBe(DB_INCOMPATIBLE)
    const ollamaSearch = makeSearchProjectDocs(knowledgeDocSearch({ dbPath, embedder: throwingEmbedder('OLLAMA_UNAVAILABLE') }))
    const unavailable = await ollamaSearch({ query: 'тест' }).catch((e: unknown) => e)
    expect((unavailable as DocsError).kind).toBe('ollama-unavailable')
    expect((unavailable as DocsError).message).toBe(OLLAMA_UNAVAILABLE)
    const modelSearch = makeSearchProjectDocs(knowledgeDocSearch({ dbPath, embedder: throwingEmbedder('MODEL_NOT_FOUND') }))
    const model = await modelSearch({ query: 'тест' }).catch((e: unknown) => e)
    expect((model as DocsError).kind).toBe('model-not-found')
    expect((model as DocsError).message).toBe(MODEL_NOT_FOUND)
  })

  function throwingEmbedder(code: 'DB_INCOMPATIBLE' | 'OLLAMA_UNAVAILABLE' | 'MODEL_NOT_FOUND'): {
    embed: (texts: string[]) => Promise<number[][]>
  } {
    return {
      embed: async (texts: string[]): Promise<number[][]> => {
        void texts
        throw new KnowledgeError(code, ERROR_MESSAGES[code])
      },
    }
  }
})
