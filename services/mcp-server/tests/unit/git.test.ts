import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getCurrentBranch,
  getLastCommit,
  gitStatus,
} from '../../src/adapters/git'
import { createMockRepo, disposeMockRepo, headShaOf, type MockRepo } from '../fixtures/mockRepo'

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

describe('getCurrentBranch', () => {
  it('with commits: pulsed branch name', async () => {
    const repo = makeRepo()
    repo.write('a.txt', 'hello\n')
    repo.commit('init')
    const result = await getCurrentBranch(repo.dir)
    expect(result).toEqual({ branch: 'main' })
  })

  it('unborn: branch is determined', async () => {
    const repo = makeRepo()
    const result = await getCurrentBranch(repo.dir)
    expect(result).toEqual({ branch: 'main' })
  })

  it('unborn with untracked changes: branch from the ## header, no SHA surrogate', async () => {
    const repo = makeRepo()
    repo.write('a.txt', 'hello\n')
    const result = await getCurrentBranch(repo.dir)
    expect(result).toEqual({ branch: 'main' })
  })

  it('L3: git status exits non-zero (not a repository) — branch is HEAD, not a short SHA', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'no-repo-'))
    try {
      const result = await getCurrentBranch(dir)
      expect(result).toEqual({ branch: 'HEAD' })
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('gitStatus', () => {
  it('clean tree: { clean: true, changes: [], truncated: false }', async () => {
    const repo = makeRepo()
    repo.write('a.txt', 'hello\n')
    repo.commit('init')
    const status = await gitStatus(repo.dir)
    expect(status).toEqual({ clean: true, changes: [], truncated: false })
  })

  it('AC-2: four mutation types produce distinct states', async () => {
    const repo = makeRepo()
    repo.write('a.txt', 'original\n')
    repo.write('c.txt', 'original\n')
    repo.commit('init')
    repo.write('a.txt', 'modified\n')
    repo.write('b.txt', 'added\n')
    repo.stage('b.txt')
    repo.remove('c.txt')
    repo.write('u.txt', 'untracked\n')
    const status = await gitStatus(repo.dir)
    expect(status.clean).toBe(false)
    expect(status.truncated).toBe(false)
    expect(status.changes).toEqual([
      { file: 'a.txt', state: 'modified' },
      { file: 'b.txt', state: 'added' },
      { file: 'c.txt', state: 'deleted' },
      { file: 'u.txt', state: 'untracked' },
    ])
  })

  it('staged rename: one change with state renamed', async () => {
    const repo = makeRepo()
    repo.write('b.txt', 'rename me\n')
    repo.commit('init')
    repo.rename('b.txt', 'd.txt')
    const status = await gitStatus(repo.dir)
    expect(status.changes).toEqual([
      { file: 'd.txt', state: 'renamed' },
    ])
  })

  it('more than 200 changes: truncated', async () => {    const repo = makeRepo()
    for (let i = 0; i < 201; i += 1) {
      repo.write(`f/entry-${i}.txt`, `content ${i}\n`)
    }
    repo.commit('init')
    for (let i = 0; i < 201; i += 1) {
      repo.write(`f/entry-${i}.txt`, `changed ${i}\n`)
    }
    const status = await gitStatus(repo.dir)
    expect(status.changes).toHaveLength(200)
    expect(status.truncated).toBe(true)
  })
})

describe('getLastCommit', () => {
  it('with commits: sha, message and ISO date', async () => {
    const repo = makeRepo()
    repo.write('a.txt', 'hello\n')
    repo.commit('init commit')
    const lastCommit = await getLastCommit(repo.dir)
    expect(lastCommit).not.toBeNull()
    expect(lastCommit?.sha).toBe(headShaOf(repo))
    expect(lastCommit?.message).toBe('init commit')
    const parsed = Date.parse(lastCommit?.date ?? '')
    expect(Number.isNaN(parsed)).toBe(false)
    expect(parsed).toBeLessThanOrEqual(Date.now() + 60_000)
    expect(parsed).toBeGreaterThan(Date.now() - 120_000)
  })

  it('no commits: null', async () => {
    const repo = makeRepo()
    const lastCommit = await getLastCommit(repo.dir)
    expect(lastCommit).toBeNull()
  })
})
