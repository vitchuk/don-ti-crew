import process from 'node:process'
import { FILE_TYPES, DEFAULT_K } from './constants.js'
import { loadKnowledgeEnv } from './envFile.js'
import { index } from './indexer.js'
import { query } from './query.js'
import { createOllamaEmbedder, FakeEmbedder, type OllamaEmbedderOptions } from './embeddings.js'
import { KnowledgeError } from './errors.js'
import type { Embedder, FileType, QueryOptions } from './types.js'

export interface CliIo {
  stderr: (text: string) => void
  stdout: (text: string) => void
  embedder?: Embedder
  repoRoot?: string
  dbPath?: string
}

interface ParsedQueryArgs {
  text: string
  k: number
  type?: FileType
}

const INDEX_USAGE = 'Использование: knowledge index [--force]'
const QUERY_USAGE = 'Использование: knowledge query "<текст>" [--k 5] [--type <readme|docs|specs|adr|code|config>]'

export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const [command] = argv
  try {
    if (command === 'index') {
      return await runIndex(argv.slice(1), io)
    }
    if (command === 'query') {
      return await runQueryCommand(argv.slice(1), io)
    }
    io.stderr(`Неизвестная команда — ${command ?? ''}${INDEX_USAGE} | ${QUERY_USAGE}`)
    return 1
  }
  catch (error) {
    if (error instanceof KnowledgeError) {
      io.stderr(error.message)
      return 1
    }
    io.stderr(error instanceof Error ? error.message : String(error))
    return 1
  }
}

async function runIndex(argv: readonly string[], io: CliIo): Promise<number> {
  const unknown = argv.filter(arg => arg !== '--force')
  if (unknown.length > 0) {
    io.stderr(`Неизвестные аргументы — ${unknown.join(' ')} | ${INDEX_USAGE}`)
    return 1
  }
  const force = argv.includes('--force')
  const summary = await index({
    repoRoot: io.repoRoot,
    dbPath: io.dbPath,
    embedder: io.embedder ?? defaultEmbedder(),
    force,
  })
  if (summary.dimensionChanged === true) {
    io.stderr('Размерность эмбеддингов изменилась — индекс знаний пересоздан полностью.')
  }
  io.stderr(`Файлы: всего ${summary.filesTotal}, пересчитано ${summary.filesIndexed}, пропущено ${summary.filesSkipped}, удалено ${summary.filesDeleted}.`)
  io.stderr(`Фрагменты знаний записаны: ${summary.chunksUpserted}; размерность эмбеддингов: ${summary.dimension}.`)
  return 0
}

async function runQueryCommand(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseQueryArgs(argv)
  if (typeof parsed === 'string') {
    io.stderr(`${parsed} | ${QUERY_USAGE}`)
    return 1
  }
  const options: QueryOptions = {
    k: parsed.k,
    type: parsed.type,
    dbPath: io.dbPath,
    embedder: io.embedder ?? defaultEmbedder(),
  }
  const response = await query(parsed.text, options)
  if (response.results.length === 0) {
    io.stdout('По запросу ничего не найдено.')
    return 0
  }
  response.results.forEach((hit, i) => {
    const heading = hit.heading === undefined ? '' : ` — ${hit.heading}`
    io.stdout(`${i + 1}. ${hit.file}${heading} (score ${hit.score.toFixed(4)})`)
    io.stdout(hit.excerpt)
    io.stdout('')
  })
  return 0
}

function parseQueryArgs(argv: readonly string[]): ParsedQueryArgs | string {
  const positional: string[] = []
  let k: number | undefined
  let type: string | undefined
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === undefined) {
      continue
    }
    if (arg === '--k') {
      const value = argv[i + 1]
      i += 1
      const parsed = Number(value)
      if (value === undefined || !Number.isInteger(parsed) || parsed < 1) {
        return '--k требует целое число ≥ 1'
      }
      k = parsed
      continue
    }
    if (arg === '--type') {
      type = argv[i + 1]
      i += 1
      if (type === undefined) {
        return '--type требует значение'
      }
      continue
    }
    if (arg.startsWith('--')) {
      return `Неизвестный аргумент — ${arg}`
    }
    positional.push(arg)
  }
  const text = positional.join(' ').trim()
  if (text.length === 0) {
    return 'Отсутствует текст запроса'
  }
  if (k !== undefined && k > 50) {
    return '--k не должен превышать 50'
  }
  if (type !== undefined && !(FILE_TYPES as readonly string[]).includes(type)) {
    return `Неизвестный file_type — ${type}`
  }
  return {
    text,
    k: k ?? DEFAULT_K,
    type: type as FileType | undefined,
  }
}

function defaultEmbedder(): Embedder {
  if (process.env['KNOWLEDGE_FAKE_EMBEDDER'] === '1') {
    return new FakeEmbedder()
  }
  const options: OllamaEmbedderOptions = {}
  return createOllamaEmbedder(options)
}

export async function main(argv: readonly string[]): Promise<number> {
  loadKnowledgeEnv()
  const io: CliIo = {
    stderr: (text) => { console.error(text) },
    stdout: (text) => { console.log(text) },
  }
  return await runCli(argv, io)
}

const invoked = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop() ?? '')

if (invoked) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    })
}
