import { createHash } from 'node:crypto'
import process from 'node:process'
import type { Embedder } from './types.js'
import {
  EMBED_FAILED_MESSAGE,
  MODEL_NOT_FOUND_MESSAGE,
  OLLAMA_UNAVAILABLE_MESSAGE,
  KnowledgeError,
} from './errors.js'

export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434'
export const EMBED_MODEL = 'qwen3-embedding'
export const EMBED_BATCH_SIZE = 32
export const FAKE_EMBEDDER_DIMENSION = 8

export class FakeEmbedder implements Embedder {
  readonly dim: number
  calls: number
  texts: string[]

  constructor(dim: number = FAKE_EMBEDDER_DIMENSION) {
    this.dim = dim
    this.calls = 0
    this.texts = []
  }

  async embed(texts: string[]): Promise<number[][]> {
    this.calls += 1
    this.texts.push(...texts)
    return texts.map(text => fakeVector(text, this.dim))
  }
}

export function fakeVector(text: string, dim: number): number[] {
  const words = text.toLowerCase().match(/[a-zа-яё0-9]+/g) ?? []
  const base = new Array<number>(FAKE_EMBEDDER_DIMENSION).fill(0)
  if (words.length > 0) {
    cacheWordVectors(words)
    for (const word of words) {
      const seed = wordSeed(word)
      for (let i = 0; i < FAKE_EMBEDDER_DIMENSION; i += 1) {
        base[i] = (base[i] ?? 0) + (seed[i] ?? 0)
      }
    }
  }
  else {
    const seed = wordSeed(text)
    for (let i = 0; i < FAKE_EMBEDDER_DIMENSION; i += 1) {
      base[i] = seed[i] ?? 0
    }
  }
  const norm = Math.sqrt(base.reduce((sum, value) => sum + value * value, 0))
  const unit = norm === 0 ? base : base.map(value => value / norm)
  return unit.slice(0, dim)
}

const wordCache = new Map<string, number[]>()

function cacheWordVectors(words: string[]): void {
  for (const word of words) {
    if (!wordCache.has(word) && wordCache.size < 10_000) {
      wordCache.set(word, wordSeed(word))
    }
  }
}

function wordSeed(text: string): number[] {
  const digest = createHash('sha256').update(text, 'utf8').digest()
  const vector = new Array<number>(FAKE_EMBEDDER_DIMENSION).fill(0)
  const slot = (digest[0] ?? 0) % FAKE_EMBEDDER_DIMENSION
  const sign = (digest[1] ?? 0) % 2 === 0 ? 1 : -1
  vector[slot] = sign
  return vector
}

export interface OllamaEmbedderOptions {
  baseUrl?: string
  model?: string
  batchSize?: number
}

export interface OllamaEmbedResponse {
  embeddings?: number[][]
  error?: string
}

export function createOllamaEmbedder(options: OllamaEmbedderOptions = {}): Embedder {
  const baseUrl = (options.baseUrl ?? process.env['OLLAMA_BASE_URL'] ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, '')
  const model = options.model ?? EMBED_MODEL
  const batchSize = Math.max(1, options.batchSize ?? EMBED_BATCH_SIZE)
  return {
    async embed(texts: string[]): Promise<number[][]> {
      const all: number[][] = []
      for (let index = 0; index < texts.length; index += batchSize) {
        const batch = texts.slice(index, index + batchSize)
        const embeddings = await requestEmbeddings(baseUrl, model, batch)
        for (const values of embeddings) {
          all.push(values)
        }
      }
      return all
    },
  }
}

async function requestEmbeddings(baseUrl: string, model: string, batch: string[]): Promise<number[][]> {
  let response: Response
  try {
    response = await fetch(`${baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, input: batch }),
    })
  }
  catch {
    throw new KnowledgeError('OLLAMA_UNAVAILABLE', OLLAMA_UNAVAILABLE_MESSAGE)
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    if (response.status === 404 || /not found/i.test(body)) {
      throw new KnowledgeError('MODEL_NOT_FOUND', MODEL_NOT_FOUND_MESSAGE)
    }
    throw new KnowledgeError('EMBED_FAILED', EMBED_FAILED_MESSAGE)
  }
  const data = await response.json() as OllamaEmbedResponse
  const embeddings = data.embeddings
  if (
    !Array.isArray(embeddings)
    || embeddings.length !== batch.length
    || !embeddings.every(row => Array.isArray(row) && row.length > 0 && row.every(value => typeof value === 'number' && Number.isFinite(value)))
  ) {
    throw new KnowledgeError('EMBED_FAILED', EMBED_FAILED_MESSAGE)
  }
  return embeddings
}
