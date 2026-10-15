import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './tools/registry.js'
import { knowledgeDocSearch } from './adapters/docs.js'

async function main(): Promise<void> {
  const cwd = process.cwd()
  if (!existsSync(join(cwd, '.git'))) {
    console.error('Не найден каталог .git — запускайте сервер из корня репозитория.')
    process.exit(1)
  }
  const server = createServer({ cwd, docSearch: knowledgeDocSearch({ dbPath: process.env['KNOWLEDGE_DB'] }) })
  await server.connect(new StdioServerTransport())
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
