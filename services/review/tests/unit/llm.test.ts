import { describe, expect, it } from 'vitest'
import {
  askDeepSeek,
  DEEPSEEK_BASE_URL,
  DEEPSEEK_MODEL,
  LlmError,
  resolveLlmConfig,
  type FetchLike,
  type LlmMessage,
} from '../../src/llm'
import { jsonResponse, okCompletion } from '../fixtures/stubSession'

const MESSAGES: LlmMessage[] = [
  { role: 'system', content: 'правила' },
  { role: 'user', content: 'диф' },
]
const CONFIG = { baseUrl: DEEPSEEK_BASE_URL, model: DEEPSEEK_MODEL, apiKey: 'sk-test' }
const OPTIONS = { timeoutMs: 2000 }

describe('askDeepSeek (mock fetch)', () => {
  it('200 → content из choices[0]; URL и заголовок по контракту', async () => {
    const seen: string[] = []
    const fetchImpl: FetchLike = (url, init) => {
      seen.push(`${url} ${(init?.headers as Record<string, string>)?.authorization ?? ''} ${init?.body as string}`)
      return Promise.resolve(okCompletion('Находок нет'))
    }
    const answer = await askDeepSeek(MESSAGES, CONFIG, fetchImpl, OPTIONS)
    expect(answer).toBe('Находок нет')
    expect(seen[0]).toContain('https://api.deepseek.com/chat/completions')
    expect(seen[0]).toContain('Bearer sk-test')
    expect(seen[0]).toContain('"deepseek-chat"')
  })

  it('4xx → LlmError без retry', async () => {
    let calls = 0
    const fetchImpl: FetchLike = () => {
      calls += 1
      return Promise.resolve(jsonResponse(401, { error: {} }))
    }
    await expect(askDeepSeek(MESSAGES, CONFIG, fetchImpl, OPTIONS))
      .rejects.toMatchObject({ name: 'LlmError', retryable: false })
    expect(calls).toBe(1)
  })

  it('5xx → один retry, второй ответ успешен', async () => {
    let calls = 0
    const fetchImpl: FetchLike = () => {
      calls += 1
      return Promise.resolve(calls === 1 ? jsonResponse(500, {}) : okCompletion('answer'))
    }
    await expect(askDeepSeek(MESSAGES, CONFIG, fetchImpl, OPTIONS)).resolves.toBe('answer')
    expect(calls).toBe(2)
  })

  it('402 (оплата) → retryable: retry, второй ответ успешен', async () => {
    let calls = 0
    const fetchImpl: FetchLike = () => {
      calls += 1
      return Promise.resolve(calls === 1 ? jsonResponse(402, {}) : okCompletion('answer'))
    }
    await expect(askDeepSeek(MESSAGES, CONFIG, fetchImpl, OPTIONS)).resolves.toBe('answer')
    expect(calls).toBe(2)
  })

  it('429 (лимиты) дважды → LlmError с текстом о лимитах/оплате, ровно 2 попытки', async () => {
    let calls = 0
    const fetchImpl: FetchLike = () => {
      calls += 1
      return Promise.resolve(jsonResponse(429, {}))
    }
    await expect(askDeepSeek(MESSAGES, CONFIG, fetchImpl, OPTIONS))
      .rejects.toMatchObject({
        name: 'LlmError',
        retryable: true,
        message: 'DeepSeek вернул ошибку лимитов/оплаты — проверьте баланс и лимиты.',
      })
    expect(calls).toBe(2)
  })

  it('5xx дважды → LlmError ровно после двух попыток', async () => {
    let calls = 0
    const fetchImpl: FetchLike = () => {
      calls += 1
      return Promise.resolve(jsonResponse(503, {}))
    }
    await expect(askDeepSeek(MESSAGES, CONFIG, fetchImpl, OPTIONS)).rejects.toThrow('HTTP 503')
    expect(calls).toBe(2)
  })

  it('сетевой сбой → retry один, затем LlmError', async () => {
    let calls = 0
    const fetchImpl: FetchLike = () => {
      calls += 1
      return Promise.reject(new TypeError('ECONNREFUSED'))
    }
    await expect(askDeepSeek(MESSAGES, CONFIG, fetchImpl, OPTIONS)).rejects.toThrow('недоступна')
    expect(calls).toBe(2)
  })

  it('пустой контент → retry, затем LlmError', async () => {
    let calls = 0
    const fetchImpl: FetchLike = () => {
      calls += 1
      return Promise.resolve(okCompletion('   '))
    }
    await expect(askDeepSeek(MESSAGES, CONFIG, fetchImpl, OPTIONS)).rejects.toThrow('пустой ответ')
    expect(calls).toBe(2)
  })

  it('некорректный JSON → LlmError', async () => {
    let calls = 0
    const fetchImpl: FetchLike = () => {
      calls += 1
      return Promise.resolve(new Response('<<no-json>>', { status: 200 }))
    }
    await expect(askDeepSeek(MESSAGES, CONFIG, fetchImpl, OPTIONS)).rejects.toThrow('JSON')
    expect(calls).toBe(2)
  })

  it('таймаут (AbortError от сигнала) → retry и LlmError с текстом о таймауте', async () => {
    let calls = 0
    const fetchImpl: FetchLike = (_url, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      if (signal === undefined) {
        return
      }
      signal.addEventListener('abort', () => {
        calls += 1
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      })
    })
    await expect(askDeepSeek(MESSAGES, CONFIG, fetchImpl, { timeoutMs: 20 }))
      .rejects.toThrow('не ответила')
    expect(calls).toBe(2)
  })
})

describe('resolveLlmConfig', () => {
  it('ключ отсутствует → LlmError с подсказкой', () => {
    expect(() => resolveLlmConfig({})).toThrow('DEEPSEEK_API_KEY')
  })

  it('ключ задан → конфигурация по умолчанию', () => {
    const config = resolveLlmConfig({ DEEPSEEK_API_KEY: 'sk-abc' })
    expect(config.baseUrl).toBe('https://api.deepseek.com')
    expect(config.model).toBe('deepseek-chat')
    expect(config.apiKey).toBe('sk-abc')
  })

  it('attempts=1 — retry выключен: один сбой → сразу бросок', async () => {
    let calls = 0
    const fetchImpl: FetchLike = () => {
      calls += 1
      return Promise.resolve(jsonResponse(500, {}))
    }
    await expect(askDeepSeek(MESSAGES, CONFIG, fetchImpl, { attempts: 1, timeoutMs: 1000 })).rejects.toThrow(LlmError)
    expect(calls).toBe(1)
  })
})
