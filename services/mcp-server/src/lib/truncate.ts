export const EXCERPT_LIMIT = 500

export interface LinesResult {
  text: string
  totalLines: number
  truncated: boolean
}

export function truncateLines(text: string, maxLines: number): LinesResult {
  if (text.length === 0) {
    return { text, totalLines: 0, truncated: false }
  }
  const lines = text.split('\n')
  if ((lines[lines.length - 1] ?? '') === '') {
    lines.pop()
  }
  const totalLines = lines.length
  if (totalLines <= maxLines) {
    return { text, totalLines, truncated: false }
  }
  return {
    text: lines.slice(0, maxLines).join('\n'),
    totalLines,
    truncated: true,
  }
}

export function truncateExcerpt(text: string, max = EXCERPT_LIMIT): string {
  if (text.length <= max) {
    return text
  }
  const cut = text.slice(0, max)
  const breakAt = cut.lastIndexOf(' ')
  if (breakAt > max / 2) {
    return cut.slice(0, breakAt)
  }
  return cut
}
