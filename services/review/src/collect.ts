import process from 'node:process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

export type ChangeState = 'added' | 'modified' | 'deleted' | 'renamed'

export interface ChangedFile {
  file: string
  state: ChangeState
}

export interface DiffPayload {
  diff: string
  totalLines: number
  truncated: boolean
}

export interface ReviewData {
  diff: DiffPayload
  files: ChangedFile[]
}

export const DIFF_MAX_LINES = 500
export const MAX_DIFF_CHARS = 150_000
export const DIFF_TRUNCATION_MARK = '\n\n… [diff усечён: лимит ~150 КБ]'
export const CONNECT_TIMEOUT_MS = 10_000
export const TOOL_TIMEOUT_MS = 30_000
export const SEARCH_TIMEOUT_MS = 40_000

const MCP_REF_ERROR = 'недопустимая git-ссылка'
const STATES: readonly ChangeState[] = ['added', 'modified', 'deleted', 'renamed']
const LOCK_FILES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
  'npm-shrinkwrap.json',
])
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm',
  '.zip', '.gz', '.7z', '.rar', '.tar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.db', '.sqlite',
])

export class RefError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RefError'
  }
}

export class CollectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CollectError'
  }
}

export interface McpCall {
  callTool(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<unknown>
  close(): Promise<void>
}

export interface OpenSessionOptions {
  serverPath?: string
}

export async function openMcpSession(options: OpenSessionOptions = {}): Promise<McpCall> {
  const root = findRepoRoot(process.cwd())
  if (root === null) {
    throw new CollectError('Не найден корень репозитория (нет .git) — запускайте CLI из checkout\'а репозитория.')
  }
  const serverPath = options.serverPath ?? join(root, 'services', 'mcp-server', 'dist', 'index.js')
  if (!existsSync(serverPath)) {
    throw new CollectError(`MCP-сервер не собран (${serverPath}) — выполните \`pnpm --filter @don-ti/mcp-server build\`.`)
  }
  const env = getDefaultEnvironment()
  const knowledgeDb = process.env['KNOWLEDGE_DB']
  if (knowledgeDb !== undefined) {
    env['KNOWLEDGE_DB'] = knowledgeDb
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: root,
    env,
  })
  const client = new Client({ name: '@don-ti/review', version: '0.1.0' })
  try {
    await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, 'MCP-сервер не ответил при подключении')
  }
  catch (error) {
    await transport.close().catch(() => undefined)
    throw new CollectError(`MCP-сервер недоступен: ${describe(error)}`)
  }
  return {
    callTool: (name, args, timeoutMs) => client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs }),
    close: () => client.close(),
  }
}

export async function callPayload(
  session: McpCall,
  name: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  let result: unknown
  try {
    result = await session.callTool(name, args, timeoutMs)
  }
  catch (error) {
    throw new CollectError(`Вызов ${name} не удался: ${describe(error)}`)
  }
  if (typeof result !== 'object' || result === null) {
    throw new CollectError(`Некорректный ответ инструмента ${name}`)
  }
  const tool = result as { content?: { type: string; text: string }[]; isError?: boolean }
  if (tool.isError === true) {
    const text = tool.content?.[0]?.text ?? ''
    if (text.includes(MCP_REF_ERROR)) {
      throw new RefError(`git отклонил ссылку: ${text}`)
    }
    throw new CollectError(`Инструмент ${name} вернул ошибку: ${text}`)
  }
  const text = tool.content?.[0]?.type === 'text' ? tool.content[0].text : ''
  try {
    return JSON.parse(text) as unknown
  }
  catch {
    throw new CollectError(`Инструмент ${name} вернул не-JSON результат`)
  }
}

export async function collectReviewData(session: McpCall, base: string, head: string): Promise<ReviewData> {
  const diffRaw = await callPayload(session, 'git_diff', { base, head, maxLines: DIFF_MAX_LINES }, TOOL_TIMEOUT_MS)
  const filesRaw = await callPayload(session, 'changed_files', { base, head }, TOOL_TIMEOUT_MS)
  return {
    diff: boundDiff(validateDiffPayload(diffRaw)),
    files: filterReviewableFiles(validateChangedFilesPayload(filesRaw)),
  }
}

export function validateDiffPayload(raw: unknown): DiffPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new CollectError('git_diff вернул некорректный ответ')
  }
  const value = raw as Record<string, unknown>
  if (typeof value['diff'] !== 'string' || typeof value['totalLines'] !== 'number' || typeof value['truncated'] !== 'boolean') {
    throw new CollectError('git_diff вернул некорректный ответ')
  }
  return { diff: value['diff'], totalLines: value['totalLines'], truncated: value['truncated'] }
}

export function validateChangedFilesPayload(raw: unknown): ChangedFile[] {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as Record<string, unknown>)['files'])) {
    throw new CollectError('changed_files вернул некорректный ответ')
  }
  const files: ChangedFile[] = []
  for (const entry of (raw as { files: unknown[] }).files) {
    if (typeof entry !== 'object' || entry === null) {
      continue
    }
    const item = entry as Record<string, unknown>
    const file = item['file']
    const state = item['state']
    if (typeof file !== 'string' || file.length === 0) {
      continue
    }
    if (typeof state !== 'string' || !STATES.includes(state as ChangeState)) {
      continue
    }
    files.push({ file, state: state as ChangeState })
  }
  return files
}

export function filterReviewableFiles(files: ChangedFile[]): ChangedFile[] {
  return files.filter(entry => !isExcludedFile(entry.file))
}

export function isExcludedFile(path: string): boolean {
  const lowered = path.replaceAll('\\', '/').toLowerCase()
  const base = lowered.split('/').pop() ?? ''
  if (LOCK_FILES.has(base) || base.endsWith('.lock')) {
    return true
  }
  const dot = base.lastIndexOf('.')
  if (dot <= 0) {
    return false
  }
  return BINARY_EXTENSIONS.has(base.slice(dot))
}

function boundDiff(diff: DiffPayload): DiffPayload {
  if (diff.diff.length <= MAX_DIFF_CHARS) {
    return diff
  }
  return {
    ...diff,
    diff: `${diff.diff.slice(0, MAX_DIFF_CHARS)}${DIFF_TRUNCATION_MARK}`,
  }
}

function findRepoRoot(start: string): string | null {
  let dir = start
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message))
    }, timeoutMs)
    timer.unref?.()
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
