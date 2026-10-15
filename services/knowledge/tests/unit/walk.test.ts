import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { collectFiles, classifyFile } from '../../src/walk.js'
import { buildRepo, type TmpRepo } from '../helpers/testRepo.js'

let repo: TmpRepo

beforeEach(() => {
  repo = buildRepo()
})

afterEach(() => {
  repo.dispose()
})

describe('collectFiles', () => {
  it('FR-3: collects exactly the spec sources with FR-5 types', async () => {
    const files = await collectFiles(repo.dir)
    const map = new Map(files.map(file => [file.filePath, file.fileType]))
    expect(map.get('README.md')).toBe('readme')
    expect(map.get('GLOSSARY.md')).toBe('docs')
    expect(map.get('AGENTS.md')).toBe('docs')
    expect(map.get('package.json')).toBe('config')
    expect(map.get('config.yml')).toBe('config')
    expect(map.get('config.toml')).toBe('config')
    expect(map.get('deploy.yaml')).toBe('config')
    expect(map.get('docs/guide.md')).toBe('docs')
    expect(map.get('docs/adr/0005-x.md')).toBe('adr')
    expect(map.get('specs/003/spec.md')).toBe('specs')
    expect(map.get('apps/timer/src/main.ts')).toBe('code')
    expect(map.get('apps/timer/src/pages/App.vue')).toBe('code')
    expect(map.get('services/marker/src/core.ts')).toBe('code')
  })

  it('FR-4: excluded dirs and gitignore rules are skipped', async () => {
    repo.write('node_modules/vendor/extra.js', 'x')
    repo.write('apps/timer/dist/out.js', 'x')
    repo.write('services/marker/.data/stash.ts', 'x')
    const files = await collectFiles(repo.dir)
    const paths = files.map(file => file.filePath)
    expect(paths).not.toContain('node_modules/pkg/index.js')
    expect(paths).not.toContain('apps/timer/dist/out.js')
    expect(paths).not.toContain('services/marker/.data/stash.ts')
    expect(paths).not.toContain('ignored-dir/skip.md')
    expect(paths).not.toContain('excluded.txt')
    expect(paths.every(path => !path.includes('node_modules') && !path.includes('dist') && !path.includes('.data'))).toBe(true)
  })

  it('NFR-5: paths are POSIX-relative and sorted', async () => {
    repo.write('docs/nested/sub/deep.md', 'deep')
    const files = await collectFiles(repo.dir)
    const paths = files.map(file => file.filePath)
    expect(paths.every(path => !path.includes('\\'))).toBe(true)
    expect([...paths].sort((a, b) => a.localeCompare(b))).toEqual(paths)
    expect(paths).toContain('docs/nested/sub/deep.md')
  })

  it('non-listed files are not collected', async () => {
    repo.write('style.css', 'body {}')
    repo.write('docs/readme.txt', 'text file under docs gets docs type')
    const files = await collectFiles(repo.dir)
    const paths = files.map(file => file.filePath)
    expect(paths).not.toContain('style.css')
    expect(paths).toContain('docs/readme.txt')
  })
})

describe('classifyFile', () => {
  it('maps single paths per FR-5', () => {
    expect(classifyFile('README.md')).toBe('readme')
    expect(classifyFile('docs/adr/0005-x.md')).toBe('adr')
    expect(classifyFile('docs/architecture.md')).toBe('docs')
    expect(classifyFile('docs/schema.png')).toBe('docs')
    expect(classifyFile('specs/002/spec.md')).toBe('specs')
    expect(classifyFile('apps/t/src/x.ts')).toBe('code')
    expect(classifyFile('services/k/src/y.ts')).toBe('code')
    expect(classifyFile('apps/t/src/v.vue')).toBe('code')
    expect(classifyFile('services/k/src/x.py')).toBeNull()
    expect(classifyFile('apps/t/config.json')).toBeNull()
    expect(classifyFile('ci/pipe.yml')).toBeNull()
    expect(classifyFile('package.json')).toBe('config')
    expect(classifyFile('apps/app-package.json')).toBeNull()
  })

  it('code roots require a src segment with source extension', () => {
    expect(classifyFile('apps/timer/srcx/inner.ts')).toBeNull()
    expect(classifyFile('services/marker/src/lib/index.ts')).toBe('code')
    expect(classifyFile('apps/timer/src')).toBeNull()
  })
})
