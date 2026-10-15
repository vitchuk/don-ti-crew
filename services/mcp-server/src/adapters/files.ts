import { stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { runOk } from '../lib/spawn.js'

export interface ListFilesArgs {
  cwd?: string
  path?: string
  limit?: number
}

export interface FileEntry {
  path: string
  bytes: number
}

export interface ListFilesResult {
  files: FileEntry[]
  truncated: boolean
}

export const DEFAULT_FILE_LIMIT = 500

export const EXCLUDED_DIRS: readonly string[] = ['node_modules', 'dist', '.data', '.git']

export async function listFiles(args: ListFilesArgs = {}): Promise<ListFilesResult> {
  const cwd = args.cwd ?? process.cwd()
  const limit = args.limit ?? DEFAULT_FILE_LIMIT
  const subPath = args.path !== undefined ? normalizeRepoPath(args.path) : ''
  if (subPath !== '' && !existsSync(join(cwd, subPath))) {
    throw new Error(`Несуществующий path: ${args.path}`)
  }
  const spec = subPath === ''
    ? ['ls-files', '-z', '-co', '--exclude-standard', '--']
    : ['ls-files', '-z', '-co', '--exclude-standard', '--', subPath]
  const output = await runOk(cwd, spec)
  const paths = output.split('\u0000').filter(entry => entry.length > 0)
  let truncated = false
  const files: FileEntry[] = []
  for (const entry of paths) {
    if (hasExcludedSegment(entry)) {
      continue
    }
    if (files.length >= limit) {
      truncated = true
      break
    }
    const bytes = await sizeOf(cwd, entry)
    if (bytes !== null) {
      files.push({ path: entry, bytes })
    }
  }
  return { files, truncated }
}

export function normalizeRepoPath(raw: string): string {
  if (raw.includes('\u0000')) {
    throw new Error('path не может содержать NUL')
  }
  const posix = raw.replaceAll('\\', '/')
  if (isAbsolute(posix) || /^[A-Za-z]:/.test(posix)) {
    throw new Error(`path не позволяет выйти за корень репо: ${raw}`)
  }
  const segments = posix.split('/').filter(segment => segment.length > 0 && segment !== '.')
  if (segments.includes('..')) {
    throw new Error(`path не позволяет выйти за корень репо: ${raw}`)
  }
  return segments.join('/')
}

function hasExcludedSegment(entry: string): boolean {
  return entry.split('/').some(segment => EXCLUDED_DIRS.includes(segment))
}

async function sizeOf(cwd: string, entry: string): Promise<number | null> {
  try {
    const stats = await stat(join(cwd, entry))
    return stats.isFile() ? stats.size : null
  }
  catch {
    return null
  }
}
