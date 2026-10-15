import { describe, expect, it } from 'vitest'
import {
  ragContext,
  groupAreas,
  clampK,
  areaQueries,
  areaTypeOf,
  dedupeFragments,
  applyBudget,
  CONTEXT_BUDGET_BYTES,
  type CitedFragment,
} from '../../src/context'
import { stubSession } from '../fixtures/stubSession'

const FILES = [
  { file: 'apps/assistant/backend/a.ts', state: 'modified' as const },
  { file: 'services/review/collect.ts', state: 'added' as const },
  { file: 'docs/adr/0005-rag-stack-ollama-sqlite-vec-deepseek.md', state: 'modified' as const },
  { file: 'README.md', state: 'modified' as const },
]

function docsPayload(query: string): unknown {
  if (query.includes('0005-rag-stack-ollama-sqlite-vec-deepseek.md')) {
    return {
      results: [
        { file: 'docs/adr/0005-rag-stack-ollama-sqlite-vec-deepseek.md', heading: 'Решение', excerpt: 'oled stack', score: 0.9 },
        { file: 'specs/003-knowledge-rag/spec.md', heading: 'FR-8', excerpt: 'дефолтный путь', score: 0.8 },
      ],
      total: 2,
    }
  }
  const duplicate = query.includes('apps/assistant')
  return {
    results: duplicate
      ? [
          { file: 'specs/004-project-assistant/spec.md', heading: 'Сценарии', excerpt: 'помощник', score: 0.7 },
          { file: 'apps/assistant/backend/llm.ts', heading: undefined, excerpt: 'createLlm', score: 0.6 },
        ]
      : [
          { file: 'apps/assistant/backend/llm.ts', heading: undefined, excerpt: 'createLlm', score: 0.6 },
        ],
    total: 0,
  }
}

describe('groupAreas / areaQueries / areaTypeOf (константы плана)', () => {
  it('области — первые два уровня пути', () => {
    const areas = groupAreas(FILES)
    expect(areas.map(area => area.name)).toEqual([
      'apps/assistant',
      'services/review',
      'docs/adr',
      'root',
    ])
    expect(areaTypeOf('apps/assistant')).toBe('code')
    expect(areaTypeOf('services/review')).toBe('code')
    expect(areaTypeOf('docs/adr')).toBe('adr')
    expect(areaTypeOf('docs/guides')).toBe('docs')
    expect(areaTypeOf('specs/003-knowledge-rag')).toBe('specs')
    expect(areaTypeOf('root')).toBeUndefined()
  })

  it('на область не более 2 запросов: широкий + фокусный с ключевыми словами', () => {
    const area = groupAreas([{ file: 'services/review/collect.ts', state: 'added' }])
    const queries = areaQueries(area[0]!)
    expect(queries).toHaveLength(2)
    expect(queries[0]?.query).toBe('services/review related docs specs adr code')
    expect(queries[1]?.query).toContain('collect')
    expect(queries[1]?.type).toBe('code')
  })

  it('ключевые слова-стопслова не попадают в фокусный запрос, запрос остаётся один', () => {
    const area = groupAreas([{ file: 'README.md', state: 'modified' }])
    const queries = areaQueries(area[0]!)
    expect(queries).toHaveLength(1)
    expect(queries[0]?.type).toBeUndefined()
  })

  it('clampK зажимает k в 2..5', () => {
    expect(clampK(1)).toBe(2)
    expect(clampK(3)).toBe(3)
    expect(clampK(7)).toBe(5)
  })
})

describe('ragContext (заглушка search_project_docs)', () => {
  it('запросы: по объёмной области ≤2, k=3, тип по уместности; дубль — к одному фрагменту', async () => {
    const session = stubSession((name, args) => {
      expect(name).toBe('search_project_docs')
      return docsPayload(String(args['query']))
    })
    const fragments = await ragContext(session, FILES)
    const searches = session.calls
    expect(searches.length).toBeGreaterThanOrEqual(5)
    expect(searches.length).toBeLessThanOrEqual(8)
    for (const search of searches) {
      expect(search.args['k']).toBe(3)
    }
    for (const fragment of dedupeFragments(fragments)) {
      expect(fragments.filter(item => item.file === fragment.file && item.heading === fragment.heading)).toHaveLength(1)
    }
    const fileSet = new Set(fragments.map(fragment => fragment.file))
    expect(fileSet.has('apps/assistant/backend/llm.ts')).toBe(true)
  })

  it('приоритет: specs/ADR фрагменты раньше кода', async () => {
    const session = stubSession((name, args) => docsPayload(String(args['query'])))
    const fragments = await ragContext(session, FILES)
    const specIndex = fragments.findIndex(fragment => fragment.file.startsWith('specs/'))
    const codeIndex = fragments.findIndex(fragment => fragment.file.startsWith('apps/'))
    expect(specIndex).toBeGreaterThanOrEqual(0)
    expect(codeIndex).toBeGreaterThanOrEqual(0)
    expect(specIndex).toBeLessThan(codeIndex)
  })

  it('бюджет 40 КБ обрезает контентных фрагментов', async () => {
    const oversized: CitedFragment[] = []
    for (let index = 0; index < 6; index += 1) {
      oversized.push({
        file: `a/b/c${index}.ts`,
        excerpt: 'y'.repeat(12_000),
        score: 0.9 - index * 0.01,
      })
    }
    const kept = applyBudget(dedupeFragments(oversized))
    const total = kept.reduce((sum, fragment) => sum + fragmentBytes(fragment), 0)
    expect(total).toBeLessThanOrEqual(CONTEXT_BUDGET_BYTES)
    expect(kept.length).toBeGreaterThan(1)
    expect(kept.length).toBeLessThan(6)
  })

  it('первый фрагмент всегда остаётся, даже если он больше бюджета', () => {
    const fragments = applyBudget(dedupeFragments([{ file: 'a/b.huge.ts', excerpt: 'z'.repeat(60_000), score: 1 }]))
    expect(fragments).toHaveLength(1)
  })
})

describe('валидация поиска', () => {
  it('мусор от search_project_docs → CollectError', async () => {
    const session = stubSession(() => ({ results: 'nope' }))
    await expect(ragContext(session, FILES)).rejects.toThrow('некорректный')
  })
})

function fragmentBytes(fragment: CitedFragment): number {
  return fragment.file.length + (fragment.heading?.length ?? 0) + fragment.excerpt.length + 8
}
