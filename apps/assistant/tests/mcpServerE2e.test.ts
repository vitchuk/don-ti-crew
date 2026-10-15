import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mcpServerPath, repoRoot, knowledgeDbPath } from '../backend/paths'
import { McpGateway, createStdioConnector, DEFAULT_DIFF_MAX_LINES } from '../backend/mcpClient'

/**
 * e2e c реальным mcp-server (T-4 ручной smoke заменён автоматическим):
 * активен только если dist собран (`pnpm --filter @don-ti/mcp-server build`),
 * иначе пропускается, чтобы `pnpm assistant test` оставался зелёным.
 */
const script = mcpServerPath()
const canRun = existsSync(script) && existsSync(repoRoot()) // spawn-гвард

describe.skipIf(!canRun)('e2e: реальный mcp-server (stdio, контракты спеки 002)', () => {
  it('get_context возвращает ветку, clean и changedFiles', async () => {
    const gateway = new McpGateway({ connector: createStdioConnector() })
    try {
      const context = await gateway.getContext()
      expect(typeof context.branch).toBe('string')
      expect(context.branch.length).toBeGreaterThan(0)
      expect(typeof context.clean).toBe('boolean')
      expect(Array.isArray(context.changedFiles)).toBe(true)
    }
    finally {
      await gateway.close()
    }
  }, 20_000)

  it('git_diff(maxLines=200) возвращает контракт { diff, totalLines, truncated }', async () => {
    const gateway = new McpGateway({ connector: createStdioConnector() })
    try {
      const diff = await gateway.gitDiff(DEFAULT_DIFF_MAX_LINES)
      expect(typeof diff.diff).toBe('string')
      expect(typeof diff.totalLines).toBe('number')
      expect(typeof diff.truncated).toBe('boolean')
    }
    finally {
      await gateway.close()
    }
  }, 20_000)
})
