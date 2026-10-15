import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { existsSync } from 'node:fs'
import { AppError } from './errors.js'
import { mcpServerPath, repoRoot } from './paths.js'

/**
 * MCP-шлюз Помощника (plan.md): готовый SDK-клиент + StdioClientTransport,
 * spawn `services/mcp-server` как долгоживущего stdio-процесса: ленивый запуск
 * при первом вопросе, переиспользование, рестарт при падении (NFR-1 — без
 * spawn'а на каждый вызов). Контракты инструментов — спека 002.
 */

export const CONTEXT_TIMEOUT_MS = 10_000
export const DIFF_TIMEOUT_MS = 15_000
export const STARTUP_TIMEOUT_MS = 10_000
/** Лимит строк diff, запрашиваемого у git_diff (FR-3). */
export const DEFAULT_DIFF_MAX_LINES = 200

export interface McpToolResult {
  content: { type: string; text: string }[]
  isError?: boolean
}

export interface McpConnection {
  callTool(name: string, args: Record<string, unknown> | undefined, timeoutMs: number): Promise<McpToolResult>
  close(): Promise<void>
}

export type McpConnector = () => Promise<McpConnection>

/** Контракт get_context (спека 002): branch, clean, changedFiles, lastCommit, truncated. */
export interface McpContextResult {
  branch: string
  clean: boolean
  changedFiles: { file: string; state: string }[]
  truncated?: boolean
}

/** Контракт git_diff (спека 002): diff, totalLines, truncated. */
export interface McpDiffResult {
  diff: string
  totalLines: number
  truncated: boolean
}

export interface McpGatewayOptions {
  connector?: McpConnector
  contextTimeoutMs?: number
  diffTimeoutMs?: number
}

export class McpGateway {
  private connection: McpConnection | null = null
  private connecting: Promise<McpConnection> | null = null
  private readonly connector: McpConnector
  private readonly contextTimeoutMs: number
  private readonly diffTimeoutMs: number

  constructor(options: McpGatewayOptions = {}) {
    this.connector = options.connector ?? createStdioConnector()
    this.contextTimeoutMs = options.contextTimeoutMs ?? CONTEXT_TIMEOUT_MS
    this.diffTimeoutMs = options.diffTimeoutMs ?? DIFF_TIMEOUT_MS
  }

  async getContext(): Promise<McpContextResult> {
    return await validateContext(await this.callPayload('get_context', undefined, this.contextTimeoutMs))
  }

  async gitDiff(maxLines = DEFAULT_DIFF_MAX_LINES): Promise<McpDiffResult> {
    return await validateDiff(await this.callPayload('git_diff', { maxLines }, this.diffTimeoutMs))
  }

  async close(): Promise<void> {
    const old = this.connection
    this.connection = null
    this.connecting = null
    if (old !== null) {
      await old.close().catch(() => undefined)
    }
  }

  private async callPayload(name: string, args: Record<string, unknown> | undefined, timeoutMs: number): Promise<unknown> {
    const connection = await this.obtain()
    try {
      const result = await connection.callTool(name, args, timeoutMs)
      if (result.isError === true) {
        throw new AppError('mcp_unavailable')
      }
      return parsePayload(result)
    }
    catch (error) {
      // Вызов не удался — расстыковываемся; следующий вызов лениво
      // поднимет процесс заново («рестарт при падении»).
      await this.close()
      throw toUnavailable(error)
    }
  }

  private async obtain(): Promise<McpConnection> {
    if (this.connection !== null) {
      return this.connection
    }
    if (this.connecting === null) {
      const attempt = this.connector()
        .then((connection) => {
          this.connection = connection
          this.connecting = null
          return connection
        })
        .catch((error: unknown) => {
          throw toUnavailable(error)
        })
      this.connecting = attempt
      attempt.catch(() => {
        if (this.connecting === attempt) {
          this.connecting = null
        }
      })
    }
    return await this.connecting
  }
}

/**
 * Реальный соединитель: SDK Client + StdioClientTransport, spawn `node
 * services/mcp-server/dist/index.js` с cwd = корень репо (mcp-server требует .git).
 * KNOWLEDGE_DB передаётся ребёнку явно: транспорт по умолчанию наследует не всё окружение.
 */
export function createStdioConnector(): McpConnector {
  return async () => {
    const script = mcpServerPath()
    if (!existsSync(script)) {
      throw new AppError('mcp_unavailable')
    }
    const env = getDefaultEnvironment()
    const knowledgeDb = process.env['KNOWLEDGE_DB']
    if (knowledgeDb !== undefined) {
      env['KNOWLEDGE_DB'] = knowledgeDb
    }
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [script],
      cwd: repoRoot(),
      env,
    })
    const client = new Client({ name: '@don-ti/assistant', version: '0.1.0' })
    try {
      await withTimeout(client.connect(transport), STARTUP_TIMEOUT_MS)
    }
    catch (error) {
      await transport.close().catch(() => undefined)
      throw toUnavailable(error)
    }
    return {
      callTool: (name, args, timeoutMs) => client.callTool(
        { name, arguments: args ?? {} },
        undefined,
        { timeout: timeoutMs },
      ) as Promise<McpToolResult>,
      close: () => client.close(),
    }
  }
}

function withTimeout(promise: Promise<unknown>, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AppError('mcp_unavailable'))
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

function parsePayload(result: McpToolResult): unknown {
  const block = result.content[0]
  const text = block?.type === 'text' ? block.text : ''
  try {
    return JSON.parse(text) as unknown
  }
  catch {
    throw new AppError('mcp_unavailable')
  }
}

function toUnavailable(error: unknown): AppError {
  if (error instanceof AppError) {
    return error
  }
  return new AppError('mcp_unavailable')
}

export function validateContext(raw: unknown): McpContextResult {
  const value = asObject(raw)
  if (
    typeof value['branch'] !== 'string'
    || typeof value['clean'] !== 'boolean'
    || !Array.isArray(value['changedFiles'])
  ) {
    throw new AppError('mcp_unavailable')
  }
  return {
    branch: value['branch'],
    clean: value['clean'],
    changedFiles: value['changedFiles'] as McpContextResult['changedFiles'],
    ...(typeof value['truncated'] === 'boolean' ? { truncated: value['truncated'] } : {}),
  }
}

export function validateDiff(raw: unknown): McpDiffResult {
  const value = asObject(raw)
  if (
    typeof value['diff'] !== 'string'
    || typeof value['totalLines'] !== 'number'
    || typeof value['truncated'] !== 'boolean'
  ) {
    throw new AppError('mcp_unavailable')
  }
  return {
    diff: value['diff'],
    totalLines: value['totalLines'],
    truncated: value['truncated'],
  }
}

function asObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) {
    throw new AppError('mcp_unavailable')
  }
  return raw as Record<string, unknown>
}
