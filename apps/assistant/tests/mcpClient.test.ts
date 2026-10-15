import { describe, expect, it, vi } from 'vitest'
import {
  McpGateway,
  validateContext,
  validateDiff,
  type McpConnection,
  type McpConnector,
  type McpToolResult,
} from '../backend/mcpClient'
import { AppError } from '../backend/errors'

const CONTEXT_JSON = JSON.stringify({
  branch: 'main',
  clean: true,
  changedFiles: [],
  lastCommit: { sha: 'd'.repeat(40), message: 'init', date: '2026-01-01T00:00:00Z' },
  truncated: false,
})
const DIFF_JSON = JSON.stringify({ diff: 'diff --git a/a b/a\n', totalLines: 2, truncated: false })

interface Recorder {
  calls: { name: string; args?: Record<string, unknown> }[]
  timeouts: number[]
  closed: number
}

function okConnection(failCall: Error | null, isError: boolean, recorder: Recorder): McpConnection {
  return {
    callTool: async (name, args, timeoutMs) => {
      recorder.calls.push({ name, args })
      recorder.timeouts.push(timeoutMs)
      if (failCall !== null) {
        throw failCall
      }
      if (isError) {
        const broken: McpToolResult = { content: [{ type: 'text', text: 'Не найден каталог .git' }], isError: true }
        return broken
      }
      const payload = name === 'get_context' ? CONTEXT_JSON : DIFF_JSON
      const ok: McpToolResult = { content: [{ type: 'text', text: payload }] }
      return ok
    },
    close: async () => {
      recorder.closed += 1
    },
  }
}

export interface ConnectionFactoryResult {
  gateway: McpGateway
  factories: Recorder[]
  connections: () => number
}

function makeGateway(options: { failCall: Error | null; isError: boolean }): ConnectionFactoryResult {
  const factories: Recorder[] = []
  const gateway = new McpGateway({
    connector: async () => {
      const recorder: Recorder = { calls: [], timeouts: [], closed: 0 }
      factories.push(recorder)
      // падение вызова — только на первом соединении; после рестарт-сценария соединения живые
      return okConnection(factories.length === 1 ? options.failCall : null, options.isError, recorder)
    },
  })
  return { gateway, factories, connections: () => factories.length }
}

describe('McpGateway — долгоживущий stdio-процесс (T-4, мок соединений)', () => {
  it('ленивое подключение: без вызовов коннектор не запускается', () => {
    let connected = 0
    new McpGateway({
      connector: async () => {
        connected += 1
        return okConnection(null, false, { calls: [], timeouts: [], closed: 0 })
      },
    })
    expect(connected).toBe(0)
  })

  it('getContext и gitDiff переиспользуют одно соединение: spawn один, аргументы и таймауты по контрактам', async () => {
    const { gateway, factories } = makeGateway({ failCall: null, isError: false })
    const context = await gateway.getContext()
    await gateway.gitDiff(200)

    expect(factories).toHaveLength(1)
    expect(factories[0]?.calls.map(call => call.name)).toEqual(['get_context', 'git_diff'])
    expect(factories[0]?.calls[1]?.args).toEqual({ maxLines: 200 })
    expect(factories[0]?.timeouts).toEqual([10_000, 15_000])
    expect(context.branch).toBe('main')
    expect(context.clean).toBe(true)
    expect(context.changedFiles).toEqual([])
  })

  it('максимум 200 строк diff — аргумент по умолчанию FR-3', async () => {
    const { gateway, factories } = makeGateway({ failCall: null, isError: false })
    await gateway.gitDiff()
    expect(factories[0]?.calls[0]?.args).toEqual({ maxLines: 200 })
  })

  it('isError-результат → 502 mcp_unavailable и соединение закрыто', async () => {
    const { gateway, factories, connections } = makeGateway({ failCall: null, isError: true })
    await expect(gateway.getContext()).rejects.toMatchObject({ code: 'mcp_unavailable', status: 502 })
    expect(factories[0]?.closed).toBe(1)
    expect(connections()).toBe(1)
  })

  it('рестарт при падении: после сбоя следующий вызов поднимает новое соединение', async () => {
    const { gateway, factories, connections } = makeGateway({ failCall: null, isError: false })
    const first = await gateway.getContext()
    expect(first.branch).toBe('main')
    expect(connections()).toBe(1)
    // соединение «умерло» — закрываем его, следующий вызов должен пересоздать
    await gateway.close()
    const second = await gateway.getContext()
    expect(second.branch).toBe('main')
    expect(connections()).toBe(2)
    expect(factories[1]?.calls[0]?.name).toBe('get_context')
  })

  it('ошибка вызова внутри соединения → соединение разрывается, ошибка mcp_unavailable', async () => {
    const { gateway, factories, connections } = makeGateway({ failCall: new Error('channel closed'), isError: false })
    await expect(gateway.getContext()).rejects.toMatchObject({ code: 'mcp_unavailable' })
    expect(factories[0]?.closed).toBe(1)
    // повторный вызов: новое соединение, успешный ответ (рестарт при падении)
    const context = await gateway.getContext()
    expect(context.branch).toBe('main')
    expect(connections()).toBe(2)
  })

  it('рестарт-коннектор: после сбоя соединение закрыто, повторный вызов получает НОВОЕ соединение', async () => {
    const all: McpConnection[] = []
    const closed: McpConnection[] = []
    let cached: McpConnection | null = null
    const connector: McpConnector = async () => {
      if (cached === null) {
        const index = all.length
        const connection: McpConnection = {
          callTool: async () => {
            if (index === 0) {
              throw new Error('channel timed out')
            }
            const payload: McpToolResult = { content: [{ type: 'text', text: CONTEXT_JSON }] }
            return payload
          },
          close: async () => {
            cached = null
            closed.push(connection)
          },
        }
        cached = connection
        all.push(connection)
      }
      return cached
    }
    const gateway = new McpGateway({ connector })

    await expect(gateway.getContext()).rejects.toMatchObject({ code: 'mcp_unavailable' })

    const restarted = await gateway.getContext()
    expect(restarted.branch).toBe('main')
    expect(all).toHaveLength(2)
    expect(closed).toEqual([all[0]])
    expect(all[0]).not.toBe(all[1])
  })

  it('ошибка коннектора → mcp_unavailable, последующий вызов пробует заново', async () => {
    let attempts = 0
    const gateway = new McpGateway({
      connector: async () => {
        attempts += 1
        if (attempts === 1) {
          throw new Error('spawn failed')
        }
        return okConnection(null, false, { calls: [], timeouts: [], closed: 0 })
      },
    })
    await expect(gateway.getContext()).rejects.toMatchObject({ code: 'mcp_unavailable' })
    expect(attempts).toBe(1)
    const context = await gateway.getContext()
    expect(context.branch).toBe('main')
    expect(attempts).toBe(2)
  })

  it('параллельные вызовы — одно соединение без гонок', async () => {
    const { gateway, connections } = makeGateway({ failCall: null, isError: false })
    const [context, diff] = await Promise.all([gateway.getContext(), gateway.gitDiff(200)])
    expect(context.branch).toBe('main')
    expect(diff.totalLines).toBe(2)
    expect(connections()).toBe(1)
  })
})

describe('валидаторы контрактов спеки 002', () => {
  it('validateContext отбраковывает некорректный payload', () => {
    expect(() => validateContext({})).toThrowError(AppError)
    expect(() => validateContext({ branch: 1, clean: true, changedFiles: [] })).toThrowError(AppError)
    const value = validateContext({ branch: 'x', clean: true, changedFiles: [], truncated: false })
    expect(value.truncated).toBe(false)
  })

  it('validateDiff отбраковывает некорректный payload, корректный проходит', () => {
    expect(() => validateDiff({ diff: 1 })).toThrowError(AppError)
    expect(validateDiff({ diff: '', totalLines: 0, truncated: false })).toEqual({
      diff: '',
      totalLines: 0,
      truncated: false,
    })
  })
})

