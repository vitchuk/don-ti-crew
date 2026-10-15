import process from 'node:process'
import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import {
  CollectError,
  collectReviewData,
  openMcpSession,
  RefError,
  type McpCall,
} from './collect.js'
import { ragContext } from './context.js'
import {
  askDeepSeek,
  LlmError,
  resolveLlmConfig,
  type FetchLike,
  type LlmMessage,
} from './llm.js'
import { buildPrompt } from './prompt.js'
import { parseFindings, renderReport, summarizeCounts } from './render.js'

export const USAGE = 'Использование: pnpm review:run --base <ref> --head <ref> [--out <файл>]'

export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

export interface ReviewIo {
  stdout: (text: string) => void
  stderr: (text: string) => void
}

export interface ReviewDeps {
  openSession?: () => Promise<McpCall>
  fetch?: FetchLike
  io?: ReviewIo
}

export interface ParsedArgs {
  base: string
  head: string
  out?: string
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags = new Map<string, string>()
  let index = 0
  while (index < argv.length) {
    const flag = argv[index]
    if (flag === undefined || !flag.startsWith('--') || flag.length === 2) {
      throw new UsageError(`Неизвестный аргумент «${flag ?? ''}». ${USAGE}`)
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new UsageError(`Флаг ${flag} требует значения. ${USAGE}`)
    }
    flags.set(flag, value)
    index += 2
  }
  const base = flags.get('--base')
  const head = flags.get('--head')
  if (base === undefined || head === undefined) {
    const missing = new Set(['--base', '--head'])
    if (base !== undefined) {
      missing.delete('--base')
    }
    if (head !== undefined) {
      missing.delete('--head')
    }
    throw new UsageError(`Не задан обязательный аргумент: ${[...missing].join(', ')}. ${USAGE}`)
  }
  const out = flags.get('--out')
  return {
    base,
    head,
    ...(out === undefined ? {} : { out }),
  }
}

export async function main(argv: readonly string[], env: NodeJS.ProcessEnv, deps: ReviewDeps = {}): Promise<number> {
  const io: ReviewIo = deps.io ?? {
    stdout: (text: string) => void process.stdout.write(text),
    stderr: (text: string) => void process.stderr.write(text),
  }
  const openSession = deps.openSession ?? openMcpSession
  let session: McpCall | null = null
  try {
    const { base, head, out } = parseArgs(argv)
    session = await openSession()
    const data = await collectReviewData(session, base, head)
    if (data.diff.diff.trim().length === 0) {
      throw new CollectError('Diff пуст — между base и head нет изменений для ревью.')
    }
    const config = resolveLlmConfig(env)
    const fragments = await ragContext(session, data.files)
    const prompt = buildPrompt({
      base,
      head,
      diff: data.diff.diff,
      diffTruncated: data.diff.truncated,
      files: data.files,
      fragments,
    })
    const messages: LlmMessage[] = [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ]
    const answer = await askDeepSeek(messages, config, deps.fetch)
    const findings = parseFindings(answer)
    const report = renderReport({
      base,
      head,
      model: config.model,
      findings,
      diffTruncated: data.diff.truncated,
      filesTruncated: data.filesTruncated,
      citations: fragments,
    })
    if (out === undefined) {
      io.stdout(report)
    }
    else {
      await writeFile(out, report, 'utf8')
      io.stdout(`Сводка: ${summarizeCounts(findings)} · находок всего ${findings.length}\nОтчёт: ${out}\n`)
    }
    return 0
  }
  catch (error) {
    const code = error instanceof UsageError || error instanceof RefError
      ? 1
      : error instanceof LlmError
        ? 3
        : 2
    io.stderr(error instanceof Error ? `${error.message}\n` : `${String(error)}\n`)
    return code
  }
  finally {
    if (session !== null) {
      await session.close().catch(() => undefined)
    }
  }
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  void main(process.argv.slice(2), process.env).then((code) => {
    process.exitCode = code
  })
}
