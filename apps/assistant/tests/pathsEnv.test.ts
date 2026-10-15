import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { knowledgeDbPath, mcpServerPath, repoRoot } from '../backend/paths'
import { loadEnvFile, parseEnvText } from '../backend/env'

describe('paths', () => {
  it('repoRoot — корень репозитория с .git', () => {
    const root = repoRoot()
    expect(root.replace(/[\\/]+$/, '').split(/[\\/]/).pop()).toBe('don-ti-crew')
  })

  it('KNOWLEDGE_DB задаёт путь к базе индекса знаний (по умолчанию — корень репо)', () => {
    const previous = process.env['KNOWLEDGE_DB']
    process.env['KNOWLEDGE_DB'] = join('C:', 'tmp', 'x.db')
    try {
      expect(knowledgeDbPath()).toBe('C:\\tmp\\x.db')
    }
    finally {
      if (previous === undefined) {
        delete process.env['KNOWLEDGE_DB']
      }
      else {
        process.env['KNOWLEDGE_DB'] = previous
      }
    }
  })

  it('mcpServerPath указывает на services/mcp-server/dist/index.js', () => {
    expect(mcpServerPath()).toBe(join(repoRoot(), 'services', 'mcp-server', 'dist', 'index.js'))
  })
})

describe('parseEnvText / loadEnvFile — минимальный dotenv (T-6)', () => {
  it('KEY=VALUE, кавычки, комментарии и пустые строки', () => {
    const parsed = parseEnvText([
      '# комментарий',
      '',
      'ASSISTANT_LLM=deepseek',
      'DEEPSEEK_API_KEY="sk-secret-value"',
      "SINGLE='x= y'",
      '# DEEPSEEK_MODEL=oomph',
      'NOT_A_PAIR',
    ].join('\n'))
    expect(parsed).toEqual({
      ASSISTANT_LLM: 'deepseek',
      DEEPSEEK_API_KEY: 'sk-secret-value',
      SINGLE: 'x= y',
    })
  })

  it('loadEnvFile загружает файл и не перезаписывает уже заданные переменные', () => {
    const dir = mkdtempSync(join(tmpdir(), 'assistant-env-'))
    const file = join(dir, '.env')
    try {
      writeFileSync(file, 'ASSISTANT_ENV_FILE=yes\nDEEPSEEK_API_KEY=sk-file\n', 'utf8')
      const savedKey = process.env['DEEPSEEK_API_KEY']
      process.env['DEEPSEEK_API_KEY'] = 'sk-env-has-priority'
      try {
        loadEnvFile(file)
        expect(process.env['ASSISTANT_ENV_FILE']).toBe('yes')
        expect(process.env['DEEPSEEK_API_KEY']).toBe('sk-env-has-priority')
      }
      finally {
        if (savedKey === undefined) {
          delete process.env['DEEPSEEK_API_KEY']
        }
        else {
          process.env['DEEPSEEK_API_KEY'] = savedKey
        }
        delete process.env['ASSISTANT_ENV_FILE']
      }
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
      expect(existsSync(file)).toBe(false)
    }
  })
})
