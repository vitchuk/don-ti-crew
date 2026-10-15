import { afterEach, describe, expect, it } from 'vitest'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { listFiles } from '../../src/adapters/files'
import { createMockRepo, disposeMockRepo, type MockRepo } from '../fixtures/mockRepo'

const repos: MockRepo[] = []

function makeRepo(): MockRepo {
  const repo = createMockRepo()
  repos.push(repo)
  return repo
}

afterEach(() => {
  for (const repo of repos.splice(0)) {
    disposeMockRepo(repo)
  }
})

describe('listFiles', () => {
  it('AC-4: 600 files → 500 + truncated, gitignored and service directories excluded', async () => {
    const repo = makeRepo()
    repo.write('.gitignore', '*.secret\n')
    for (let i = 0; i < 600; i += 1) {
      repo.write(`bulk/file-${String(i).padStart(3, '0')}.txt`, 'x')
    }
    repo.write('vendor/node_modules/dependency.js', 'module.exports = 1\n')
    repo.write('build/dist/output.js', 'console.log()\n')
    repo.write('.data/knowledge.db', 'db\n')
    repo.write('docs/notes.secret', 'secret\n')
    repo.commit('init')
    const result = await listFiles({ cwd: repo.dir })
    expect(result.truncated).toBe(true)
    expect(result.files).toHaveLength(500)
    const paths = result.files.map(file => file.path)
    expect(paths).toContain('.gitignore')
    expect(paths).toContain('bulk/file-000.txt')
    expect(paths).toContain('bulk/file-498.txt')
    expect(paths.some(path => path.startsWith('bulk/file-499'))).toBe(false)
    expect(paths.some(path => path.includes('node_modules'))).toBe(false)
    expect(paths.some(path => path.split('/').includes('dist'))).toBe(false)
    expect(paths.some(path => path.split('/').includes('.data'))).toBe(false)
    expect(paths.some(path => path.endsWith('.secret'))).toBe(false)
  })

  it('AC-5: path filter subdirectory returns only its subtree', async () => {
    const repo = makeRepo()
    repo.write('docs/README.md', 'doc\n')
    repo.write('docs/gen/generated.md', 'gen\n')
    repo.write('src/main.ts', 'console.log()\n')
    repo.commit('init')
    const result = await listFiles({ cwd: repo.dir, path: 'docs' })
    expect(result.truncated).toBe(false)
    expect(result.files.map(file => file.path).sort()).toEqual([
      'docs/README.md',
      'docs/gen/generated.md',
    ])
  })

  it('AC-5: bytes are real file sizes', async () => {
    const repo = makeRepo()
    repo.write('docs/README.md', '12345\n')
    repo.commit('init')
    const result = await listFiles({ cwd: repo.dir, path: 'docs' })
    const entry = result.files[0]
    expect(entry?.path).toBe('docs/README.md')
    const expected = (await stat(join(repo.dir, 'docs/README.md'))).size
    expect(entry?.bytes).toBe(expected)
  })

  it('untracked non-gitignored files are included', async () => {
    const repo = makeRepo()
    repo.write('tracked.txt', 't\n')
    repo.commit('init')
    repo.write('draft.txt', 'd\n')
    const result = await listFiles({ cwd: repo.dir })
    expect(result.files.map(file => file.path).sort()).toEqual([
      'draft.txt',
      'tracked.txt',
    ])
  })

  it('limit and truncated', async () => {
    const repo = makeRepo()
    for (let i = 0; i < 10; i += 1) {
      repo.write(`f/file-${i}.txt`, 'x')
    }
    repo.commit('init')
    const result = await listFiles({ cwd: repo.dir, limit: 3 })
    expect(result.truncated).toBe(true)
    expect(result.files).toHaveLength(3)
    const unlimited = await listFiles({ cwd: repo.dir, limit: 10 })
    expect(unlimited.truncated).toBe(false)
    expect(unlimited.files).toHaveLength(10)
  })

  it('path traversal is outside the root: error', async () => {
    const repo = makeRepo()
    repo.write('a.txt', 'a\n')
    repo.commit('init')
    await expect(listFiles({ cwd: repo.dir, path: '../escape' })).rejects.toThrow('за корень репо')
    await expect(listFiles({ cwd: repo.dir, path: '..' })).rejects.toThrow('за корень репо')
    await expect(listFiles({ cwd: repo.dir, path: 'C:/etc' })).rejects.toThrow('за корень репо')
  })

  it('AC-10: nonexistent path — validation error', async () => {
    const repo = makeRepo()
    repo.write('a.txt', 'a\n')
    repo.commit('init')
    await expect(listFiles({ cwd: repo.dir, path: 'ghost' })).rejects.toThrow('Несуществующий path: ghost')
  })

  it('entries are sorted by path', async () => {
    const repo = makeRepo()
    repo.write('z.txt', 'z\n')
    repo.write('a.txt', 'a\n')
    repo.commit('init')
    const result = await listFiles({ cwd: repo.dir })
    expect(result.files.map(file => file.path)).toEqual([
      'a.txt',
      'z.txt',
    ])
  })
})
