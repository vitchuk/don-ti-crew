import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtureDir = fileURLToPath(new URL('../fixtures/repo', import.meta.url))

export interface TmpRepo {
  dir: string
  dbPath: string
  write(rel: string, content: string): void
  remove(rel: string): void
  dispose(): void
}

export function buildRepo(): TmpRepo {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-repo-'))
  cpSync(fixtureDir, dir, { recursive: true })
  write(dir, 'node_modules/pkg/index.js', 'module.exports = 1\n')
  write(dir, 'dist/bundle.js', 'console.log(1)\n')
  write(dir, '.data/leftover.db', 'stale\n')
  return {
    dir,
    dbPath: join(dir, '.data', 'knowledge.db'),
    write: (rel, content) => write(dir, rel, content),
    remove: (rel) => rmSync(join(dir, ...rel.split('/')), { force: true }),
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  }
}

function write(dir: string, rel: string, content: string): void {
  const path = join(dir, ...rel.split('/'))
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
}
