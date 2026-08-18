import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import ts from 'typescript'
import { component } from 'dsh-harmony-react'
import type { StudioAutomaticPatchRequest } from '../contracts.js'
import { analyzeAutomaticPatch, writeAutomaticPatch, type AutomaticPatchSource } from './automatic-patch.js'

const roots: string[] = []

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
    kind: 'css-style', targets, component: 'Hero', clientFile: 'src/client.tsx',
    boundary: { surfaceId: 'home', path: ['hero'] }, selector: '& .hero', elementId: 'hero', elementLabel: 'Hero',
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
    source('plugin-a', 'lib/client.js', 'const Hero = () => (0, jsxRuntime.jsx)("h1", { children: "Original" });\nconst view = (0, jsxRuntime.jsx)(Hero, {});\n'),
  ], 'draft-plugin')

  expect(plan.canApply).toBe(true)
  expect(plan.targets[0]?.matches).toMatchObject([{ applicable: true, line: 1 }])
  expect(plan.provider.source).toContain("const { component } = require('dsh-harmony-react')")
  expect(plan.provider.source).toContain("operation: { kind: 'decorate'")
  expect(plan.provider.source).toContain('select: { name: "Hero" }')
  expect(plan.provider.source).not.toContain('edit.overwrite')
  expect(plan.provider.source).toContain('expect: 1')
  expect(plan.client?.source).toContain('registerStudioElement')
  expect(plan.client?.source).toContain('border-radius')
  expect(plan.client?.source).toContain('return React.createElement(Original, props)')
  expect(plan.client?.source).toContain('dsh-studio-default:')
  const generatedClient = ts.createSourceFile('generated.js', plan.client!.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  expect(generatedClient.parseDiagnostics).toEqual([])
  const providerModule: { exports: unknown } = { exports: {} }
  Function('require', 'module', 'exports', plan.provider.source)(
    (specifier: string) => specifier === 'dsh-harmony-react' ? { component } : undefined,
    providerModule,
    providerModule.exports,
  )
  const [componentPatch] = providerModule.exports as Array<{ apply(context: unknown): void }>
  const targetSource = 'const Hero = () => null;\nconst view = jsx(Hero, { title: "unchanged" });\n'
  const targetFile = ts.createSourceFile('lib/client.js', targetSource, ts.ScriptTarget.Latest, true)
  let declaration: ts.VariableDeclaration | undefined
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'Hero') declaration = node
    ts.forEachChild(node, visit)
  }
  visit(targetFile)
  let overwrite: { start: number; end: number; value: string } | undefined
  componentPatch!.apply({ patch: { key: plan.provider.patchIds[0], owner: 'draft-plugin' }, source: targetSource,
    sourceFile: targetFile, node: declaration, ts, edit: { overwrite(start: number, end: number, value: string) { overwrite = { start, end, value } } } })
  expect(overwrite?.value).toContain(`require("draft-plugin")[${JSON.stringify(plan.client!.export)}]`)
  expect(targetSource.slice(overwrite!.end)).toContain('jsx(Hero, { title: "unchanged" })')

  const root = await mkdtemp(join(tmpdir(), 'dsh-studio-auto-css-'))
  roots.push(root)
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'draft-plugin', dsh: { harmony: { patches: [] } } }))
  await writeFile(join(root, 'src/client.tsx'), "export const Existing = () => null\n")
  await writeAutomaticPatch(root, plan)
  await expect(readFile(join(root, plan.client!.file), 'utf8')).resolves.toContain('React.createElement(Original, props)')
  await expect(readFile(join(root, 'src/client.tsx'), 'utf8')).resolves.toContain(`export { ${plan.client!.export} }`)
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string>; dsh: { client: { immediately: boolean } } }
  expect(manifest.dependencies['dsh-harmony-react']).toBe('^0.2.1')
  expect(manifest.dsh.client.immediately).toBe(true)
})

test('generates a component-owned boundary for a selected element without a host Surface', () => {
  const targets = [{ package: 'plugin-a', file: 'lib/client.js' }]
  const request = cssRequest(targets)
  request.boundary = { surfaceId: 'dsh-studio-auto', path: ['h1[class~="hero"]'] }
  request.targetSelector = 'h1[class~="hero"]'
  request.selector = '&'
  const plan = analyzeAutomaticPatch(request, [
    source('plugin-a', 'lib/client.js', 'function Hero() { return null }\n'),
  ], 'draft-plugin')

  expect(plan.client?.source).toContain('document.querySelectorAll(targetSelector)')
  expect(plan.client?.source).toContain("element.setAttribute('data-ui-surface', boundarySurface)")
  expect(plan.client?.source).toContain('new MutationObserver(markTargets)')
  expect(plan.client?.source).not.toContain('new MutationObserver(applyStyles)')
  expect(plan.client?.source).toContain('while (sheet.cssRules.length > 0) sheet.deleteRule(0)')
  expect(plan.client?.source).toContain('return React.createElement(Original, props)')
})

test('keeps invalid component declarations visible instead of hiding them', () => {
  const targets = [{ package: 'plugin-a', file: 'lib/client.js' }]
  const plan = analyzeAutomaticPatch(cssRequest(targets), [
    source('plugin-a', 'lib/client.js', 'let Hero;\n'),
  ], 'draft-plugin')

  expect(plan.canApply).toBe(false)
  expect(plan.targets[0]?.matches).toMatchObject([
    { applicable: false, reason: 'component variable declaration has no initializer' },
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
