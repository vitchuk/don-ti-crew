import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createServer } from '../../src/tools/registry'
import { INDEX_NOT_BUILT, type DocSearchArgs, type DocSearch, type SearchProjectDocsResult } from '../../src/adapters/docs'
import { createMockRepo, disposeMockRepo, type MockRepo } from '../fixtures/mockRepo'

const TOOL_NAMES = [
  'get_current_branch',
  'git_status',
  'git_diff',
  'changed_files',
  'list_files',
  'get_context',
  'search_project_docs',
]

const opened: TestServer[] = []

interface TestServer {
  client: Client
  repo: MockRepo
  docCalls: DocSearchArgs[]
  close(): Promise<void>
}

afterEach(async () => {
  for (const server of opened.splice(0)) {
    await server.close()
    disposeMockRepo(server.repo)
  }
})

async function startServer(mode: 'default' | 'record' = 'default'): Promise<TestServer> {
  const repo = createMockRepo()
  repo.write('docs/guide.md', 'guide\n')
  repo.write('a.txt', '1\n')
  repo.commit('init commit')
  const docCalls: DocSearchArgs[] = []
  const server = createServer({
    cwd: repo.dir,
    docSearch: mode === 'record' ? recorder(docCalls) : undefined,
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'contract-test', version: '0.0.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  const entry: TestServer = { client, repo, docCalls, close: async () => {
    await client.close()
    await server.close()
  } }
  opened.push(entry)
  return entry
}

function recorder(docCalls: DocSearchArgs[]): DocSearch {
  return async (args) => {
    docCalls.push(args)
    const result: SearchProjectDocsResult = {
      results: [{ file: 'docs/guide.md', heading: 'Гайд', excerpt: 'Q'.repeat(600), score: 0.91 }],
      total: 3,
    }
    return result
  }
}

function parse(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>
}

async function callText(server: TestServer, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = await server.client.callTool({ name, arguments: args })
  const block = result.content[0]
  expect(block?.type).toBe('text')
  return block?.type === 'text' ? block.text : ''
}

describe('tools listing', () => {
  it('exactly seven tools with names from FR-2', async () => {
    const server = await startServer()
    const tools = await server.client.listTools()
    expect(tools.tools.map(tool => tool.name).sort()).toEqual([...TOOL_NAMES].sort())
    for (const tool of tools.tools) {
      expect(typeof tool.description).toBe('string')
      expect((tool.description ?? '').length).toBeGreaterThan(0)
    }
  })
})

describe('contract: get_current_branch / git_status / get_context', () => {
  it('AC-1: get_context returns branch, clean=true, changedFiles=[] and lastCommit', async () => {
    const server = await startServer()
    const result = parse(await callText(server, 'get_context'))
    expect(Object.keys(result).sort()).toEqual(['branch', 'changedFiles', 'clean', 'lastCommit', 'truncated'])
    expect(result.branch).toBe('main')
    expect(result.clean).toBe(true)
    expect(result.changedFiles).toEqual([])
    expect(result.truncated).toBe(false)
    const lastCommit = result.lastCommit as Record<string, unknown>
    expect(Object.keys(lastCommit).sort()).toEqual(['date', 'message', 'sha'])
    expect(lastCommit.message).toBe('init commit')
    expect(Number.isNaN(Date.parse(lastCommit.date as string))).toBe(false)
  })

  it('get_current_branch → { branch }', async () => {
    const server = await startServer()
    const result = parse(await callText(server, 'get_current_branch'))
    expect(Object.keys(result).sort()).toEqual(['branch'])
    expect(result.branch).toBe('main')
  })

  it('git_status on clean tree → { clean, changes, truncated }', async () => {
    const server = await startServer()
    const result = parse(await callText(server, 'git_status'))
    expect(Object.keys(result).sort()).toEqual(['changes', 'clean', 'truncated'])
    expect(result.clean).toBe(true)
    expect(result.changes).toEqual([])
    expect(result.truncated).toBe(false)
  })
})

describe('contract: git_diff / changed_files', () => {
  it('git_diff without args → { diff, totalLines, truncated }, default maxLines=400 applied', async () => {
    const server = await startServer()
    const repo = server.repo
    repo.write('f.txt', 'a\n')
    repo.commit('track f')
    const lines = Array.from({ length: 494 }, (_, i) => `line-${i}`)
    repo.write('f.txt', `${lines.join('\n')}\n`)
    const result = parse(await callText(server, 'git_diff', {}))
    expect(Object.keys(result).sort()).toEqual(['diff', 'totalLines', 'truncated'])
    expect(result.totalLines).toBe(500)
    expect(result.truncated).toBe(true)
    expect(String(result.diff).split('\n')).toHaveLength(400)
  })

  it('invalid maxLines → isValid with meaningful text', async () => {
    const server = await startServer()
    const result = await server.client.callTool({ name: 'git_diff', arguments: { maxLines: 0 } })
    expect(result.isError).toBe(true)
    const block = result.content[0]
    expect((block as { text: string }).text).toContain('maxLines')
  })

  it('AC-12: target like an option via MCP — isError, file not created', async () => {
    const server = await startServer()
    const result = await server.client.callTool({ name: 'git_diff', arguments: { target: '--output=hijack.txt' } })
    expect(result.isError).toBe(true)
    expect(((result.content[0] ?? {}) as { text?: string }).text).toContain('недопустимая git-ссылка')
    expect(existsSync(join(server.repo.dir, 'hijack.txt'))).toBe(false)
  })

  it('AC-11 (contract): two-ref diff and changed_files in the feature branch', async () => {
    const server = await startServer()
    const repo = server.repo
    repo.createBranch('feature')
    repo.checkout('feature')
    repo.write('a.txt', '1-2\n')
    repo.commit('feature first')
    repo.write('n.txt', '2-3\n')
    repo.commit('feature second')
    repo.checkout('main')
    const diff = parse(await callText(server, 'git_diff', { base: 'main', head: 'feature' }))
    expect(Object.keys(diff).sort()).toEqual(['diff', 'totalLines', 'truncated'])
    expect(diff.truncated).toBe(false)
    expect(String(diff.diff)).toContain('n.txt')
    const changed = parse(await callText(server, 'changed_files', { base: 'main', head: 'feature' }))
    expect(Object.keys(changed).sort()).toEqual(['files', 'truncated'])
    const files = changed.files as { file: string; state: string }[]
    expect(files.map(file => file.file).sort()).toEqual(['a.txt', 'n.txt'])
    expect(files.every(file => ['added', 'modified'].includes(file.state))).toBe(true)
  })

  it('unknown tool → isError', async () => {
    const server = await startServer()
    const result = await server.client.callTool({ name: 'ghost_tool', arguments: {} })
    expect(result.isError).toBe(true)
  })
})

describe('contract: list_files', () => {
  it('structure { files: [{path, bytes}], truncated } and limit', async () => {
    const server = await startServer()
    const repo = server.repo
    for (let i = 0; i < 4; i += 1) {
      repo.write(`w/file-${i}.txt`, 'x')
    }
    repo.commit('adds')
    const result = parse(await callText(server, 'list_files', { limit: 2 }))
    expect(Object.keys(result).sort()).toEqual(['files', 'truncated'])
    expect(result.truncated).toBe(true)
    const files = result.files as { path: string; bytes: number }[]
    expect(files).toHaveLength(2)
    for (const file of files) {
      expect(typeof file.path).toBe('string')
      expect(typeof file.bytes).toBe('number')
    }
  })

  it('AC-10: nonexistent path → isValid; the server continues answering', async () => {
    const server = await startServer()
    const fail = await server.client.callTool({ name: 'list_files', arguments: { path: 'ghost-dir' } })
    expect(fail.isError).toBe(true)
    expect(((fail.content[0] ?? {}) as { text?: string }).text).toContain('ghost-dir')
    const alive = parse(await callText(server, 'get_current_branch'))
    expect(alive.branch).toBe('main')
  })

  it('AC-10: k=10 — isValid; the server continues answering', async () => {
    const server = await startServer()
    const fail = await server.client.callTool({ name: 'search_project_docs', arguments: { query: 'x', k: 10 } })
    expect(fail.isError).toBe(true)
    expect(((fail.content[0] ?? {}) as { text?: string }).text).toContain('k')
    const alive = parse(await callText(server, 'get_current_branch'))
    expect(alive.branch).toBe('main')
  })
})

describe('contract: search_project_docs', () => {
  it('defaults k=3 reach the DocSearch stub; excerpt ≤ 500', async () => {
    const server = await startServer('record')
    const text = await callText(server, 'search_project_docs', { query: 'гайд' })
    const result = JSON.parse(text) as SearchProjectDocsResult
    expect(server.docCalls[0]?.k).toBe(3)
    expect(server.docCalls[0]?.query).toBe('гайд')
    expect(result.total).toBe(3)
    expect(result.results[0]?.excerpt.length).toBeLessThanOrEqual(500)
    expect(result.results[0]?.file).toBe('docs/guide.md')
    expect(result.results[0]?.score).toBe(0.91)
  })

  it('AC-7: when the index is not built — the text is exactly like in the spec; the process is alive', async () => {
    const server = await startServer()
    const fail = await server.client.callTool({ name: 'search_project_docs', arguments: { query: 'фаза отдыха' } })
    expect(fail.isError).toBe(true)
    expect(((fail.content[0] ?? {}) as { text?: string }).text).toBe(INDEX_NOT_BUILT)
    const alive = parse(await callText(server, 'get_current_branch'))
    expect(alive.branch).toBe('main')
  })

  it('type external to the enum → isValid', async () => {
    const server = await startServer()
    const fail = await server.client.callTool({ name: 'search_project_docs', arguments: { query: 'x', type: 'movies' } })
    expect(fail.isError).toBe(true)
  })

  it('unknown arguments → isValid (strictObject)', async () => {
    const server = await startServer()
    const fail = await server.client.callTool({ name: 'changed_files', arguments: { base: 'main', head: 'main', extra: 1 } })
    expect(fail.isError).toBe(true)
    expect(((fail.content[0] ?? {}) as { text?: string }).text).toContain('Unrecognized key')
  })
})
