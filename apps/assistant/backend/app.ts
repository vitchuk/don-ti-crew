import { Hono, type Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { loadAssistantEnv } from './env.js'
import { toErrorOutcome } from './errors.js'
import { validateQuestion } from './validate.js'
import { buildDefaultBackendDeps, defaultOrchestrationDeps } from './deps.js'
import type { AskAnswer, HealthResponse } from '../src/types.js'

// .env подгружается до первого обращения к переменным окружения (FR-5).
loadAssistantEnv()

/**
 * Зависимости маршрутов — подменяемы для e2e-тестов.
 * Дефолтные собираются в deps.ts (MCP-шлюз + knowledge.query + LLM, plan.md).
 */
export interface BackendDeps {
  ask: (question: string) => Promise<AskAnswer>
  health: () => Promise<HealthResponse>
}

export function createApp(deps: BackendDeps = buildDefaultBackendDeps()): Hono {
  const app = new Hono()

  app.post('/api/ask', async (c) => {
    try {
      const body = await parseBody(c)
      const question = validateQuestion(body['question'])
      const result = await deps.ask(question)
      return c.json(result)
    }
    catch (error) {
      return respondError(c, error)
    }
  })

  app.get('/api/health', async (c) => {
    try {
      return c.json(await deps.health())
    }
    catch (error) {
      return respondError(c, error)
    }
  })

  return app
}

/** Дефолтное Hono-приложение — запись для @hono/vite-dev-server (export: 'default'). */
const defaultOrchestration = defaultOrchestrationDeps()
export default createApp(buildDefaultBackendDeps(defaultOrchestration))

const hot = import.meta.hot
if (hot !== undefined) {
  hot.dispose(async () => {
    await defaultOrchestration.mcp.close()
  })
}

async function parseBody(c: Context): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await c.req.raw.json()
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {}
    }
    return parsed as Record<string, unknown>
  }
  catch {
    return {}
  }
}

function respondError(c: Context, error: unknown): Response {
  const outcome = toErrorOutcome(error)
  return c.json(outcome.body, outcome.status as ContentfulStatusCode)
}
