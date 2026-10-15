import { run, runOk, GitError } from '../lib/spawn.js'
import { truncateLines, type LinesResult } from '../lib/truncate.js'

export type ChangeState
  = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflict'

export interface ChangeEntry {
  file: string
  state: ChangeState
}

export interface GitStatusResult {
  clean: boolean
  changes: ChangeEntry[]
  truncated: boolean
}

export interface GitDiffResult {
  diff: string
  totalLines: number
  truncated: boolean
}

export interface ChangedFilesResult {
  files: ChangeEntry[]
  truncated: boolean
}

export interface LastCommit {
  sha: string
  message: string
  date: string
}

export interface GitDiffArgs {
  cwd?: string
  target?: string
  base?: string
  head?: string
  maxLines?: number
}

export interface ChangedFilesArgs {
  cwd?: string
  base: string
  head: string
}

export const MAX_CHANGES = 200
export const DEFAULT_DIFF_LINES = 400

const RECORD_SEPARATOR = '\u0000'
const FIELD_SEPARATOR = '\u001f'
const UNBORN_HEADER_PREFIX = 'No commits yet on '
const SHA_PATTERN = /^[0-9a-f]{40,64}$/
const STATE_BY_CODE: Record<string, ChangeState> = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  T: 'modified',
  C: 'renamed',
}

export async function getCurrentBranch(cwd = process.cwd()): Promise<{ branch: string }> {
  const status = await run(cwd, ['status', '--porcelain=v1', '-b', '-z', '-uall'])
  if (status.code !== 0) {
    return { branch: 'HEAD' }
  }
  const { branch, changes } = parseStatusOutput(status.stdout)
  if (branch !== null) {
    return { branch }
  }
  if (changes.length === 0) {
    return { branch: 'HEAD' }
  }
  const commit = await readHeadCommit(cwd)
  return { branch: commit !== null ? commit.slice(0, 12) : 'HEAD' }
}

export async function gitStatus(cwd = process.cwd(), maxChanges = MAX_CHANGES): Promise<GitStatusResult> {
  const { changes } = await readStatus(cwd)
  return {
    clean: changes.length === 0,
    changes: changes.slice(0, maxChanges),
    truncated: changes.length > maxChanges,
  }
}

export async function getLastCommit(cwd = process.cwd()): Promise<LastCommit | null> {
  const result = await run(cwd, ['log', '-1', `--pretty=format:%H${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%cI`])
  if (result.code !== 0) {
    return null
  }
  const fields = result.stdout.split(FIELD_SEPARATOR)
  const sha = fields[0]
  const message = fields[1]
  const date = fields[2]
  if (sha === undefined || message === undefined || date === undefined) {
    throw new GitError('Некорректный вывод git log')
  }
  return { sha: sha.trim(), message: message.trim(), date: date.trim() }
}

export async function gitDiff(args: GitDiffArgs): Promise<GitDiffResult> {
  const cwd = args.cwd ?? process.cwd()
  const maxLines = args.maxLines ?? DEFAULT_DIFF_LINES
  if (args.target !== undefined && (args.base !== undefined || args.head !== undefined)) {
    throw new GitError('target и base/head взаимоисключимы')
  }
  if (args.base !== undefined && args.head === undefined) {
    throw new GitError('head должен быть задан вместе с base')
  }
  if (args.head !== undefined && args.base === undefined) {
    throw new GitError('base должен быть задан вместе с head')
  }
  if (args.base !== undefined && args.head !== undefined) {
    const baseSha = await resolveRef(cwd, args.base)
    const headSha = await resolveRef(cwd, args.head)
    const mergeBase = await findMergeBase(cwd, baseSha, headSha)
    return diffTrees(cwd, mergeBase, headSha, maxLines)
  }
  const target = args.target ?? 'HEAD'
  if (args.target === undefined && await isUnbornHead(cwd)) {
    return { diff: '', totalLines: 0, truncated: false }
  }
  const targetSha = await resolveRef(cwd, target)
  const output = await runOk(cwd, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', targetSha, '--'])
  return toDiffResult(truncateLines(output, maxLines))
}

export async function changedFiles(args: ChangedFilesArgs): Promise<ChangedFilesResult> {
  const cwd = args.cwd ?? process.cwd()
  const baseSha = await resolveRef(cwd, args.base)
  const headSha = await resolveRef(cwd, args.head)
  const mergeBase = await findMergeBase(cwd, baseSha, headSha)
  const output = await runOk(cwd, ['diff', '--name-status', '--find-renames', '--no-ext-diff', '-z', mergeBase, headSha, '--'])
  const entries = parseNameStatus(output)
  return {
    files: entries.slice(0, MAX_CHANGES),
    truncated: entries.length > MAX_CHANGES,
  }
}

export async function resolveRef(cwd: string, ref: string): Promise<string> {
  if (ref.startsWith('-')) {
    throw new GitError(`недопустимая git-ссылка: ${ref}`)
  }
  const result = await run(cwd, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`])
  if (result.code !== 0) {
    throw new GitError(`недопустимая git-ссылка: ${ref}`)
  }
  const sha = result.stdout.trim()
  if (!SHA_PATTERN.test(sha)) {
    throw new GitError(`недопустимая git-ссылка: ${ref}`)
  }
  return sha
}

async function findMergeBase(cwd: string, baseSha: string, headSha: string): Promise<string> {
  const result = await run(cwd, ['merge-base', baseSha, headSha])
  if (result.code !== 0) {
    throw new GitError('Ветки не имеют общих предков')
  }
  const mergeBase = result.stdout.trim()
  if (!SHA_PATTERN.test(mergeBase)) {
    throw new GitError('Ветки не имеют общих предков')
  }
  return mergeBase
}

async function diffTrees(cwd: string, baseSha: string, headSha: string, maxLines: number): Promise<GitDiffResult> {
  const output = await runOk(cwd, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', baseSha, headSha, '--'])
  return toDiffResult(truncateLines(output, maxLines))
}

function toDiffResult(limited: LinesResult): GitDiffResult {
  return {
    diff: limited.text,
    totalLines: limited.totalLines,
    truncated: limited.truncated,
  }
}

interface RawStatus {
  branch: string | null
  changes: ChangeEntry[]
}

async function readStatus(cwd: string): Promise<RawStatus> {
  const output = await runOk(cwd, ['status', '--porcelain=v1', '-b', '-z', '-uall'])
  return parseStatusOutput(output)
}

function parseStatusOutput(output: string): RawStatus {
  const records = output.split(RECORD_SEPARATOR)
  if (records.length > 0 && (records[records.length - 1] ?? null) === '') {
    records.pop()
  }
  const header = records[0]
  const hasHeader = header !== undefined && isBranchHeader(header)
  const changes: ChangeEntry[] = []
  let index = hasHeader ? 1 : 0
  while (index < records.length) {
    const record = records[index]
    if (record === undefined) {
      break
    }
    const entry = parseStatusRecord(record)
    if (entry === null) {
      break
    }
    changes.push(entry.change)
    index += entry.nextOffset
  }
  return {
    branch: hasHeader ? parseBranchHeader(header) : null,
    changes,
  }
}

function isBranchHeader(record: string): boolean {
  return record.startsWith('##')
}

function parseBranchHeader(header: string): string {
  let body = header.slice(2).trim()
  if (body.startsWith(UNBORN_HEADER_PREFIX)) {
    body = body.slice(UNBORN_HEADER_PREFIX.length).trim()
  }
  else if (body.startsWith('(no branch)') || body.includes(' HEAD (no branch)')) {
    return 'HEAD'
  }
  else {
    const dots = body.split('...', 2)
    body = dots[0] ?? body
  }
  return body
}

function parseStatusRecord(record: string): { change: ChangeEntry; nextOffset: number } | null {
  if (record.length < 3 || record[2] !== ' ') {
    return null
  }
  const key = record.slice(0, 2)
  const state = mapStatusKey(key)
  if (state === null) {
    return null
  }
  return {
    change: { file: record.slice(3), state },
    nextOffset: key.includes('R') || key.includes('C') ? 2 : 1,
  }
}

function mapStatusKey(key: string): ChangeState | null {
  if (key === '??') {
    return 'untracked'
  }
  const x = key[0]
  const y = key[1]
  if (x === 'U' || y === 'U' || key === 'AA' || key === 'DD') {
    return 'conflict'
  }
  for (const code of [x, y]) {
    const state = code !== undefined ? STATE_BY_CODE[code] : undefined
    if (state !== undefined) {
      return state
    }
  }
  return null
}

function parseNameStatus(output: string): ChangeEntry[] {
  const records = output.split(RECORD_SEPARATOR)
  if (records.length > 0 && (records[records.length - 1] ?? null) === '') {
    records.pop()
  }
  const entries: ChangeEntry[] = []
  let index = 0
  while (index < records.length) {
    const status = records[index]
    if (status === undefined || status.length === 0) {
      break
    }
    const code = status[0] ?? 'M'
    const oldPath = records[index + 1]
    if (oldPath === undefined) {
      break
    }
    if (code === 'R' || code === 'C') {
      const newPath = records[index + 2]
      if (newPath === undefined) {
        break
      }
      entries.push({ file: newPath, state: STATE_BY_CODE[code] ?? 'renamed' })
      index += 3
    }
    else {
      entries.push({
        file: oldPath,
        state: STATE_BY_CODE[code] ?? 'modified',
      })
      index += 2
    }
  }
  return entries
}

export async function isUnbornHead(cwd: string): Promise<boolean> {
  const result = await run(cwd, ['rev-parse', '--verify', '--quiet', '--end-of-options', 'HEAD'])
  return result.code !== 0
}

export async function readHeadCommit(cwd: string): Promise<string | null> {
  if (await isUnbornHead(cwd)) {
    return null
  }
  const output = await runOk(cwd, ['rev-parse', '--verify', '--end-of-options', 'HEAD'])
  return output.trim()
}
