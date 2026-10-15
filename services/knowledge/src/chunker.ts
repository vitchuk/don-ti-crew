import { classifyFile } from './walk.js'
import type { Chunk, FileType } from './types.js'

export const MARKDOWN_CHUNK_LIMIT = 800
export const CODE_CHUNK_LIMIT = 1200

interface Section {
  headingPath?: string
  paragraph: string
}

export function chunkMarkdown(content: string, filePath: string): Chunk[] {
  const fileType = classifyFile(filePath) ?? 'docs'
  const sections = parseSections(content)
  const result: Chunk[] = []
  for (const section of sections) {
    for (const text of wrapParagraphs([section.paragraph], MARKDOWN_CHUNK_LIMIT, '\n\n')) {
      result.push({
        filePath,
        fileType,
        headingPath: section.headingPath,
        content: text,
      })
    }
  }
  return result
}

export function chunkCode(content: string, filePath: string, fileType: FileType): Chunk[] {
  if (content.length <= CODE_CHUNK_LIMIT) {
    return [{ filePath, fileType, content: content.trim() }]
  }
  const blocks = splitTopLevelBlocks(content)
  return wrapParagraphs(blocks, CODE_CHUNK_LIMIT, '\n\n').map(text => ({
    filePath,
    fileType,
    content: text,
  }))
}

function parseSections(content: string): Section[] {
  const sections: Section[] = []
  const ancestors: { level: number; title: string }[] = []
  const buffer: string[] = []
  let headingPath: string | undefined
  let fence: string | null = null
  for (const line of content.split('\n')) {
    if (fence !== null) {
      buffer.push(line)
      const close = new RegExp(`^\\s{0,3}\\${fence}\\s*$`)
      if (close.test(line)) {
        fence = null
      }
      continue
    }
    const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (open !== null) {
      fence = open[1] ?? ''
      buffer.push(line)
      continue
    }
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading === null) {
      buffer.push(line)
      continue
    }
    const text = buffer.join('\n')
    buffer.length = 0
    if (text.trim().length > 0) {
      sections.push({ headingPath, paragraph: text })
    }
    const level = (heading[1] ?? '').length
    const title = (heading[2] ?? '').trim()
    while (ancestors.length > 0 && (ancestors[ancestors.length - 1]?.level ?? 0) >= level) {
      ancestors.pop()
    }
    headingPath = [...ancestors.map(item => item.title), title].join(' > ')
    ancestors.push({ level, title })
  }
  const rest = buffer.join('\n')
  if (rest.trim().length > 0) {
    sections.push({ headingPath, paragraph: rest })
  }
  return sections
}

function splitTopLevelBlocks(content: string): string[] {
  const lines = content.split('\n')
  const blocks: string[] = []
  const current: string[] = []
  let blank = true
  const flush = (): void => {
    const text = current.join('\n')
    if (text.trim().length > 0) {
      blocks.push(text)
    }
    current.length = 0
  }
  for (const line of lines) {
    if (line.trim().length === 0) {
      blank = true
      current.push(line)
      continue
    }
    const indent = /^\s*/.exec(line)?.[0] ?? ''
    if (blank && indent.length === 0 && current.length > 0) {
      flush()
    }
    blank = false
    current.push(line)
  }
  flush()
  return blocks
}

function wrapParagraphs(paragraphs: string[], limit: number, joiner: string): string[] {
  const pieces: string[] = []
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim()
    if (trimmed.length === 0) {
      continue
    }
    if (trimmed.length <= limit) {
      pieces.push(trimmed)
      continue
    }
    for (const text of wrapText(trimmed, limit)) {
      pieces.push(text)
    }
  }
  const result: string[] = []
  let current: string | null = null
  for (const piece of pieces) {
    if (current === null) {
      current = piece
    }
    else if (current.length + joiner.length + piece.length <= limit) {
      current = `${current}${joiner}${piece}`
    }
    else {
      result.push(current)
      current = piece
    }
  }
  if (current !== null) {
    result.push(current)
  }
  return result
}

function wrapText(text: string, limit: number): string[] {
  const sentences = text
    .split(/(?<=[.!?…])\s+/)
    .flatMap(sentence => sentence.length <= limit ? [sentence] : wrapWords(sentence, limit))
  const result: string[] = []
  let current: string | null = null
  for (const sentence of sentences) {
    if (current === null) {
      current = sentence
    }
    else if (current.length + 1 + sentence.length <= limit) {
      current = `${current} ${sentence}`
    }
    else {
      result.push(current)
      current = sentence
    }
  }
  if (current !== null) {
    result.push(current)
  }
  return result
}

function wrapWords(text: string, limit: number): string[] {
  const result: string[] = []
  let rest = text
  while (rest.length > limit) {
    const cut = rest.slice(0, limit)
    const space = cut.lastIndexOf(' ')
    const edge = space > limit / 2 ? space : limit
    result.push(rest.slice(0, edge).trimEnd())
    rest = rest.slice(edge).trimStart()
  }
  if (rest.length > 0) {
    result.push(rest)
  }
  return result
}
