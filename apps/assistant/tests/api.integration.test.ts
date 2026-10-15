import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../backend/app'
import { AppError } from '../backend/errors'
import type { AskAnswer, HealthResponse } from '../src/types'

const ANSWER: AskAnswer = {
  answer: 'Таймер — фазы, раунды, циклы по протоколу Табаты.',
  citations: [{ file: 'specs/001-tabata-timer/spec.md', heading: 'Таймер' }],
  context: { branch: 'main', clean: true, changedFilesCount: 0 },
}

const HEALTH: HealthResponse = {
  status: 'ok',
  llm: { provider: 'deepseek', ready: true },
  knowledge: { indexPresent: true },
}

function deps(overrides: { ask?: () => Promise<AskAnswer>; health?: () => Promise<HealthResponse> } = {}) {
  return {
    ask: overrides.ask ?? vi.fn(async () => ANSWER),
    health: overrides.health ?? vi.fn(async () => HEALTH),
  }
}

async function requestAsk(app: ReturnType<typeof createApp>, body: unknown): Promise<Response> {
  return await app.request('/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('API e2e на Hono app.request (спека 004, таблица деградаций)', () => {
  it('POST /api/ask валидный вопрос → 200 и тело AskAnswer', async () => {
    const { ask } = deps()
    const app = createApp({ ask, health: deps().health })
    const response = await requestAsk(app, { question: 'как работает таймер?' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(ANSWER)
    expect(ask).toHaveBeenCalledWith('как работает таймер?')
  })

  it('POST /api/ask пустой вопрос → 400 invalid_question, тело { error: { code, message } }', async () => {
    const app = createApp(deps())
    const response = await requestAsk(app, { question: '   ' })
    expect(response.status).toBe(400)
    const body = await response.json() as { error: { code: string; message: string } }
    expect(body.error.code).toBe('invalid_question')
    expect(typeof body.error.message).toBe('string')
    expect(body.error.message.length).toBeGreaterThan(0)
  })

  it('POST /api/ask () не-JSON тело → 400 без выброса исключения', async () => {
    const app = createApp(deps())
    const response = await app.request('/api/ask', { method: 'POST', body: 'не json' })
    expect(response.status).toBe(400)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('invalid_question')
  })

  it('index_missing → 422 и фраза-инструкция', async () => {
    const app = createApp(deps({ ask: async () => { throw new AppError('index_missing') } }))
    const response = await requestAsk(app, { question: 'q' })
    expect(response.status).toBe(422)
    const body = await response.json() as { error: { code: string; message: string } }
    expect(body.error.code).toBe('index_missing')
    expect(body.error.message).toContain('pnpm rag:index')
  })

  it('mcp_unavailable → 502', async () => {
    const app = createApp(deps({ ask: async () => { throw new AppError('mcp_unavailable') } }))
    const response = await requestAsk(app, { question: 'q' })
    expect(response.status).toBe(502)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('mcp_unavailable')
  })

  it('deepseek_key_missing → 503', async () => {
    const app = createApp(deps({ ask: async () => { throw new AppError('deepseek_key_missing') } }))
    const response = await requestAsk(app, { question: 'q' })
    expect(response.status).toBe(503)
    const body = await response.json() as { error: { code: string; message: string } }
    expect(body.error.code).toBe('deepseek_key_missing')
    expect(body.error.message).toContain('.env')
  })

  it('GET /api/health → 200 и тело HealthResponse', async () => {
    const { health } = deps()
    const app = createApp({ ask: deps().ask, health })
    const response = await app.request('/api/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(HEALTH)
    expect(health).toHaveBeenCalledTimes(1)
  })
})
