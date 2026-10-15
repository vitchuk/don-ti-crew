import type { McpCall } from '../../src/collect'

export interface SessionCall {
  name: string
  args: Record<string, unknown>
  timeoutMs: number
}

export interface StubSession extends McpCall {
  calls: SessionCall[]
  closed: number
}

export interface StubOutcome {
  payload?: unknown
  error?: string
  raw?: unknown
}

export type StubResolver = (name: string, args: Record<string, unknown>) => unknown | StubOutcome

export function stubSession(resolve: StubResolver): StubSession {
  const session: StubSession = {
    calls: [],
    closed: 0,
    callTool: async (name, args, timeoutMs) => {
      session.calls.push({ name, args, timeoutMs })
      return toResult(resolve(name, args))
    },
    close: async () => {
      session.closed += 1
    },
  }
  return session
}

export function toResult(item: unknown | StubOutcome): unknown {
  if (typeof item !== 'object' || item === null) {
    return wrap(item)
  }
  const outcome = item as StubOutcome
  if (outcome.error !== undefined) {
    return errPayload(outcome.error)
  }
  if ('raw' in outcome && outcome.raw !== undefined) {
    return outcome.raw
  }
  if ('payload' in outcome && outcome.payload !== undefined) {
    return wrap(outcome.payload)
  }
  return wrap(item)
}

export function wrap(value: unknown): unknown {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

export function errPayload(text: string): unknown {
  return { content: [{ type: 'text', text }], isError: true }
}

export const DIFF_OK = {
  diff: 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n+a\n',
  totalLines: 5,
  truncated: false,
}

export const FILES_OK = {
  files: [
    { file: 'apps/assistant/backend/a.ts', state: 'modified' },
    { file: 'pnpm-lock.yaml', state: 'modified' },
  ],
  truncated: false,
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export function okCompletion(content: string): Response {
  return jsonResponse(200, { choices: [{ message: { role: 'assistant', content } }] })
}
