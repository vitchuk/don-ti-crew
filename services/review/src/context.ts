import { callPayload, CollectError, SEARCH_TIMEOUT_MS, type ChangedFile, type McpCall } from './collect.js'

export type DocType = 'readme' | 'docs' | 'specs' | 'adr' | 'code' | 'config'

export interface CitedFragment {
  file: string
  heading?: string
  excerpt: string
  score: number
}

export interface DocArea {
  name: string
  files: ChangedFile[]
}

export interface AreaQuery {
  query: string
  type?: DocType
}

export const MIN_K = 2
export const MAX_K = 5
export const SEARCH_K = 3
export const MAX_QUERIES_PER_AREA = 2
export const CONTEXT_BUDGET_BYTES = 40_000
export const MAX_QUERY_CHARS = 200

const AREA_SUFFIX = ' related docs specs adr code'
const STOP_KEYWORDS = new Set([
  'readme', 'index', 'package', 'tsconfig', 'vitest', 'config', 'license',
  'yaml', 'yml', 'json', 'md', 'ts', 'js', 'lock',
])

export function clampK(k: number): number {
  if (k < MIN_K) {
    return MIN_K
  }
  if (k > MAX_K) {
    return MAX_K
  }
  return k
}

export function groupAreas(files: ChangedFile[]): DocArea[] {
  const byName = new Map<string, DocArea>()
  for (const file of files) {
    const name = areaName(file.file)
    const area = byName.get(name)
    if (area === undefined) {
      byName.set(name, { name, files: [file] })
    }
    else {
      area.files.push(file)
    }
  }
  return [...byName.values()]
}

export function areaName(path: string): string {
  const segments = path.replaceAll('\\', '/').split('/')
  if (segments.length < 2) {
    return 'root'
  }
  return `${segments[0]}/${segments[1]}`
}

export function areaTypeOf(area: string): DocType | undefined {
  const [top, second] = area.split('/')
  if (top === 'specs') {
    return 'specs'
  }
  if (top === 'docs') {
    return second === 'adr' ? 'adr' : 'docs'
  }
  if (top === 'apps' || top === 'services') {
    return 'code'
  }
  return undefined
}

export function areaQueries(area: DocArea): AreaQuery[] {
  const queries: AreaQuery[] = [
    { query: `${area.name}${AREA_SUFFIX}` },
  ]
  const keywords = keywordsOf(area.files)
  if (keywords.length > 0) {
    queries.push({
      query: clip(`${area.name} ${keywords}`),
      type: areaTypeOf(area.name),
    })
  }
  return queries.slice(0, MAX_QUERIES_PER_AREA)
}

export async function ragContext(session: McpCall, files: ChangedFile[], k = SEARCH_K): Promise<CitedFragment[]> {
  const areas = groupAreas(files)
  if (areas.length === 0) {
    return []
  }
  const collected: CitedFragment[] = []
  for (const area of areas) {
    for (const { query, type } of areaQueries(area)) {
      const args: Record<string, unknown> = { query, k: clampK(k) }
      if (type !== undefined) {
        args['type'] = type
      }
      const raw = await callPayload(session, 'search_project_docs', args, SEARCH_TIMEOUT_MS)
      collected.push(...validateSearchPayload(raw))
    }
  }
  return applyBudget(dedupeFragments(collected.sort(fragmentsComparator)))
}

export function dedupeFragments(fragments: CitedFragment[]): CitedFragment[] {
  const seen = new Set<string>()
  const unique: CitedFragment[] = []
  for (const fragment of fragments) {
    const key = `${fragment.file}\u0000${fragment.heading ?? ''}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    unique.push(fragment)
  }
  return unique
}

export function priorityOf(file: string): number {
  const path = file.replaceAll('\\', '/')
  if (path.startsWith('specs/') || path.includes('/adr/')) {
    return 0
  }
  if (path.startsWith('docs/') || path === 'GLOSSARY.md' || path.startsWith('GLOSSARY')) {
    return 1
  }
  return 2
}

export function applyBudget(fragments: CitedFragment[], budget = CONTEXT_BUDGET_BYTES): CitedFragment[] {
  const result: CitedFragment[] = []
  let used = 0
  for (const fragment of fragments) {
    const cost = fragmentBytes(fragment)
    if (result.length > 0 && used + cost > budget) {
      break
    }
    result.push(fragment)
    used += cost
  }
  return result
}

export function validateSearchPayload(raw: unknown): CitedFragment[] {
  if (typeof raw !== 'object' || raw === null) {
    throw new CollectError('search_project_docs вернул некорректный ответ')
  }
  const results = (raw as Record<string, unknown>)['results']
  if (!Array.isArray(results)) {
    throw new CollectError('search_project_docs вернул некорректный ответ')
  }
  const fragments: CitedFragment[] = []
  for (const entry of results) {
    if (typeof entry !== 'object' || entry === null) {
      continue
    }
    const item = entry as Record<string, unknown>
    const file = item['file']
    const excerpt = item['excerpt']
    const score = item['score']
    if (typeof file !== 'string' || file.length === 0 || typeof excerpt !== 'string' || typeof score !== 'number') {
      continue
    }
    const heading = item['heading']
    fragments.push({
      file,
      excerpt,
      score,
      ...(typeof heading === 'string' && heading.length > 0 ? { heading } : {}),
    })
  }
  return fragments
}

function fragmentsComparator(a: CitedFragment, b: CitedFragment): number {
  const priority = priorityOf(a.file) - priorityOf(b.file)
  if (priority !== 0) {
    return priority
  }
  return b.score - a.score
}

function fragmentBytes(fragment: CitedFragment): number {
  return fragment.file.length + (fragment.heading?.length ?? 0) + fragment.excerpt.length + 8
}

function keywordsOf(files: ChangedFile[]): string {
  const words = new Set<string>()
  for (const file of files) {
    const base = file.file.replaceAll('\\', '/').split('/').pop() ?? ''
    const word = stripExtension(base).toLowerCase()
    if (word.length >= 3 && !STOP_KEYWORDS.has(word)) {
      words.add(word)
    }
  }
  return [...words].slice(0, 6).join(' ')
}

function stripExtension(base: string): string {
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

function clip(text: string): string {
  return text.length <= MAX_QUERY_CHARS ? text : `${text.slice(0, MAX_QUERY_CHARS - 1).trimEnd()}…`
}
