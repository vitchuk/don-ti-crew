import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { main, parseArgs, UsageError, type ReviewIo } from '../../src/cli'
import { DIFF_OK, FILES_OK, okCompletion, stubSession, type StubSession } from '../fixtures/stubSession'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'review-cli-'))
  tempDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function recordingIo(): ReviewIo & { out: string[]; err: string[] } {
  const io = {
    out: [] as string[],
    err: [] as string[],
    stdout: (text: string) => io.out.push(text),
    stderr: (text: string) => io.err.push(text),
  }
  return io
}

function happySession(payloads: { docs?: unknown; finding?: string } = {}): StubSession {
  return stubSession((name) => {
    if (name === 'git_diff') {
      return DIFF_OK
    }
    if (name === 'changed_files') {
      return FILES_OK
    }
    return payloads.docs ?? { results: [], total: 0 }
  })
}

function stubFetch(answer: string) {
  let calls = 0
  const fetchImpl = () => {
    calls += 1
    return Promise.resolve(okCompletion(answer))
  }
  return { fetchImpl, calls: () => calls }
}

const ENV = { DEEPSEEK_API_KEY: 'sk-test' }

describe('parseArgs', () => {
  it('--base/--head/--out разбираются', () => {
    expect(parseArgs(['--base', 'b1', '--head', 'h1', '--out', 'r.md'])).toEqual({
      base: 'b1',
      head: 'h1',
      out: 'r.md',
    })
  })

  it('нет обязательного флага → UsageError с подсказкой', () => {
    expect(() => parseArgs(['--base', 'b1'])).toThrow(UsageError)
    expect(() => parseArgs([])).toThrow(/--head/)
    expect(() => parseArgs(['--head', 'h'])).toThrow(/--base/)
  })

  it('флаг без значения и неизвестный флаг → UsageError', () => {
    expect(() => parseArgs(['--base'])).toThrow(UsageError)
    expect(() => parseArgs(['--prs', 'x'])).toThrow(UsageError)
    expect(() => parseArgs(['b1', 'h1'])).toThrow(UsageError)
  })
})

describe('main — exit-коды (план: 0 ok / 1 usage / 2 collect / 3 llm)', () => {
  it('не задан --base → exit 1, MCP не поднимается', async () => {
    const io = recordingIo()
    const opened = { count: 0 }
    const code = await main(['--head', 'h1'], ENV, {
      openSession: async () => {
        opened.count += 1
        return happySession()
      },
      io,
    })
    expect(code).toBe(1)
    expect(opened.count).toBe(0)
    expect(io.err[0]).toContain('--base')
  })

  it('несуществующий ref → exit 1', async () => {
    const io = recordingIo()
    const session = stubSession(() => ({ error: 'недопустимая git-ссылка: ghost' }))
    const code = await main(['--base', 'ghost', '--head', 'h1'], ENV, {
      openSession: async () => session,
      io,
    })
    expect(code).toBe(1)
    expect(session.closed).toBe(1)
  })

  it('пустой диф → exit 2', async () => {
    const io = recordingIo()
    const session = stubSession((name) => {
      if (name === 'git_diff') {
        return { diff: '', totalLines: 0, truncated: false }
      }
      return FILES_OK
    })
    const code = await main(['--base', 'a', '--head', 'b'], ENV, { openSession: async () => session, io })
    expect(code).toBe(2)
    expect(io.err[0]).toContain('Diff пуст')
  })

  it('нет DEEPSEEK_API_KEY → exit 3, LLM не вызывается, сессия закрыта', async () => {
    const io = recordingIo()
    const session = happySession()
    const llm = stubFetch('Находок нет')
    const code = await main(['--base', 'a', '--head', 'b'], {}, {
      openSession: async () => session,
      fetch: llm.fetchImpl,
      io,
    })
    expect(code).toBe(3)
    expect(llm.calls()).toBe(0)
    expect(session.closed).toBe(1)
  })

  it('MCP-сервер не поднялся → exit 2', async () => {
    const io = recordingIo()
    const code = await main(['--base', 'a', '--head', 'b'], ENV, {
      openSession: async () => {
        throw new Error('MCP-сервер недоступен: испугался')
      },
      io,
    })
    expect(code).toBe(2)
    expect(io.err[0]).toContain('MCP')
  })
})

describe('main — успешный прогон (AC-10)', () => {
  it('--out: файл с markdown-отчётом, stdout со сводкой и путём, промпт содержит диф и контекст', async () => {
    const io = recordingIo()
    const out = join(makeTempDir(), 'report.md')
    const session = happySession({
      docs: { results: [{ file: 'specs/005-ci-ai-review/spec.md', heading: 'FR-6', excerpt: 'npm review', score: 0.8 }], total: 1 },
    })
    const llm = stubFetch('Находок нет')
    const code = await main(['--base', 'a1', '--head', 'b2', '--out', out], ENV, {
      openSession: async () => session,
      fetch: llm.fetchImpl,
      io,
    })
    expect(code).toBe(0)
    const report = readFileSync(out, 'utf8')
    expect(report).toContain('## 🔍 AI Code Review')
    expect(report).toContain('**base** `a1` → **head** `b2`')
    expect(report).toContain('**Находок нет**')
    expect(report).not.toContain('<!-- ai-review-comment -->')
    expect(io.out[0]).toContain('находок всего 0')
    expect(io.out[0]).toContain(out)
    expect(io.out[0]).not.toContain('## 🔍')
  })
})
