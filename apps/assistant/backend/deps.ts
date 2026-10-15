import { createLlm, ensureLlmAvailable } from './llm.js'
import { checkIndex, createKnowledgeQuery } from './knowledge.js'
import { resolveLlmConfig } from './llmConfig.js'
import { McpGateway } from './mcpClient.js'
import { createOrchestrator, type OrchestrationDeps } from './orchestrate.js'
import type { BackendDeps } from './app.js'
import { buildHealth, defaultHealthDeps, type HealthDeps } from './health.js'
import type { AskAnswer, HealthResponse } from '../src/types.js'

/**
 * Поводок по умолчанию: живые зависимости по plan.md (STDIO MCP-шлюз,
 * прямой knowledge.query, LLM по ASSISTANT_LLM). Создаётся при старте app.
 */
export interface DefaultOrchestrationDeps extends OrchestrationDeps {
  mcp: McpGateway
}

export function defaultOrchestrationDeps(): DefaultOrchestrationDeps {
  const mcp = new McpGateway()
  return {
    ensureLlm: () => ensureLlmAvailable(resolveLlmConfig()),
    checkIndex,
    mcp,
    query: createKnowledgeQuery(),
    llm: (messages) => createLlm(resolveLlmConfig())(messages),
  }
}

export function defaultAsk(orchestration: OrchestrationDeps = defaultOrchestrationDeps()): (question: string) => Promise<AskAnswer> {
  return createOrchestrator(orchestration)
}

export function defaultHealth(healthDeps: HealthDeps = defaultHealthDeps()): () => Promise<HealthResponse> {
  return () => buildHealth(healthDeps)
}

export function buildDefaultBackendDeps(orchestration: OrchestrationDeps = defaultOrchestrationDeps()): BackendDeps {
  return {
    ask: defaultAsk(orchestration),
    health: defaultHealth(),
  }
}
