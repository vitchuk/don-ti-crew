export type Severity = 'Critical' | 'High' | 'Medium' | 'Low'

export const SEVERITY_ORDER: readonly Severity[] = ['Critical', 'High', 'Medium', 'Low']

export interface Finding {
  severity: Severity
  file: string
  line?: number
  message: string
  recommendation: string
  note?: string
}

export interface ReportCitation {
  file: string
  heading?: string
}

export interface ReportInput {
  base: string
  head: string
  model: string
  findings: Finding[]
  diffTruncated?: boolean
  filesTruncated?: boolean
  citations?: ReportCitation[]
}

export const MAX_REPORT_CITATIONS = 10

const NO_FINDINGS_PHRASE = 'Находок нет'
const CITATIONS_HEADING = '## Опора на знания (цитаты)'
const FILES_TRUNCATED_NOTE = '_Список изменённых файлов усечён (cap 200)._'
const HEADING_PATTERN = /^###\s+(\S+)\s+—\s+(.+)$/
const MESSAGE_MARKER = '**Описание:**'
const RECOMMENDATION_MARKER = '**Рекомендация:**'
const CANONICAL_SEVERITY: Record<string, Severity> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export function parseFindings(markdown: string): Finding[] {
  const text = markdown.trim()
  if (text.length === 0) {
    return []
  }
  const findings = parseBlocks(text)
  if (findings.length > 0) {
    return findings
  }
  if (/находок нет/i.test(text)) {
    return []
  }
  return [{
    severity: 'Low',
    file: '—',
    message: clip(text, 1000),
    recommendation: '—',
    note: 'ответ модели был без ожидаемой разметки',
  }]
}

export function summarizeCounts(findings: Finding[]): string {
  const counters: Record<Severity, number> = { Critical: 0, High: 0, Medium: 0, Low: 0 }
  for (const finding of findings) {
    counters[finding.severity] += 1
  }
  return `Critical ${counters.Critical} · High ${counters.High} · Medium ${counters.Medium} · Low ${counters.Low}`
}

export function renderReport(input: ReportInput): string {
  const findings = [...input.findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
  const lines: string[] = []
  lines.push('## 🔍 AI Code Review')
  lines.push(`**base** \`${input.base}\` → **head** \`${input.head}\` · модель \`${input.model}\``)
  lines.push('')
  lines.push(`### Сводка: ${summarizeCounts(findings)}`)
  lines.push('_Нон-блокирующее ревью: решает человек (ADR-0007)._')
  if (input.diffTruncated === true) {
    lines.push('')
    lines.push('_Диф усечён по лимиту строк._')
  }
  if (input.filesTruncated === true) {
    lines.push('')
    lines.push(FILES_TRUNCATED_NOTE)
  }
  if (findings.length === 0) {
    lines.push('')
    lines.push(`**${NO_FINDINGS_PHRASE}** — замечаний по направлениям проверки нет.`)
  }
  else {
    for (const finding of findings) {
      lines.push('')
      const location = finding.line === undefined ? finding.file : `${finding.file}:${finding.line}`
      lines.push(`### ${finding.severity} — \`${location}\``)
      if (finding.note !== undefined) {
        lines.push(`_(${finding.note})_`)
      }
      lines.push(`**Описание:** ${finding.message}`)
      lines.push(`**Рекомендация:** ${finding.recommendation}`)
    }
  }
  const citations = citationListLines(input.citations)
  if (citations.length > 0) {
    lines.push('')
    lines.push(CITATIONS_HEADING)
    lines.push(...citations)
  }
  return `${lines.join('\n')}\n`
}

export function citationListLines(citations: readonly ReportCitation[] | undefined): string[] {
  if (citations === undefined || citations.length === 0) {
    return []
  }
  const lines: string[] = []
  const seen = new Set<string>()
  for (const citation of citations) {
    const key = `${citation.file}\u0000${citation.heading ?? ''}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    lines.push(citation.heading === undefined
      ? `- \`${citation.file}\``
      : `- \`${citation.file}\` — ${citation.heading}`)
    if (lines.length >= MAX_REPORT_CITATIONS) {
      break
    }
  }
  return lines
}

function parseBlocks(text: string): Finding[] {
  const findings: Finding[] = []
  const lines = text.split(/\r?\n/)
  let current: Block | null = null
  for (const line of lines) {
    if (line.startsWith('### ')) {
      const parsed = parseHeading(line)
      if (current !== null) {
        findings.push(toFinding(current))
      }
      current = parsed
      continue
    }
    if (current === null) {
      continue
    }
    if (line.startsWith(MESSAGE_MARKER)) {
      current.message = line.slice(MESSAGE_MARKER.length).trim()
      continue
    }
    if (line.startsWith(RECOMMENDATION_MARKER)) {
      current.recommendation = line.slice(RECOMMENDATION_MARKER.length).trim()
    }
  }
  if (current !== null) {
    findings.push(toFinding(current))
  }
  return findings.length > 0 ? findings : []
}

interface Block {
  severity: Severity
  note?: string
  rawLocation: string
  message: string
  recommendation: string
}

function parseHeading(line: string): Block {
  const match = HEADING_PATTERN.exec(line)
  if (match === null) {
    return {
      severity: 'Low',
      note: 'заголовок находки не разобран — сведено к Low',
      rawLocation: '',
      message: line.slice(4).trim(),
      recommendation: '',
    }
  }
  const level = match[1] ?? ''
  const location = (match[2] ?? '').trim()
  const canonical = CANONICAL_SEVERITY[level.toLowerCase()]
  if (canonical !== undefined) {
    return {
      severity: canonical,
      rawLocation: stripBackticks(location),
      message: '',
      recommendation: '',
    }
  }
  return {
    severity: 'Low',
    note: `нераспознанный уровень «${level}» — сведено к Low`,
    rawLocation: stripBackticks(location),
    message: '',
    recommendation: '',
  }
}

function toFinding(block: Block): Finding {
  const { file, line } = splitLocation(block.rawLocation)
  return {
    severity: block.severity,
    file: file.length === 0 ? '—' : file,
    ...(line === undefined ? {} : { line }),
    message: block.message.length === 0 ? '—' : block.message,
    recommendation: block.recommendation.length === 0 ? '—' : block.recommendation,
    ...(block.note === undefined ? {} : { note: block.note }),
  }
}

function splitLocation(raw: string): { file: string; line?: number } {
  const location = stripBackticks(raw).trim()
  if (location.length === 0) {
    return { file: '' }
  }
  const colon = location.lastIndexOf(':')
  if (colon > 0 && /^\d+$/.test(location.slice(colon + 1))) {
    return { file: location.slice(0, colon), line: Number(location.slice(colon + 1)) }
  }
  return { file: location }
}

function stripBackticks(text: string): string {
  return text.replaceAll('`', '').trim()
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}
