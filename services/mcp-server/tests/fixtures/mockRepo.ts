import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

export interface RunOutcome {
  code: number
  stdout: string
  stderr: string
}

export interface MockRepo {
  dir: string
  rootCommit(message: string): void
  write(rel: string, content: string): void
  stage(rel?: string): void
  commit(message: string): void
  remove(rel: string): void
  rename(from: string, to: string): void
  createBranch(name: string): void
  checkout(name: string): void
  run(args: string[]): RunOutcome
  root(rel: string): string
}

const GIT_TMP: string = tmpdir()
const SHA_PATTERN = /^[0-9a-f]{4,64}$/

const BASE_FLAGS: readonly string[] = [
  '-c', 'user.name=Test User',
  '-c', 'user.email=test@example.test',
  '-c', 'commit.gpgsign=false',
  '-c', 'core.autocrlf=false',
  '-c', 'tag.gpgSign=false',
]

export function createMockRepo(): MockRepo {
  const dir = mkdtempSync(path.join(GIT_TMP, 'mock-repo-'))
  run(dir, ['init', '-b', 'main'])
  return {
    dir,
    run: (args: string[]) => run(dir, args),
    root: (rel: string) => path.join(dir, ...rel.split('/')),
    write(rel: string, content: string) {
      const abs = path.join(dir, ...rel.split('/'))
      mkdirSync(path.dirname(abs), { recursive: true })
      writeFileSync(abs, content, 'utf8')
    },
    stage(rel?: string) {
      const args = rel === undefined
        ? ['add', '-A']
        : ['add', '--', rel]
      run(dir, args)
    },
    rootCommit(message: string) {
      run(dir, ['add', '-A'])
      run(dir, ['commit', '-m', message])
    },
    commit(message: string) {
      run(dir, ['add', '-A'])
      run(dir, ['commit', '-m', message])
    },
    remove(rel: string) {
      rmSync(path.join(dir, ...rel.split('/')))
    },
    rename(from: string, to: string) {
      run(dir, ['mv', from, to])
    },
    createBranch(name: string) {
      run(dir, ['branch', name])
    },
    checkout(name: string) {
      run(dir, ['checkout', name])
    },
  }
}

export function disposeMockRepo(repo: MockRepo): void {
  let attempt = 0
  for (;;) {
    attempt += 1
    try {
      rmSync(repo.dir, { recursive: true, force: true })
      return
    }
    catch {
      if (attempt >= 3) {
        return
      }
      busyWait(attempt * 100)
    }
  }
}

function busyWait(ms: number): void {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    void 0
  }
}

export function headShaOf(repo: MockRepo): string {
  const head = repo.run(['rev-parse', 'HEAD']).stdout.trim()
  if (!SHA_PATTERN.test(head)) {
    throw new Error(`Не удалось получить HEAD мок-репозитория: ${head}`)
  }
  return head
}

function run(dir: string, args: readonly string[]): RunOutcome {
  const result = spawnSync('git', [...BASE_FLAGS, ...args], {
    cwd: dir,
    encoding: 'buffer',
    windowsHide: true,
  })
  if (result.error) {
    throw result.error
  }
  return {
    code: result.status ?? -1,
    stdout: result.stdout.toString('utf8'),
    stderr: result.stderr.toString('utf8'),
  }
}
