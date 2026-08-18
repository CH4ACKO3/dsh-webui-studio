import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import ts from 'typescript'
import type { StudioAutomaticPatchRequest, StudioElementSnapshot } from '../contracts.js'
import { analyzeAutomaticPatch, writeAutomaticPatch, type AutomaticPatchSource } from './automatic-patch.js'
import { saveElementsDefaults } from './element-source.js'

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

function cssRequest(targets: StudioAutomaticPatchRequest['targets']): StudioAutomaticPatchRequest {
  return {
    kind: 'css-style', targets, select: 'CallExpression', elementId: 'hero', elementLabel: 'Hero',
    variables: [{ id: 'accent', label: 'Accent', property: 'color', control: 'color', value: '#235be6' },
      { id: 'radius', label: 'Radius', property: 'border-radius', control: 'length', value: '8px' }],
  }
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
  ], 'draft-plugin')

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
  ], 'draft-plugin')

  expect(plan.canApply).toBe(false)
  expect(plan.targets[0]?.matches).toEqual([])
  expect(plan.provider.patchIds).toEqual([])
})

test('generates a CSS Patch that registers the same Element variable contract', async () => {
  const targets = [{ package: 'plugin-a', file: 'lib/client.js' }]
  const plan = analyzeAutomaticPatch(cssRequest(targets), [
    source('plugin-a', 'lib/client.js', 'const view = (0, jsxRuntime.jsx)(Hero, { children: "Original" });\n'),
  ], 'draft-plugin')

  expect(plan.canApply).toBe(true)
  expect(plan.targets[0]?.matches).toMatchObject([{ applicable: true, line: 1 }])
  expect(plan.provider.source).toContain("'data-dsh-studio-auto'")
  expect(plan.provider.source).toContain('registerElement')
  expect(plan.provider.source).toContain('border-radius')
  expect(plan.provider.source).toContain('expect: 1')
  expect(plan.provider.source).toContain('dsh-studio-default:')

  const root = await mkdtemp(join(tmpdir(), 'dsh-studio-auto-css-'))
  roots.push(root)
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'draft-plugin', dsh: { harmony: { patches: [] } } }))
  await writeAutomaticPatch(root, plan)
  const patches = require(join(root, plan.provider.file)) as Array<{ apply(context: unknown): void }>
  const sourceText = 'const view = (0, jsxRuntime.jsx)(Hero, { children: "Original" });\n'
  const sourceFile = ts.createSourceFile('lib/client.js', sourceText, ts.ScriptTarget.Latest, true)
  let replacement = ''
  let node: ts.Node | undefined
  const visit = (candidate: ts.Node): void => {
    if (ts.isCallExpression(candidate) && node === undefined) node = candidate
    ts.forEachChild(candidate, visit)
  }
  visit(sourceFile)
  patches[0]!.apply({
    node,
    source: sourceText,
    sourceFile,
    ts,
    edit: { overwrite(_start: number, _end: number, value: string) { replacement = value } },
  })
  expect(replacement).toContain('data-dsh-studio-auto')
  expect(replacement).toContain('border-radius')
  expect(replacement).not.toContain('SOURCE_PROPS')
  expect(replacement).not.toContain('DEFAULT_VALUES')

  const element: StudioElementSnapshot = {
    owner: 'draft-plugin',
    element: {
      id: 'generated', label: 'Generated', boundary: { surfaceId: 'dsh-studio-auto', path: ['hero'] },
      source: { file: plan.provider.file },
      variables: [{ kind: 'group', id: 'css', label: 'CSS', children: [
        { kind: 'variable', id: 'accent', label: 'Accent', control: 'color', defaultSource: { file: plan.provider.file, before: `        "accent": /* dsh-studio-default:${plan.provider.patchIds[0]}:accent */ `, after: ',\n' } },
      ] }],
    },
    values: { accent: '#ff8800' },
  }
  await saveElementsDefaults(root, [element])
  await expect(readFile(join(root, plan.provider.file), 'utf8')).resolves.toContain('#ff8800')
})

test('keeps CSS selector matches visible when a selector also catches a non-React node', () => {
  const targets = [{ package: 'plugin-a', file: 'lib/client.js' }]
  const plan = analyzeAutomaticPatch(cssRequest(targets), [
    source('plugin-a', 'lib/client.js', 'const value = call();\nconst view = (0, jsxRuntime.jsx)(Hero, {});\n'),
  ], 'draft-plugin')

  expect(plan.canApply).toBe(false)
  expect(plan.targets[0]?.matches).toMatchObject([
    { applicable: false, reason: 'selector match is not a compiled React jsx/jsxs call' },
    { applicable: true },
  ])
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
  ], 'draft-plugin')

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
  ], 'draft-plugin')).toThrow('does not match')
  expect(() => analyzeAutomaticPatch(request([...targets, ...targets]), [
    source('plugin-a', 'lib/client.js', 'const value = "Original";\n'),
    source('plugin-a', 'lib/client.js', 'const value = "Original";\n'),
  ], 'draft-plugin')).toThrow('must be unique')
})
