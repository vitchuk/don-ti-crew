import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { gitDiff, changedFiles, type GitDiffArgs } from '../../src/adapters/git'
import { createMockRepo, disposeMockRepo, headShaOf, type MockRepo, type RunOutcome } from '../fixtures/mockRepo'

function assertOk(outcome: RunOutcome): void {
  expect(outcome.code, outcome.stderr).toBe(0)
}

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

describe('gitDiff', () => {
  it('AC-3: a 500-line diff is cut to maxLines=400', async () => {
    const repo = makeRepo()
    repo.write('f.txt', 'a\n')
    repo.commit('init')
    const lines = Array.from({ length: 494 }, (_, i) => `line-${i}`)
    repo.write('f.txt', `${lines.join('\n')}\n`)
    const result = await gitDiff({ cwd: repo.dir })
    expect(result.totalLines).toBe(500)
    expect(result.truncated).toBe(true)
    expect(result.diff.split('\n')).toHaveLength(400)
  })

  it('custom maxLines within limit: no truncation', async () => {
    const repo = makeRepo()
    repo.write('f.txt', 'a\n')
    repo.commit('init')
    const lines = Array.from({ length: 494 }, (_, i) => `line-${i}`)
    repo.write('f.txt', `${lines.join('\n')}\n`)
    const result = await gitDiff({ cwd: repo.dir, maxLines: 500 })
    expect(result.totalLines).toBe(500)
    expect(result.truncated).toBe(false)
  })

  it('no worktree changes: empty diff', async () => {
    const repo = makeRepo()
    repo.write('f.txt', 'a\n')
    repo.commit('init')
    const result = await gitDiff({ cwd: repo.dir })
    expect(result).toEqual({ diff: '', totalLines: 0, truncated: false })
  })

  it('unborn HEAD: empty diff', async () => {
    const repo = makeRepo()
    const result = await gitDiff({ cwd: repo.dir })
    expect(result).toEqual({ diff: '', totalLines: 0, truncated: false })
  })

  it('custom target: diff of the worktree against the given branch', async () => {
    const repo = makeRepo()
    repo.write('f.txt', 'base\n')
    repo.commit('base')
    repo.createBranch('side')
    repo.checkout('side')
    repo.write('f.txt', 'side content\n')
    repo.commit('side change')
    repo.checkout('main')
    const raw = repo.run(['diff', '--no-ext-diff', '--no-textconv', '--no-color', 'side', '--']).stdout
    const rawLines = raw.split('\n')
    if ((rawLines[rawLines.length - 1] ?? null) === '') {
      rawLines.pop()
    }
    const result = await gitDiff({ cwd: repo.dir, target: 'side' })
    expect(result.totalLines).toBe(rawLines.length)
    expect(result.truncated).toBe(false)
    expect(result.diff).toBe(`${rawLines.join('\n')}\n`)
  })

  it('two-ref mode: only the diff between merge-base and head', async () => {
    const repo = makeRepo()
    seedBranches(repo)
    repo.write('extra.txt', 'uncommitted worktree change\n')
    const result = await gitDiff({ cwd: repo.dir, base: 'main', head: 'feature' })
    expect(result.truncated).toBe(false)
    expect(result.diff).toContain('n.txt')
    expect(result.diff).toContain('1-2')
    expect(result.diff).not.toContain('extra.txt')
    expect(result.diff).not.toContain('uncommitted worktree change')
  })

  it('AC-12: target looks like an option — error, file not created', async () => {
    const repo = makeRepo()
    repo.write('f.txt', 'a\n')
    repo.commit('init')
    await expect(gitDiff({ cwd: repo.dir, target: '--output=hijack.txt' })).rejects.toThrow('недопустимая git-ссылка')
    expect(existsSync(repo.root('hijack.txt'))).toBe(false)
  })

  it('AC-12: base with a leading dash — error, file not created', async () => {
    const repo = makeRepo()
    repo.write('f.txt', 'a\n')
    repo.commit('init')
    const head = headShaOf(repo)
    await expect(gitDiff({ cwd: repo.dir, base: '-o', head })).rejects.toThrow('недопустимая git-ссылка')
    expect(existsSync(repo.root('hijack.txt'))).toBe(false)
  })

  it('unknown ref: validation error', async () => {
    const repo = makeRepo()
    repo.write('f.txt', 'a\n')
    repo.commit('init')
    await expect(gitDiff({ cwd: repo.dir, target: 'no-such-ref' })).rejects.toThrow('недопустимая git-ссылка')
  })

  it('target along with base: mutual exclusivity error', async () => {
    const repo = makeRepo()
    seedBranches(repo)
    await expect(gitDiff({ cwd: repo.dir, target: 'main', base: 'main', head: 'feature' }))
      .rejects.toThrow('target и base/head взаимоисключимы')
  })

  it('base without head: error', async () => {
    const repo = makeRepo()
    seedBranches(repo)
    await expect(gitDiff({ cwd: repo.dir, base: 'main' })).rejects.toThrow('head должен быть задан вместе с base')
  })

  it('head without base: error', async () => {
    const repo = makeRepo()
    seedBranches(repo)
    await expect(gitDiff({ cwd: repo.dir, head: 'feature' })).rejects.toThrow('base должен быть задан вместе с head')
  })

  it('no common ancestor: no merge-base error', async () => {
    const repo = makeRepo()
    repo.write('m.txt', 'main line\n')
    assertOk(repo.run(['add', '-A']))
    assertOk(repo.run(['commit', '-m', 'main root']))
    assertOk(repo.run(['checkout', '--orphan', 'lonely']))
    assertOk(repo.run(['rm', '-rf', '--', '.']))
    repo.write('l.txt', 'lonely\n')
    assertOk(repo.run(['add', '-A']))
    assertOk(repo.run(['commit', '-m', 'lonely root']))
    const head = headShaOf(repo)
    const result = await gitDiffSafe({ cwd: repo.dir, base: 'main', head })
    expect(result).toContain('общих предков')
  })
})

describe('changedFiles', () => {
  it('AC-11: only added/modified between merge-base and head', async () => {
    const repo = makeRepo()
    seedBranches(repo)
    const result = await changedFiles({ cwd: repo.dir, base: 'main', head: 'feature' })
    expect(result.truncated).toBe(false)
    expect(result.files.sort((a, b) => a.file.localeCompare(b.file))).toEqual([
      { file: 'a.txt', state: 'modified' },
      { file: 'n.txt', state: 'added' },
    ])
  })

  it('committed rename: new path with state renamed', async () => {
    const repo = makeRepo()
    repo.write('r1.txt', 'content\n')
    repo.commit('init')
    repo.rename('r1.txt', 'r2.txt')
    repo.commit('renamed')
    repo.write('n1.txt', 'new file\n')
    repo.commit('titled')
    const renameCommit = `${headShaOf(repo)}~1`
    const result = await changedFiles({ cwd: repo.dir, base: `${renameCommit}~1`, head: headShaOf(repo) })
    expect(result.files.sort((a, b) => a.file.localeCompare(b.file))).toEqual([
      { file: 'n1.txt', state: 'added' },
      { file: 'r2.txt', state: 'renamed' },
    ])
  })

  it('opposite direction: no changes', async () => {
    const repo = makeRepo()
    seedBranches(repo)
    const result = await changedFiles({ cwd: repo.dir, base: 'feature', head: 'main' })
    expect(result.files).toEqual([])
  })

  it('more than 200 files: truncated', { timeout: 20000 }, async () => {
    const repo = makeRepo()
    repo.write('seed.txt', 'seed\n')
    repo.commit('seed')
    for (let i = 0; i < 205; i += 1) {
      repo.write(`bulk/file-${i}.txt`, `${i}\n`)
    }
    repo.commit('bulk')
    const before = `${headShaOf(repo)}~1`
    const result = await changedFiles({ cwd: repo.dir, base: before, head: headShaOf(repo) })
    expect(result.truncated).toBe(true)
    expect(result.files).toHaveLength(200)
  })

  it('unknown ref: validation error', async () => {
    const repo = makeRepo()
    repo.write('a.txt', '1\n')
    repo.commit('init')
    await expect(changedFiles({ cwd: repo.dir, base: 'ghost', head: 'main' }))
      .rejects.toThrow('недопустимая git-ссылка')
  })
})

function seedBranches(repo: MockRepo): void {
  repo.write('a.txt', '1\n')
  repo.commit('base')
  repo.createBranch('feature')
  repo.checkout('feature')
  repo.write('a.txt', '1-2\n')
  repo.commit('feature first')
  repo.write('n.txt', '2-3\n')
  repo.commit('feature second')
  repo.checkout('main')
}

async function gitDiffSafe(args: GitDiffArgs): Promise<string> {
  try {
    const result = await gitDiff(args)
    return `unexpected success: ${JSON.stringify(result)}`
  }
  catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
