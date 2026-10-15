import { spawn } from 'node:child_process'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

export class GitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitError'
  }
}

export function decode(chunks: readonly Buffer[]): string {
  if (chunks.length === 0) return ''
  return Buffer.concat(chunks).toString('utf8')
}

export async function run(cwd: string, args: readonly string[], timeoutMs = 10_000): Promise<RunResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn('git', [...args], { cwd, shell: false, windowsHide: true })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      child.kill()
      reject(new GitError(`Команда git превысила таймаут: ${args.join(' ')}`))
    }, timeoutMs)
    timer.unref?.()
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error.code === 'ENOENT' ? new GitError('Git не найден в системе.') : new GitError(error.message))
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        code: code ?? -1,
        stdout: decode(stdout),
        stderr: decode(stderr),
      })
    })
  })
}

export async function runOk(cwd: string, args: readonly string[]): Promise<string> {
  const result = await run(cwd, args)
  if (result.code !== 0) {
    const detail = firstLine(result.stderr) || firstLine(result.stdout)
    throw new GitError(detail || `git завершился с кодом ${result.code}: ${args.join(' ')}`)
  }
  return result.stdout
}

function firstLine(text: string): string {
  const lines = text.split(/\r?\n/).filter(line => line.length > 0)
  const line = lines[0]
  return line !== undefined ? line : ''
}
