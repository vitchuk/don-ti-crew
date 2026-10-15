import { describe, expect, it } from 'vitest'
import { chunkMarkdown, chunkCode, MARKDOWN_CHUNK_LIMIT, CODE_CHUNK_LIMIT } from '../../src/chunker.js'

describe('chunkMarkdown', () => {
  it('builds headingPath « > » and keeps file path on every chunk', () => {
    const chunks = chunkMarkdown('# А\n\nтекст один.\n\n## Б\n\nтекст два.\n', 'docs/guide.md')
    expect(chunks.map(c => c.headingPath)).toEqual(['А', 'А > Б'])
    expect(chunks.every(c => c.filePath === 'docs/guide.md')).toBe(true)
    expect(chunks.every(c => c.fileType === 'docs')).toBe(true)
  })

  it('content before the first heading has no headingPath', () => {
    const chunks = chunkMarkdown('вводный абзац\n\n# Заголовок\n\nтекст\n**', 'README.md')
    expect(chunks[0]?.headingPath).toBeUndefined()
    expect(chunks[1]?.headingPath).toBe('Заголовок')
    expect(chunks.every(c => c.fileType === 'readme')).toBe(true)
  })

  it('AC-7: long paragraph is split into pieces ≤ ~800 chars with same headingPath', () => {
    const paragraph = Array.from({ length: 40 }, (_, i) => `Предложение номер ${i} с большим числом слов для хорошего наполнения абзаца на много строк документа.`).join(' ')
    const source = `# Длинный раздел\n\n${paragraph}\n`
    const chunks = chunkMarkdown(source, 'docs/long.md')
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(c => (c.content?.length ?? 0) <= MARKDOWN_CHUNK_LIMIT)).toBe(true)
    expect(chunks.every(c => c.headingPath === 'Длинный раздел')).toBe(true)
    expect(chunks.every(c => c.filePath === 'docs/long.md')).toBe(true)
  })

  it('headings inside fenced code are not headings', () => {
    const source = '# Раздел\n\n```ini\n# это комментарий конфига\nвнутри блока\n```\n\nфинал\n'
    const chunks = chunkMarkdown(source, 'docs/fenced.md')
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.headingPath).toBe('Раздел')
    expect(chunks[0]?.content).toContain('# это комментарий конфига')
  })

  it('specs files get specs file_type', () => {
    const chunks = chunkMarkdown('# Спека\n\nтекст\n', 'specs/003/spec.md')
    expect(chunks.every(c => c.fileType === 'specs')).toBe(true)
  })

  it('adr files get adr file_type (priority over docs)', () => {
    const chunks = chunkMarkdown('# ADR\n\nрешение\n', 'docs/adr/0005-x.md')
    expect(chunks.every(c => c.fileType === 'adr')).toBe(true)
  })
})

describe('chunkCode', () => {
  it('keeps a small file as a single chunk (AC-8 inverse)', () => {
    const content = Array.from({ length: 5 }, (_, i) => `line ${i}`).join('\n')
    const chunks = chunkCode(content, 'services/m/src/a.ts', 'code')
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.content).toBe(content)
    expect(chunks[0]?.headingPath).toBeUndefined()
  })

  it('AC-8: a file > 1200 chars splits into blocks of the same file_path, each ≤ 1200', () => {
    const blocks = Array.from({ length: 30 }, (_, i) => `export const block${i} = () => {\n  const value = ${i}\n  return 'something-pretty-long-${i}'\n}\n`)
    const content = blocks.join('\n')
    expect(content.length).toBeGreaterThan(CODE_CHUNK_LIMIT)
    const chunks = chunkCode(content, 'services/m/src/big.ts', 'code')
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(c => c.content.length <= CODE_CHUNK_LIMIT)).toBe(true)
    expect(chunks.every(c => c.filePath === 'services/m/src/big.ts')).toBe(true)
    expect(chunks.every(c => c.fileType === 'code')).toBe(true)
  })

  it('splits an oversized single line (minified config) into pieces ≤ 1200', () => {
    const json = JSON.stringify({ data: Array.from({ length: 300 }, (_, i) => ({ id: i, name: `item-${i}`, note: '' })) })
    const chunks = chunkCode(json, 'config-data.json', 'config')
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(c => c.content.length <= CODE_CHUNK_LIMIT)).toBe(true)
    expect(chunks.every(c => c.fileType === 'config')).toBe(true)
  })

  it('merges small blocks up to the limit', () => {
    const blocks = Array.from({ length: 8 }, (_, i) => `const a${i} = ${i}\n`)
    const content = blocks.join('\n\n')
    const chunks = chunkCode(content, 'services/m/src/small.ts', 'code')
    expect(chunks.length).toBe(1)
  })})
