import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import type { StudioAutomaticPatchRequest } from '../contracts.js'
import { analyzeAutomaticPatch, writeAutomaticPatch, type AutomaticPatchSource } from './automatic-patch.js'

const roots: string[] = []
const require = createRequire(import.meta.url)

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function request(targets: StudioAutomaticPatchRequest['targets']): StudioAutomaticPatchRequest {
  return { kind: 'replace-string', targets, text: 'Original', replacement: 'Changed' }
}

function source(packageName: string, file: string, value: string): AutomaticPatchSource {
  return { package: packageName, file, version: '1.2.3', source: value }
}

test('analyzes every string-literal match and generates one exact-count Patch per matching target', async () => {
  const targets = [
    { package: 'plugin-a', file: 'lib/client.js' },
    { package: 'plugin-b', file: 'dist/web.js' },
    { package: 'plugin-c', file: 'lib/unused.js' },
  ]
  const plan = analyzeAutomaticPatch(request(targets), [
    source('plugin-a', 'lib/client.js', 'const first = "Original";\nconst second = `Original`;\nconst third = "Original";\n'),
    source('plugin-b', 'dist/web.js', 'export default "Original";\n'),
    source('plugin-c', 'lib/unused.js', 'const untouched = "Different";\n'),
  ])

  expect(plan.canApply).toBe(true)
  expect(plan.targets).toMatchObject([
    { package: 'plugin-a', file: 'lib/client.js', matches: [
      { line: 1, column: 15, excerpt: 'const first = "Original";' },
      { line: 3, column: 15, excerpt: 'const third = "Original";' },
    ] },
    { package: 'plugin-b', file: 'dist/web.js', matches: [{ line: 1 }] },
    { package: 'plugin-c', file: 'lib/unused.js', matches: [] },
  ])
  expect(plan.provider.patchIds).toHaveLength(2)
  expect(plan.provider.source).toContain('expect: 2')
  expect(plan.provider.source).toContain('expect: 1')
  expect(plan.provider.source).toContain('files: ["lib/client.js"]')
  expect(plan.provider.source).toContain('files: ["dist/web.js"]')
  expect(plan.provider.source).not.toContain('lib/unused.js')
})

test('returns a non-applicable analysis instead of hiding zero-match targets', () => {
  const targets = [{ package: 'plugin-a', file: 'lib/client.js' }]
  const plan = analyzeAutomaticPatch(request(targets), [
    source('plugin-a', 'lib/client.js', 'const value = "Different";\n'),
  ])

  expect(plan.canApply).toBe(false)
  expect(plan.targets[0]?.matches).toEqual([])
  expect(plan.provider.patchIds).toEqual([])
})

test('writes the provider and manifest declaration as ordinary Draft source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-studio-auto-patch-'))
  roots.push(root)
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'package.json'), `${JSON.stringify({
    name: 'draft-plugin',
    dsh: { client: { platform: 'web' }, harmony: { patches: ['./existing.cjs'] } },
  }, null, 2)}\n`)
  const targets = [{ package: 'plugin-a', file: 'lib/client.js' }]
  const plan = analyzeAutomaticPatch(request(targets), [
    source('plugin-a', 'lib/client.js', 'export const title = "Original";\n'),
  ])

  const result = await writeAutomaticPatch(root, plan)
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    dsh: { harmony: { patches: string[] } }
  }
  const patches = require(join(root, plan.provider.file)) as Array<{ id: string; expect: number }>

  expect(result.files).toEqual([plan.provider.file, 'package.json'])
  expect(manifest.dsh.harmony.patches).toEqual(['./existing.cjs', `./${plan.provider.file}`])
  expect(patches).toMatchObject([{ id: plan.provider.patchIds[0], expect: 1 }])
  await expect(writeAutomaticPatch(root, plan)).rejects.toThrow('already exists')
})

test('rejects malformed target identity while allowing repeated matches', () => {
  const targets = [{ package: 'plugin-a', file: 'lib/client.js' }]
  expect(() => analyzeAutomaticPatch(request(targets), [
    source('plugin-b', 'lib/client.js', 'const value = "Original";\n'),
  ])).toThrow('does not match')
  expect(() => analyzeAutomaticPatch(request([...targets, ...targets]), [
    source('plugin-a', 'lib/client.js', 'const value = "Original";\n'),
    source('plugin-a', 'lib/client.js', 'const value = "Original";\n'),
  ])).toThrow('must be unique')
})
