import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createOllamaEmbedder,
  FakeEmbedder,
  EMBED_MODEL,
  EMBED_BATCH_SIZE,
  FAKE_EMBEDDER_DIMENSION,
} from '../../src/embeddings.js'
import { KnowledgeError, ERROR_MESSAGES } from '../../src/errors.js'

interface FetchCall {
  url: string
  method: string
  body: unknown
}

function stubFetch(responder: (call: FetchCall, index: number) => Response | Promise<Response>): { calls: FetchCall[] } {
  const calls: FetchCall[] = []
  let count = 0
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const index = count
    count += 1
    const call: FetchCall = {
      url,
      method: init.method ?? 'GET',
      body: JSON.parse(String(init.body ?? '')) as unknown,
    }
    calls.push(call)
    return await responder(call, index)
  })
  return { calls }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('FakeEmbedder', () => {
  it('produces deterministic unit vectors from sha256 (dim 8 default)', async () => {
    const embedder = new FakeEmbedder()
    const [first] = await embedder.embed(['раунд цикл'])
    const [second] = await embedder.embed(['раунд цикл'])
    expect(first).toHaveLength(FAKE_EMBEDDER_DIMENSION)
    expect(first).toEqual(second)
    const norm = Math.sqrt((first ?? []).reduce((sum, v) => sum + v * v, 0))
    expect(norm).toBeCloseTo(1, 6)
    expect(embedder.calls).toBe(2)
  })

  it('texts sharing words get similar vectors', async () => {
    const embedder = new FakeEmbedder()
    const first = await embedder.embed(['циклы и раунды'])
    const second = await embedder.embed(['раунды и циклы зашедшие повторно'])
    const distance = (a: number[], b: number[]): number => Math.sqrt(a.reduce((sum, v, i) => sum + (v - (b[i] ?? 0)) ** 2, 0))
    const [f] = first
    const [s] = second
    expect(f !== undefined && s !== undefined ? distance(f, s) : 1).toBeLessThan(Math.SQRT2)
  })

  it('supports a custom dimension', async () => {
    const embedder = new FakeEmbedder(4)
    const [vector] = await embedder.embed(['раз tien text'])
    expect(vector).toHaveLength(4)
    expect(vector).toEqual(await embedder.embed(['раз tien text']).then(([v]) => v))
  })
})

describe('createOllamaEmbedder', () => {
  it('sends batched POST /api/embed with model and input; returns embeddings of the response dimension', async () => {
    const { calls } = stubFetch((call, index) => {
      const input = (call.body as { input: string[] }).input
      return Response.json({ embeddings: input.map((text: string) => [text.length, 1, -1, 0]) })
    })
    const embedder = createOllamaEmbedder({ baseUrl: 'http://127.0.0.1:11434', batchSize: 2 })
    const vectors = await embedder.embed(['short', 'a much longer text body', 'x', 'y', 'z'])
    expect(calls.map(c => c.url)).toEqual([
      'http://127.0.0.1:11434/api/embed',
      'http://127.0.0.1:11434/api/embed',
      'http://127.0.0.1:11434/api/embed',
    ])
    expect(calls[0]).toEqual({ url: 'http://127.0.0.1:11434/api/embed', method: 'POST', body: { model: EMBED_MODEL, input: ['short', 'a much longer text body'] } })
    expect(calls[2]?.body).toEqual({ model: EMBED_MODEL, input: ['z'] })
    expect(vectors.map(v => v[0])).toEqual([5, 23, 1, 1, 1])
    expect(vectors[0]).toHaveLength(4)
  })

  it('EMBED_BATCH_SIZE is 32', () => {
    expect(EMBED_BATCH_SIZE).toBe(32)
  })

  it('uses OLLAMA_BASE_URL env when set', async () => {
    vi.stubEnv('OLLAMA_BASE_URL', 'http://collector:9999/')
    const { calls } = stubFetch(() => Response.json({ embeddings: [] }))
    const embedder = createOllamaEmbedder()
    await expect(embedder.embed(['x'])).rejects.toThrowError()
    expect(calls[0]?.url).toBe('http://collector:9999/api/embed')
  })

  it('connection refused → OLLAMA_UNAVAILABLE with the canonical one-sentence text', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    const embedder = createOllamaEmbedder()
    const error = await embedder.embed(['x']).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(KnowledgeError)
    expect((error as KnowledgeError).code).toBe('OLLAMA_UNAVAILABLE')
    expect((error as KnowledgeError).message).toBe(ERROR_MESSAGES.OLLAMA_UNAVAILABLE)
  })

  it('404 / «not found» → MODEL_NOT_FOUND with «ollama pull qwen3-embedding»', async () => {
    stubFetch(() => new Response(JSON.stringify({ error: `model "${EMBED_MODEL}" not found` }), { status: 404 }))
    const embedder = createOllamaEmbedder()
    const error = await embedder.embed(['x']).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(KnowledgeError)
    expect((error as KnowledgeError).code).toBe('MODEL_NOT_FOUND')
    expect((error as KnowledgeError).message).toBe(ERROR_MESSAGES.MODEL_NOT_FOUND)
    expect((error as KnowledgeError).message).toContain('ollama pull qwen3-embedding')
  })

  it('other HTTP failures → EMBED_FAILED', async () => {
    stubFetch(() => new Response('internal error', { status: 500 }))
    const embedder = createOllamaEmbedder()
    const error = await embedder.embed(['x']).catch((e: unknown) => e)
    expect((error as KnowledgeError).code).toBe('EMBED_FAILED')
  })

  it('broken response shape → EMBED_FAILED', async () => {
    stubFetch(() => Response.json({ embeddings: [[1, 0]] }))
    const embedder = createOllamaEmbedder()
    const error = await embedder.embed(['x', 'y']).catch((e: unknown) => e)
    expect((error as KnowledgeError).code).toBe('EMBED_FAILED')
  })
})
