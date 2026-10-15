import { ensureLlmAvailable } from './llm.js'
import { resolveLlmConfig, type LlmProvider } from './llmConfig.js'
import { knowledgeIndexPresent } from './knowledge.js'
import type { HealthResponse } from '../src/types.js'

export interface HealthDeps {
  provider: () => LlmProvider
  llmReady: () => Promise<boolean>
  indexPresent: () => boolean
}

/**
 * GET /api/health: дешёвые проверки без боевых LLM-вызовов (plan.md):
 * deepseek — факт наличия ключа; ollama — пинг GET /api/tags.
 */
export async function buildHealth(deps: HealthDeps): Promise<HealthResponse> {
  const ready = await deps.llmReady()
  return {
    status: 'ok',
    llm: { provider: deps.provider(), ready },
    knowledge: { indexPresent: deps.indexPresent() },
  }
}

/** Живые зависимости health (provider из env, дешёвый ensure-чек, файл индекса). */
export function defaultHealthDeps(): HealthDeps {
  return {
    provider: () => resolveLlmConfig().provider,
    llmReady: async () => {
      try {
        await ensureLlmAvailable(resolveLlmConfig())
        return true
      }
      catch {
        return false
      }
    },
    indexPresent: knowledgeIndexPresent,
  }
}
