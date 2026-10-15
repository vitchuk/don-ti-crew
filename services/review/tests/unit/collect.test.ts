import { describe, expect, it } from 'vitest'
import {
  collectReviewData,
  isExcludedFile,
  validateChangedFilesPayload,
  validateDiffPayload,
  RefError,
  CollectError,
  DIFF_MAX_LINES,
  MAX_DIFF_CHARS,
  DIFF_TRUNCATION_MARK,
} from '../../src/collect'
import { stubSession, wrap, DIFF_OK, FILES_OK } from '../fixtures/stubSession'

describe('collectReviewData (мок MCP-сессии)', () => {
  it('git_diff получает base/head/maxLines=4000 (кап MCP), changed_files получает base/head', async () => {
    expect(DIFF_MAX_LINES).toBe(4000)
    const single = stubSession((name) => {
      if (name === 'git_diff') {
        return DIFF_OK
      }
      return FILES_OK
    })
    await collectReviewData(single, 'abc', 'def')
    expect(single.calls.map(call => call.name)).toEqual(['git_diff', 'changed_files'])
    expect(single.calls[0]?.args).toEqual({ base: 'abc', head: 'def', maxLines: 4000 })
    expect(single.calls[1]?.args).toEqual({ base: 'abc', head: 'def' })
  })

  it('lock-файлы и бинарные файлы отфильтрованы из списка', async () => {
    const session = stubSession((name) => {
      if (name === 'git_diff') {
        return DIFF_OK
      }
      return {
        files: [
          { file: 'apps/assistant/backend/a.ts', state: 'modified' },
          { file: 'pnpm-lock.yaml', state: 'modified' },
          { file: 'docs/pic/logo.png', state: 'added' },
          { file: 'services/review/dist/cli.js', state: 'deleted' },
          { file: 'infra/tls/ca.pem', state: 'modified' },
        ],
        truncated: false,
      }
    })
    const data = await collectReviewData(session, 'a', 'b')
    expect(data.files.map(file => file.file)).toEqual([
      'apps/assistant/backend/a.ts',
      'services/review/dist/cli.js',
      'infra/tls/ca.pem',
    ])
  })

  it('isError «недопустимая git-ссылка» → RefError', async () => {
    const session = stubSession(() => ({ error: 'недопустимая git-ссылка: zz' }))
    await expect(collectReviewData(session, 'zz', 'HEAD')).rejects.toThrow(RefError)
  })

  it('isError с другой ошибкой → CollectError', async () => {
    const session = stubSession(() => ({ error: 'ветки не имеют общих предков' }))
    await expect(collectReviewData(session, 'a', 'b')).rejects.toThrow(CollectError)
  })

  it('не-JSON payload → CollectError', async () => {
    const session = stubSession(() => ({ raw: { content: [{ type: 'text', text: 'oops' }] } }))
    await expect(collectReviewData(session, 'a', 'b')).rejects.toThrow('не-JSON')
  })
})

describe('бюджет диффа (M-1)', () => {
  it('дифф из 4000 строк проходит целиком до символьного капа', async () => {
    const lines: string[] = []
    for (let index = 0; index < 4000; index += 1) {
      lines.push(`+ line ${index}`)
    }
    const longDiff = `${lines.join('\n')}\n`
    const session = stubSession((name) => {
      if (name === 'git_diff') {
        return { diff: longDiff, totalLines: 4000, truncated: false }
      }
      return FILES_OK
    })
    const data = await collectReviewData(session, 'a', 'b')
    expect(session.calls[0]?.args['maxLines']).toBe(4000)
    expect(data.diff.diff).toBe(longDiff)
    expect(data.diff.totalLines).toBe(4000)
  })

  it('диф больше 150 КБ обрезан с пометкой, truncated и пост-усечением', async () => {
    const longDiff = 'x'.repeat(MAX_DIFF_CHARS + 1000)
    const session = stubSession((name) => {
      if (name === 'git_diff') {
        return { diff: longDiff, totalLines: 99999, truncated: true }
      }
      return FILES_OK
    })
    const data = await collectReviewData(session, 'a', 'b')
    expect(data.diff.diff.length).toBe(MAX_DIFF_CHARS + DIFF_TRUNCATION_MARK.length)
    expect(data.diff.diff).toContain('[diff усечён')
    expect(data.diff.truncated).toBe(true)
  })
})

describe('фильтрация hunks excluded-файлов (M-2)', () => {
  it('hunks lock-файла выкалываются, hunks обычного файла остаются, totalLines пересчитан', async () => {
    const goodFile = [
      'diff --git a/app/main.ts b/app/main.ts',
      'index 111111..222222 100644',
      '--- a/app/main.ts',
      '+++ b/app/main.ts',
      '@@ -1,2 +1,3 @@',
      ' existing',
      '+fresh',
    ].join('\n')
    const lockFile = [
      'diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml',
      'index 333333..444444 100644',
      '--- a/pnpm-lock.yaml',
      '+++ b/pnpm-lock.yaml',
      '@@ -10,2 +10,4 @@',
      '+helpers: 1.2.3',
      '+ersatz: 4.5.6',
    ].join('\n')
    const session = stubSession((name) => {
      if (name === 'git_diff') {
        return { diff: `${goodFile}\n${lockFile}`, totalLines: 14, truncated: false }
      }
      return FILES_OK
    })
    const data = await collectReviewData(session, 'a', 'b')
    expect(data.diff.diff).toBe(goodFile)
    expect(data.diff.diff).toContain('+fresh')
    expect(data.diff.diff).not.toContain('pnpm-lock.yaml')
    expect(data.diff.diff).not.toContain('helpers: 1.2.3')
    expect(data.diff.totalLines).toBe(goodFile.split('\n').length)
    expect(data.diff.truncated).toBe(false)
  })
})

describe('валидация payload', () => {
  it('validateDiffPayload отклоняет мусор', () => {
    expect(() => validateDiffPayload({ diff: 1, totalLines: 0, truncated: false })).toThrow('некорректный')
    expect(() => validateDiffPayload(wrap(DIFF_OK))).toThrow()
    expect(validateDiffPayload(DIFF_OK).totalLines).toBe(5)
  })

  it('validateChangedFilesPayload пропускает известные статусы и читает truncated', () => {
    const payload = validateChangedFilesPayload({
      files: [
        { file: 'a.ts', state: 'modified' },
        { file: 'b.ts', state: 'weird' },
        { file: 'c.ts', state: 'renamed' },
      ],
      truncated: true,
    })
    expect(payload.files).toEqual([
      { file: 'a.ts', state: 'modified' },
      { file: 'c.ts', state: 'renamed' },
    ])
    expect(payload.truncated).toBe(true)
    expect(validateChangedFilesPayload({ files: [] }).truncated).toBe(false)
  })

  it('filesTruncated приходит из changed_files (cap 200)', async () => {
    const session = stubSession((name) => {
      if (name === 'git_diff') {
        return DIFF_OK
      }
      return { files: [{ file: 'a.ts', state: 'modified' }], truncated: true }
    })
    const data = await collectReviewData(session, 'a', 'b')
    expect(data.filesTruncated).toBe(true)
  })

  it('validateChangedFilesPayload отклоняет мусор', () => {
    expect(() => validateChangedFilesPayload({ files: 'nope' })).toThrow('некорректный')
  })
})

describe('isExcludedFile', () => {
  it('locks и бинарные исключены', () => {
    expect(isExcludedFile('pnpm-lock.yaml')).toBe(true)
    expect(isExcludedFile('packages/x/yarn.lock')).toBe(true)
    expect(isExcludedFile('docs/img/logo.PNG')).toBe(true)
    expect(isExcludedFile('a/SQLite.db')).toBe(true)
    expect(isExcludedFile('src/llm.ts')).toBe(false)
    expect(isExcludedFile('README.md')).toBe(false)
    expect(isExcludedFile('noext')).toBe(false)
  })
})
