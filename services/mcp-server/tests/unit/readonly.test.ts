import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createServer } from '../../src/tools/registry'
import type { DocSearch } from '../../src/adapters/docs'
import { createMockRepo, disposeMockRepo, headShaOf, type MockRepo } from '../fixtures/mockRepo'

const opened: TestServer[] = []

interface TestServer {
  client: Client
  repo: MockRepo
  close(): Promise<void>
}

afterEach(async () => {
  for (const server of opened.splice(0)) {
    await server.close()
    disposeMockRepo(server.repo)
  }
})

async function startServer(): Promise<TestServer> {
  const repo = createMockRepo()
  repo.write('docs/guide.md', 'гайд\n')
  repo.write('a.txt', '1\n')
  repo.commit('init')
  const server = createServer({ cwd: repo.dir, docSearch: stubSearch() })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'readonly-test', version: '0.0.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  const entry: TestServer = { client, repo, close: async () => {
    await client.close()
    await server.close()
  } }
  opened.push(entry)
  return entry
}

function stubSearch(): DocSearch {
  return async () => ({
    results: [{ file: 'docs/guide.md', heading: 'Гайд', excerpt: 'фрагмент', score: 0.9 }],
    total: 1,
  })
}

interface Snapshot {
  head: string
  files: Map<string, string>
  status: string
  diff: string
}

function snapshot(repo: MockRepo): Snapshot {
  const files = new Map<string, string>()
  for (const rel of walk()) {
    files.set(rel, createHash('sha256').update(readFileSync(join(repo.dir, rel))).digest('base64'))
  }
  const head = headShaOf(repo)
  const status = repo.run(['status', '--porcelain=v1', '-z']).stdout
  const diff = repo.run(['diff', 'HEAD', '--']).stdout
  return { head, files, status, diff }

  function walk(): string[] {
    const entries: string[] = []
    const visit = (rel: string): void => {
      const abs = join(repo.dir, rel)
      for (const name of readdirSync(abs)) {
        const inner = rel === '' ? name : `${rel}/${name}`
        if (inner === '.git') {
          continue
        }
        const stats = statSync(join(abs, name))
        if (stats.isDirectory()) {
          visit(inner)
        }
        else {
          entries.push(inner)
        }
      }
    }
    visit('')
    return entries.sort()
  }
}

describe('AC-9: all tools are read-only', () => {
  it('the working tree and HEAD are unchanged after all tools', { timeout: 30_000 }, async () => {
    const server = await startServer()
    const repo = server.repo
    repo.write('draft.txt', 'uncommitted\n')
    repo.createBranch('side')
    await expect(readOnlyRun(server)).resolves.toBeUndefined()
    const before = snapshot(repo)
    await readOnlyRun(server)
    const after = snapshot(repo)
    expect(after.head).toBe(before.head)
    expect(after.files).toEqual(before.files)
    expect(after.status).toBe(before.status)
    expect([...after.files.keys()]).not.toContain('hijack.txt')
    expect(after.status).toContain('draft.txt')
  })

  it('path traversal attempts via list_files do not create files', { timeout: 30_000 }, async () => {
    const server = await startServer()
    const repo = server.repo
    await expect(server.client.callTool({
      name: 'list_files',
      arguments: { path: '../escape' } as Record<string, unknown>,
    })).resolves.toMatchObject({ isError: true })
    expect(existsSafe(repo, 'escape')).toBe(false)
    expect(existsSafe(repo, '../escape')).toBe(false)
  })
})

async function readOnlyRun(server: TestServer): Promise<void> {
  const calls: { name: string; args: Record<string, unknown> }[] = [
    { name: 'get_current_branch', args: {} },
    { name: 'git_status', args: {} },
    { name: 'git_diff', args: {} },
    { name: 'get_context', args: {} },
    { name: 'list_files', args: {} },
    { name: 'list_files', args: { path: 'docs' } },
    { name: 'search_project_docs', args: { query: 'гайд' } },
  ]
  for (const call of calls) {
    const result = await server.client.callTool({ name: call.name, arguments: call.args })
    expect(result.isError === true).toBe(false)
  }
  const failureGoing = await server.client.callTool({
    name: 'git_diff',
    arguments: { target: '--output=hijack.txt' },
  })
  expect(failureGoing.isError).toBe(true)
  const changed = await server.client.callTool({
    name: 'changed_files',
    arguments: { base: 'main', head: 'main' },
  })
  expect(changed.isError === true).toBe(false)
  const failed = await server.client.callTool({
    name: 'list_files',
    arguments: { path: 'ghost' },
  })
  expect(failed.isError).toBe(true)
}

function existsSafe(repo: MockRepo, rel: string): boolean {
  const abs = rel.startsWith('..') ? join(repo.dir, rel) : join(repo.dir, rel)
  try {
    statSync(abs)
    return true
  }
  catch {
    return false
  }
}
