import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  changedFiles,
  getCurrentBranch,
  getLastCommit,
  gitDiff,
  gitStatus,
  type GitDiffResult,
} from '../adapters/git.js'
import { listFiles, type ListFilesResult } from '../adapters/files.js'
import {
  defaultDocSearch,
  makeSearchProjectDocs,
  type DocSearch,
} from '../adapters/docs.js'
import { getContext } from './context.js'

export const SERVER_NAME = '@don-ti/mcp-server'
export const SERVER_VERSION = '0.1.0'

export interface ServerDeps {
  cwd: string
  docSearch: DocSearch
}

export interface CreateServerOptions {
  cwd?: string
  docSearch?: DocSearch
}

const refArg = z.string().regex(/^[A-Za-z0-9._~^/,+-]+$/, 'недопустимая git-ссылка')
  .refine(ref => !ref.startsWith('-') && !ref.startsWith('/'), 'недопустимая git-ссылка')

const gitDiffArgs = z.strictObject({
  target: refArg.optional(),
  base: refArg.optional(),
  head: refArg.optional(),
  maxLines: z.number().int().min(1, 'maxLines должен быть целым числом от 1 до 4000')
    .max(4000, 'maxLines должен быть целым числом от 1 до 4000')
    .default(400),
}).refine(
  args => !(args.target !== undefined && (args.base !== undefined || args.head !== undefined)),
  'target и base/head взаимоисключимы',
)

const changedFilesArgs = z.strictObject({
  base: refArg,
  head: refArg,
})

const listFilesArgs = z.strictObject({
  path: z.string().min(1, 'path не может быть пустым').optional(),
  limit: z.number().int().min(1, 'limit должен быть целым числом от 1 до 2000')
    .max(2000, 'limit должен быть целым числом от 1 до 2000')
    .default(500),
})

const searchArgs = z.strictObject({
  query: z.string().min(1, 'query не может быть пустым'),
  k: z.number().int().min(1, 'k должен быть целым числом от 1 до 5')
    .max(5, 'k должен быть целым числом от 1 до 5')
    .default(3),
  type: z.enum(['readme', 'docs', 'specs', 'adr', 'code', 'config']).optional(),
})

type ToolResponse = {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

function textResult(value: unknown): ToolResponse {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

function textError(error: unknown): ToolResponse {
  const message = error instanceof Error ? error.message : String(error)
  return { content: [{ type: 'text', text: message }], isError: true }
}

async function safeRun(fn: () => Promise<unknown>): Promise<ToolResponse> {
  try {
    return textResult(await fn())
  }
  catch (error) {
    return textError(error)
  }
}

export function createServer(options: CreateServerOptions = {}): McpServer {
  const cwd = options.cwd ?? process.cwd()
  const search = makeSearchProjectDocs(options.docSearch ?? defaultDocSearch())
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })

  server.registerTool('get_current_branch', {
    description: 'Имя текущей ветки git.',
  }, async () => await safeRun(async () => await getCurrentBranch(cwd)))

  server.registerTool('git_status', {
    description: 'Статус рабочего дерева: чисто или список изменений.',
  }, async () => await safeRun(async () => await gitStatus(cwd)))

  server.registerTool('git_diff', {
    description: 'Diff рабочего дерева против HEAD (или цели ref) либо между merge-base(base, head) и head; не более maxLines строк.',
    inputSchema: gitDiffArgs,
  }, async (args) => await safeRun(async () => await gitDiff({
    cwd,
    target: args.target,
    base: args.base,
    head: args.head,
    maxLines: args.maxLines,
  })))

  server.registerTool('changed_files', {
    description: 'Файлы, изменённые между merge-base(base, head) и head, со статусами.',
    inputSchema: changedFilesArgs,
  }, async (args) => await safeRun(async () => await changedFiles({ cwd, base: args.base, head: args.head })))

  server.registerTool('list_files', {
    description: 'Файлы репо с размерами; игнор .gitignore и служебных каталогов.',
    inputSchema: listFilesArgs,
  }, async (args) => await safeRun(async () => await listFiles({
    cwd,
    path: args.path,
    limit: args.limit,
  })))

  server.registerTool('get_context', {
    description: 'Ветка, статус, изменённые файлы и последний коммит одним вызовом.',
  }, async () => await safeRun(async () => await getContext(cwd)))

  server.registerTool('search_project_docs', {
    description: 'Поиск по индексу знаний проекта.',
    inputSchema: searchArgs,
  }, async (args) => await safeRun(async () => await search(args)))

  return server
}
