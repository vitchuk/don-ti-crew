import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DEFAULT_DB_PATH } from '@don-ti/knowledge'

let cachedRepoRoot: string | null = null

/**
 * Корень репозитория: ближайший каталог (вверх от cwd) с `.git`.
 * Кэшируется — backend за время жизни процесса сидит в одном месте.
 */
export function repoRoot(): string {
  if (cachedRepoRoot === null) {
    cachedRepoRoot = findRepoRoot(process.cwd()) ?? process.cwd()
  }
  return cachedRepoRoot
}

function findRepoRoot(start: string): string | null {
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

/**
 * Путь к базе индекса знаний: env `KNOWLEDGE_DB` (как есть) или `.data/knowledge.db` в корне репо.
 * Важно указывать абсолютный путь явно: dev-сервер работает с cwd пакета, а база лежит в корне.
 */
export function knowledgeDbPath(): string {
  const custom = process.env['KNOWLEDGE_DB']
  if (custom !== undefined && custom.length > 0) {
    return resolve(custom)
  }
  return join(repoRoot(), DEFAULT_DB_PATH)
}

/** Скрипт MCP-сервера (спека 002) относительно корня репо; spawn выполняется с cwd = корень репо. */
export function mcpServerPath(): string {
  return join(repoRoot(), 'services', 'mcp-server', 'dist', 'index.js')
}
