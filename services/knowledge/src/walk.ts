import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { KnowledgeError, WALK_FAILED_MESSAGE } from './errors.js'
import type { FileType } from './types.js'

export interface SourceFile {
  filePath: string
  fileType: FileType
}

const EXCLUDED_DIRS: ReadonlySet<string> = new Set(['node_modules', 'dist', '.data', '.git'])

const ROOT_FILE_TYPES: ReadonlyMap<string, FileType> = new Map([
  ['README.md', 'readme'],
  ['GLOSSARY.md', 'docs'],
  ['AGENTS.md', 'docs'],
])

const CONFIG_EXTENSIONS: ReadonlySet<string> = new Set(['.yml', '.yaml', '.json', '.toml'])

const CODE_ROOTS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['apps', new Set(['.ts', '.vue'])],
  ['services', new Set(['.ts'])],
])

interface IgnoreRule {
  negated: boolean
  regex: RegExp
}

export class GitignoreRules {
  private readonly rules: IgnoreRule[] = []

  add(pattern: string): void {
    const line = pattern.trim()
    if (line.length === 0 || line.startsWith('#')) {
      return
    }
    let body = line
    let negated = false
    if (body.startsWith('!')) {
      negated = true
      body = body.slice(1)
    }
    let dirOnly = false
    if (body.endsWith('/')) {
      dirOnly = true
      body = body.slice(0, -1)
    }
    if (body.length === 0) {
      return
    }
    const anchored = body.startsWith('/') || body.slice(1).includes('/')
    body = body.replace(/^\//, '')
    const escaped = escapePattern(body)
    const source = dirOnly
      ? `^${escaped}(/|$)`
      : anchored
        ? `^${escaped}$`
        : `(^|/)${escaped}$`
    this.rules.push({ negated, regex: new RegExp(source) })
  }

  isIgnored(path: string): boolean {
    let ignored = false
    for (const rule of this.rules) {
      if (rule.regex.test(path)) {
        ignored = !rule.negated
      }
    }
    return ignored
  }

  isDirIgnored(path: string): boolean {
    if (this.isIgnored(`${path}/`)) {
      return true
    }
    if (this.isIgnored(path)) {
      return true
    }
    let prefix = path
    while (prefix.length > 0) {
      if (this.isIgnored(`${prefix}/`)) {
        return true
      }
      const slash = prefix.lastIndexOf('/')
      prefix = slash > 0 ? prefix.slice(0, slash) : ''
    }
    return false
  }
}

export function compileGitignore(text: string): GitignoreRules {
  const rules = new GitignoreRules()
  for (const line of text.split(/\r?\n/)) {
    rules.add(line)
  }
  return rules
}

function escapePattern(pattern: string): string {
  const dirWildcard = /(?:^|\/)\*\*(?:\/|$)/
  let source = pattern
  source = source.replaceAll('**', '\u0000')
  source = source.replaceAll('*', '[^/]*')
  source = source.replaceAll('?', '[^/]')
  source = source.replaceAll('\u0000', '.*')
  const specials = ['\\', '^', '$', '.', '+', '(', ')', '|', '{', '}', '[', ']']
  for (const special of specials) {
    if (special !== '\u0000') {
      source = source.replaceAll(special, `\\${special}`)
    }
  }
  void dirWildcard
  return source
}

export function collectFiles(repoRoot: string): Promise<SourceFile[]> {
  return walkSafe(repoRoot)
}

async function walkSafe(repoRoot: string): Promise<SourceFile[]> {
  try {
    let ignore = new GitignoreRules()
    try {
      ignore = compileGitignore(await readFile(join(repoRoot, '.gitignore'), 'utf8'))
    }
    catch {
      ignore = new GitignoreRules()
    }
    const files = await walk(repoRoot, '', ignore)
    files.sort((left, right) => left.filePath.localeCompare(right.filePath))
    return files
  }
  catch {
    throw new KnowledgeError('WALK_FAILED', WALK_FAILED_MESSAGE)
  }
}

async function walk(root: string, rel: string, ignore: GitignoreRules): Promise<SourceFile[]> {
  const files: SourceFile[] = []
  const segments = rel.length === 0 ? [] : rel.split('/')
  const entries = await readdir(join(root, ...segments), { withFileTypes: true })
  for (const entry of entries) {
    const child = rel.length === 0 ? entry.name : `${rel}/${entry.name}`
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name) || ignore.isDirIgnored(child)) {
        continue
      }
      files.push(...await walk(root, child, ignore))
    }
    else if (entry.isFile() && !ignore.isIgnored(child)) {
      const fileType = classifyFile(child)
      if (fileType !== null) {
        files.push({ filePath: child, fileType })
      }
    }
  }
  return files
}

export function classifyFile(filePath: string): FileType | null {
  const base = filePath.split('/').pop() ?? filePath
  const rootType = ROOT_FILE_TYPES.get(filePath)
  if (rootType !== undefined) {
    return rootType
  }
  if (filePath === 'package.json') {
    return 'config'
  }
  if (filePath.startsWith('docs/adr/')) {
    return 'adr'
  }
  if (filePath.startsWith('docs/')) {
    return 'docs'
  }
  if (filePath.startsWith('specs/')) {
    return 'specs'
  }
  if (isUnderCodeRoot(filePath)) {
    return 'code'
  }
  const dot = base.lastIndexOf('.')
  if (dot > 0 && filePath.split('/').length === 1 && CONFIG_EXTENSIONS.has(base.slice(dot).toLowerCase())) {
    return 'config'
  }
  return null
}

function isUnderCodeRoot(filePath: string): boolean {
  const segments = filePath.split('/')
  const extensions = CODE_ROOTS.get(segments[0] ?? '')
  if (extensions === undefined) {
    return false
  }
  const srcIndex = segments.indexOf('src')
  if (srcIndex <= 0 || srcIndex === segments.length - 1) {
    return false
  }
  const base = segments[segments.length - 1] ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 && extensions.has(base.slice(dot).toLowerCase())
}
