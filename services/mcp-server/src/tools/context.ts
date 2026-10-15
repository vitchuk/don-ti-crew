import {
  getCurrentBranch,
  getLastCommit,
  gitStatus,
  type GitStatusResult,
  type LastCommit,
} from '../adapters/git.js'

export interface ContextResult {
  branch: string
  clean: boolean
  changedFiles: GitStatusResult['changes']
  lastCommit: LastCommit | null
  truncated: boolean
}

export async function getContext(cwd = process.cwd()): Promise<ContextResult> {
  const [branch, status, lastCommit] = await Promise.all([
    getCurrentBranch(cwd),
    gitStatus(cwd),
    getLastCommit(cwd),
  ])
  return {
    branch: branch.branch,
    clean: status.clean,
    changedFiles: status.changes,
    lastCommit,
    truncated: status.truncated,
  }
}
