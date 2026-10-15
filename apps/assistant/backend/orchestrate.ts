import { wantsDiff } from './changeDetector.js'
import { buildPrompt, DIFF_MAX_LINES, type PromptDiff } from './prompt.js'
import type { KnowledgeQuery } from './knowledge.js'
import type { LlmCall } from './llm.js'
import type { McpContextResult, McpDiffResult } from './mcpClient.js'
import type { AskAnswer, GitContext } from '../src/types.js'

/**
 * Пайплайн одного вопроса (plan.md): валидация сделана раньше; здесь —
 * ensureLlm → индекс знаний → MCP → knowledge.query → промпт → LLM.
 * LLM-вызов всегда последний; при отсутствии индекса или недоступности MCP
 * он не выполняется (AC-6).
 */
export interface OrchestrationDeps {
  ensureLlm: () => Promise<void>
  checkIndex: () => void
  mcp: {
    getContext(): Promise<McpContextResult>
    gitDiff(maxLines: number): Promise<McpDiffResult>
  }
  query: KnowledgeQuery
  llm: LlmCall
}

export type Orchestrator = (question: string) => Promise<AskAnswer>

export function createOrchestrator(deps: OrchestrationDeps): Orchestrator {
  return async (question) => {
    await deps.ensureLlm()
    deps.checkIndex()

    const mcpContext = await deps.mcp.getContext()
    const diff: PromptDiff | null = wantsDiff(question) ? await deps.mcp.gitDiff(DIFF_MAX_LINES) : null

    const searchResponse = await deps.query(question)

    const context: GitContext = {
      branch: mcpContext.branch,
      clean: mcpContext.clean,
      changedFilesCount: mcpContext.changedFiles.length,
    }
    const built = buildPrompt({
      question,
      context,
      diff,
      fragments: searchResponse.results.map(hit => ({
        file: hit.file,
        ...(hit.heading !== undefined ? { heading: hit.heading } : {}),
        excerpt: hit.excerpt,
      })),
    })
    const answer = await deps.llm(built.messages)

    return {
      answer,
      citations: built.citations,
      context: built.context,
    }
  }
}
