import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { runCli, type CliIo } from '../../src/cli.js'
import { index } from '../../src/indexer.js'
import { FakeEmbedder } from '../../src/embeddings.js'
import { buildRepo, type TmpRepo } from '../helpers/testRepo.js'
import { ERROR_MESSAGES } from '../../src/errors.js'

interface Captured {
  out: string[]
  err: string[]
}

function capture(): CliIo & Captured {
  const out: string[] = []
  const err: string[] = []
  const io: CliIo = {
    stdout: (text) => { out.push(text) },
    stderr: (text) => { err.push(text) },
  }
  return { ...io, out, err }
}

let repo: TmpRepo

afterEach(() => {
  repo?.dispose()
})

describe('runCli', () => {
  it('AC-5: query without a database exits 1 with the rag:index hint', async () => {
    repo = buildRepo()
    const io = capture()
    const code = await runCli(['query', 'тест'], { ...io, dbPath: join(repo.dir, '.data', 'absent.db'), embedder: new FakeEmbedder() })
    expect(code).toBe(1)
    expect(io.err).toEqual([ERROR_MESSAGES.NOT_INDEXED])
  })

  it('unknown command prints usage hint and exits 1', async () => {
    repo = buildRepo()
    const io = capture()
    const code = await runCli(['mystic'], io)
    expect(code).toBe(1)
    expect(io.err.join('\n')).toContain('knowledge index')
  })

  it('query --k/--type validation errors', async () => {
    repo = buildRepo()
    const io = capture()
    const code = await runCli(['query', 'текст', '--k', '0'], io)
    expect(code).toBe(1)
    expect(io.err.join('\n')).toContain('--k')
    const badType = capture()
    const codeType = await runCli(['query', 'текст', '--type', 'films'], badType)
    expect(codeType).toBe(1)
    expect(badType.err.join('\n')).toContain('type')
  })

  it('index then query roundtrip via the CLI layer exits 0', async () => {
    repo = buildRepo()
    const indexio = capture()
    const codeIndex = await runCli(['index'], {
      ...indexio,
      repoRoot: repo.dir,
      dbPath: repo.dbPath,
      embedder: new FakeEmbedder(),
    })
    expect(codeIndex).toBe(0)
    expect(indexio.err.join('\n')).toContain('Фрагменты')
    expect(indexio.err.join('\n')).toContain('размерность')
    const queryio = capture()
    const codeQuery = await runCli(['query', 'как идут раунды в циклах', '--type', 'docs'], {
      ...queryio,
      dbPath: repo.dbPath,
      embedder: new FakeEmbedder(),
    })
    expect(codeQuery).toBe(0)
    expect(queryio.out.join('\n')).toContain('docs/guide.md')
  })

  it('index accepts --force', async () => {
    repo = buildRepo()
    await index({ repoRoot: repo.dir, dbPath: repo.dbPath, embedder: new FakeEmbedder() })
    const io = capture()
    const code = await runCli(['index', '--force'], {
      ...io,
      repoRoot: repo.dir,
      dbPath: repo.dbPath,
      embedder: new FakeEmbedder(),
    })
    expect(code).toBe(0)
    expect(io.err.join('\n')).toContain('пересчитано')
    expect(io.err.join('\n')).not.toContain('Размерность эмбеддингов изменилась')
  })

  it('AC-9 force: --force after a dimension change reports it on stderr', async () => {
    repo = buildRepo()
    await index({ repoRoot: repo.dir, dbPath: repo.dbPath, embedder: new FakeEmbedder(8) })
    const io = capture()
    const code = await runCli(['index', '--force'], {
      ...io,
      repoRoot: repo.dir,
      dbPath: repo.dbPath,
      embedder: new FakeEmbedder(4),
    })
    expect(code).toBe(0)
    expect(io.err.join('\n')).toContain('Размерность эмбеддингов изменилась')
    expect(io.err.join('\n')).toContain('пересчитано')
  })
})

const distCli = join(import.meta.dirname ?? '', '..', '..', 'dist', 'cli.js')
const hasDist = existsSync(distCli)

describe.skipIf(!hasDist)('dist/cli.js (bin)', () => {
  it('query without building the index → exit 1 and the canonical hint on stderr', () => {
    repo = buildRepo()
    const result = spawnSync(process.execPath, [distCli, 'query', 'тест'], {
      cwd: repo.dir,
      encoding: 'utf8',
      env: { ...process.env },
      windowsHide: true,
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('pnpm rag:index')
  })
})
