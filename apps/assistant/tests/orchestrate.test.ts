import { describe, expect, it, vi } from 'vitest'
import { createOrchestrator, type OrchestrationDeps } from '../backend/orchestrate'
import { AppError } from '../backend/errors'
import type { LlmMessage } from '../backend/llm'
import type { McpContextResult } from '../backend/mcpClient'
import type { GitContext } from '../src/types'

const CONTEXT: McpContextResult = {
  branch: 'session-42',
  clean: false,
  changedFiles: [
    { file: 'apps/assistant/src/App.vue', state: 'modified' },
    { file: 'docs/adr/0006-new.md', state: 'untracked' },
    { file: 'pnpm-lock.yaml', state: 'modified' },
  ],
}
const FRAGMENTS = [1, 2, 3, 4].map(index => ({
  file: `specs/000${index}-x/spec.md`,
  heading: `Заголовок ${index}`,
  excerpt: `отрывок ${index}`,
  score: 0.9 - index / 100,
}))

function makeDeps(question?: { recordedMessages?: LlmMessage[][] }): OrchestrationDeps {
  return {
    ensureLlm: vi.fn(async () => undefined),
    checkIndex: vi.fn(() => undefined),
    mcp: {
      getContext: vi.fn(async () => CONTEXT),
      gitDiff: vi.fn(async () => ({ diff: 'diff --git a/a b/a', totalLines: 2, truncated: false })),
    },
    query: vi.fn(async () => ({ results: FRAGMENTS, total: FRAGMENTS.length })),
    llm: vi.fn(async (messages: LlmMessage[]) => {
      question?.recordedMessages?.push(messages)
      return 'Ответ помощника.'
    }),
  }
}

describe('orchestrate — интеграция на фейках (T-7)', () => {
  it('happy path: MCP k=4 query, вопрос и отрывки в промпте, цитаты = все 4 фрагмента, context passthrough', async () => {
    const deps = makeDeps()
    const result = await createOrchestrator(deps)('как работает таймер?')

    expect(deps.mcp.getContext).toHaveBeenCalledTimes(1)
    expect(deps.mcp.gitDiff).not.toHaveBeenCalled()
    expect(deps.query).toHaveBeenCalledWith('как работает таймер?')
    expect(deps.llm).toHaveBeenCalledTimes(1)

    expect(result.answer).toBe('Ответ помощника.')
    expect(result.context).toEqual<GitContext>({
      branch: 'session-42',
      clean: false,
      changedFilesCount: 3,
    })
    expect(result.citations).toHaveLength(4)
    expect(result.citations[0]).toEqual({ file: 'specs/0001-x/spec.md', heading: 'Заголовок 1' })
    const call = vi.mocked(deps.llm).mock.calls[0]?.[0] ?? []
    const user = call[1]?.content ?? ''
    expect(user).toContain('как работает таймер?')
    expect(user).toContain('отрывок 1')
    expect(user).toContain('[Фрагменты знаний]')
  })

  it('вопрос об изменениях → git_diff(maxLines=200) вызван и попал в промпт (FR-9, AC-3)', async () => {
    const deps = makeDeps()
    await createOrchestrator(deps)('что изменилось в этой ветке?')
    expect(deps.mcp.gitDiff).toHaveBeenCalledWith(200)
    const user = vi.mocked(deps.llm).mock.calls[0]?.[0]?.[1]?.content ?? ''
    expect(user).toContain('[Diff (до 200 строк)]')
    expect(user).toContain('diff --git a/a b/a')
  })

  it('проверки окружения идут до MCP: ensureLlm и checkIndex первыми (plan.md)', async () => {
    const order: string[] = []
    const deps = makeDeps()
    deps.ensureLlm = vi.fn(async () => {
      order.push('ensureLlm')
    })
    deps.checkIndex = vi.fn(() => {
      order.push('checkIndex')
    })
    deps.mcp.getContext = vi.fn(async () => {
      order.push('get_context')
      return CONTEXT
    })
    await createOrchestrator(deps)('q')
    expect(order).toEqual(['ensureLlm', 'checkIndex', 'get_context'])
  })

  it('отсутствие индекса → AppError index_missing, MCP и LLM не вызываются (AC-6)', async () => {
    const deps = makeDeps()
    deps.checkIndex = vi.fn(() => {
      throw new AppError('index_missing')
    })
    await expect(createOrchestrator(deps)('как работает таймер?'))
      .rejects.toMatchObject({ code: 'index_missing', status: 422 })
    expect(deps.ensureLlm).toHaveBeenCalledTimes(1)
    expect(deps.mcp.getContext).not.toHaveBeenCalled()
    expect(deps.llm).not.toHaveBeenCalled()
  })

  it('MCP недоступен → mcp_unavailable, LLM не вызывается', async () => {
    const deps = makeDeps()
    deps.mcp.getContext = vi.fn(async () => {
      throw new AppError('mcp_unavailable')
    })
    await expect(createOrchestrator(deps)('q'))
      .rejects.toMatchObject({ code: 'mcp_unavailable' })
    expect(deps.query).not.toHaveBeenCalled()
    expect(deps.llm).not.toHaveBeenCalled()
  })

  it('ensureLlm (нет ключа) → 503 deepseek_key_missing до MCP и знаний', async () => {
    const deps = makeDeps()
    deps.ensureLlm = vi.fn(async () => {
      throw new AppError('deepseek_key_missing')
    })
    await expect(createOrchestrator(deps)('q'))
      .rejects.toMatchObject({ code: 'deepseek_key_missing', status: 503 })
    expect(deps.mcp.getContext).not.toHaveBeenCalled()
    expect(deps.checkIndex).not.toHaveBeenCalled()
  })
})

