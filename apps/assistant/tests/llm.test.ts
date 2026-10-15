import { describe, expect, it } from 'vitest'
import { createLlm, ensureLlmAvailable, type LlmMessage } from '../backend/llm'
import { AppError } from '../backend/errors'
import type { FetchLike } from '../backend/llm'
import type { LlmConfig } from '../backend/llmConfig'

const MESSAGES: LlmMessage[] = [{ role: 'user', content: 'привет' }]

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function okContent(content: string): Response {
  return jsonResponse(200, { choices: [{ message: { role: 'assistant', content } }] })
}

/** fetch-заглушка: configurable errors per url. */
function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): FetchLike {
  return (url, init) => Promise.resolve(handler(url, init)).then(res => res as Response)
}

const DEEPSEEK: LlmConfig = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  apiKey: 'sk-test',
}
const OLLAMA: LlmConfig = {
  provider: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  model: 'qwen3:1.7b',
}

describe('llm client (T-6, mock fetch)', () => {
  it('200 → текст из choices[0].message.content', async () => {
    const seen: string[] = []
    const call = createLlm(DEEPSEEK, fakeFetch((url, init) => {
      seen.push(`${url} ${(init?.headers as Record<string, string>)?.authorization ?? ''}`)
      return okContent('Ответ')
    }))
    expect(await call(MESSAGES)).toBe('Ответ')
    expect(seen[0]).toBe('https://api.deepseek.com/chat/completions Bearer sk-test')
  })

  it('deepseek без ключа → 503 deepseek_key_missing, fetch не вызывается', async () => {
    let called = false
    const call = createLlm({ ...DEEPSEEK, apiKey: undefined }, () => {
      called = true
      throw new Error('network')
    })
    await expect(call(MESSAGES)).rejects.toMatchObject({ code: 'deepseek_key_missing', status: 503 })
    expect(called).toBe(false)
  })

  it('deepseek 401 → deepseek_key_missing', async () => {
    const call = createLlm(DEEPSEEK, fakeFetch(() => jsonResponse(401, { error: {} })))
    await expect(call(MESSAGES)).rejects.toMatchObject({ code: 'deepseek_key_missing' })
  })

  it('5xx → 500 llm_error', async () => {
    const call = createLlm(DEEPSEEK, fakeFetch(() => jsonResponse(500, {})))
    await expect(call(MESSAGES)).rejects.toMatchObject({ code: 'llm_error', status: 500 })
  })

  it('сбой fetch-сети для ollama → 503 ollama_unavailable', async () => {
    const call = createLlm(OLLAMA, () => Promise.reject(new TypeError('ECONNREFUSED')))
    await expect(call(MESSAGES)).rejects.toMatchObject({ code: 'ollama_unavailable', status: 503 })
  })

  it('сбой fetch-сети для deepseek → 500 llm_error (внешний API)', async () => {
    const call = createLlm(DEEPSEEK, () => Promise.reject(new TypeError('DNS lookup failed')))
    await expect(call(MESSAGES)).rejects.toMatchObject({ code: 'llm_error' })
  })

  it('пустой ответ LLM → llm_error', async () => {
    const call = createLlm(DEEPSEEK, fakeFetch(() => okContent('   ')))
    await expect(call(MESSAGES)).rejects.toMatchObject({ code: 'llm_error' })
  })

  it('таймаут (AbortError) → llm_error', async () => {
    const call = createLlm(DEEPSEEK, () => Promise.reject(new DOMException('The operation was aborted.', 'AbortError')))
    await expect(call(MESSAGES)).rejects.toMatchObject({ code: 'llm_error' })
  })
})

describe('ensureLlmAvailable (дешёвые проверки до боевого вызова)', () => {
  it('deepseek: ключ есть → ок', async () => {
    await expect(ensureLlmAvailable(DEEPSEEK)).resolves.toBeUndefined()
  })

  it('deepseek: ключа нет → deepseek_key_missing', async () => {
    await expect(ensureLlmAvailable({ ...DEEPSEEK, apiKey: undefined }))
      .rejects.toMatchObject({ code: 'deepseek_key_missing' })
  })

  it('ollama: ping /api/tags ок → ок', async () => {
    const call = ensureLlmAvailable(OLLAMA, fakeFetch(url => {
      return new Response('{}', { status: url === 'http://localhost:11434/api/tags' ? 200 : 404 })
    }))
    await expect(call).resolves.toBeUndefined()
  })

  it('ollama: ping не отвечает → ollama_unavailable', async () => {
    const call = ensureLlmAvailable(OLLAMA, () => Promise.reject(new TypeError('refused')))
    await expect(call).rejects.toMatchObject({ code: 'ollama_unavailable' })
  })

  it('ollama: ping 500 → ollama_unavailable', async () => {
    const call = ensureLlmAvailable(OLLAMA, fakeFetch(() => new Response('boom', { status: 500 })))
    await expect(call).rejects.toMatchObject({ code: 'ollama_unavailable' })
  })
})

