import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

let cachedRepoRoot: string | null = null

export function repoRoot(): string {
  if (cachedRepoRoot === null) {
    cachedRepoRoot = findRepoRoot(process.cwd()) ?? process.cwd()
  }
  return cachedRepoRoot
}

export function findRepoRoot(start: string): string | null {
  let dir = resolve(start)
  for (;;) {
    if (existsSync(join(dir, '.git'))) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) {
      return null
    }
    dir = parent
  }
}
