import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { repoRoot } from './repoRoot.js'

export function parseEnvText(text: string): Record<string, string> {
  const parsed: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) {
      continue
    }
    const eq = line.indexOf('=')
    if (eq < 1) {
      continue
    }
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2)
      || (value.startsWith('\'') && value.endsWith('\'') && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    if (key.length > 0) {
      parsed[key] = value
    }
  }
  return parsed
}

export function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) {
    return
  }
  const parsed = parseEnvText(readFileSync(filePath, 'utf8'))
  for (const [key, value] of Object.entries(parsed)) {
    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

export function loadKnowledgeEnv(): void {
  loadEnvFile(join(repoRoot(), '.env'))
}
