import { afterEach, describe, expect, it } from 'vitest'
import { getContext } from '../../src/tools/context'
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

describe('getContext', () => {
  it('AC-1: one commit and clean tree → branch, clean, empty changedFiles, full lastCommit', async () => {
    const repo = makeRepo()
    repo.write('a.txt', 'hello\n')
    repo.commit('first commit')
    const result = await getContext(repo.dir)
    expect(result.branch).toBe('main')
    expect(result.clean).toBe(true)
    expect(result.changedFiles).toEqual([])
    expect(result.truncated).toBe(false)
    expect(result.lastCommit?.sha).toBe(headShaOf(repo))
    expect(result.lastCommit?.message).toBe('first commit')
    expect(Number.isNaN(Date.parse(result.lastCommit?.date ?? ''))).toBe(false)
  })

  it('with changes: clean=false, changedFiles like in git_status', async () => {
    const repo = makeRepo()
    repo.write('a.txt', 'first\n')
    repo.commit('first')
    repo.write('a.txt', 'second\n')
    repo.write('b.txt', 'new\n')
    const result = await getContext(repo.dir)
    expect(result.clean).toBe(false)
    expect(result.truncated).toBe(false)
    expect(result.changedFiles.map(change => change.file).sort()).toEqual(['a.txt', 'b.txt'])
  })

  it('more than 200 changed files: truncated=true', async () => {
    const repo = makeRepo()
    repo.write('seed.txt', 'seed\n')
    repo.commit('seed')
    for (let i = 0; i < 201; i += 1) {
      repo.write(`bulk/file-${String(i).padStart(3, '0')}.txt`, `${i}\n`)
    }
    const result = await getContext(repo.dir)
    expect(result.truncated).toBe(true)
    expect(result.changedFiles).toHaveLength(200)
    expect(result.changedFiles[0]?.file).toBe('bulk/file-000.txt')
  })

  it('unborn HEAD: lastCommit null, branch determined', async () => {
    const repo = makeRepo()
    const result = await getContext(repo.dir)
    expect(result.branch).toBe('main')
    expect(result.clean).toBe(true)
    expect(result.changedFiles).toEqual([])
    expect(result.truncated).toBe(false)
    expect(result.lastCommit).toBeNull()
  })
})
