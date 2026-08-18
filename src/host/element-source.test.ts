import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import type { StudioElementSnapshot } from '../contracts.js'
import { readElementsStyles, saveElementsDefaults, saveElementsSource } from './element-source.js'

const roots: string[] = []

async function project(source: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-studio-element-source-'))
  roots.push(root)
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'Card.tsx'), source)
  return root
}

function element(values: Record<string, string | number | boolean>): StudioElementSnapshot {
  return {
    owner: 'draft',
    element: {
      id: 'card',
      label: 'Card',
      boundary: { surfaceId: 'surface', path: ['card'] },
      source: { file: 'src/Card.tsx' },
      variables: [{ kind: 'group', id: 'appearance', label: 'Appearance', children: [
        { kind: 'variable', id: 'accent', label: 'Accent', control: 'color', defaultSource: { file: 'src/Card.tsx', before: 'const accent = ', after: ';' } },
        { kind: 'group', id: 'layout', label: 'Layout', children: [
          { kind: 'variable', id: 'density', label: 'Density', control: 'number', defaultSource: { file: 'src/Card.tsx', before: 'const density = ', after: ';' } },
        ] },
      ] }],
    },
    values,
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true })))
})

test('updates source defaults without fixing the runtime value at its use sites', async () => {
  const root = await project("const accent = '#235be6';\nconst density = 1;\nexport const fallback = '#235be6';\nexport { accent, density };\n")
  await expect(saveElementsDefaults(root, [element({ accent: '#ff8800', density: 2 })])).resolves.toEqual({ files: ['src/Card.tsx'] })
  await expect(readFile(join(root, 'src', 'Card.tsx'), 'utf8')).resolves.toBe(
    "const accent = '#ff8800';\nconst density = 2;\nexport const fallback = '#235be6';\nexport { accent, density };\n",
  )
})

test('rejects ambiguous default anchors before writing any file', async () => {
  const root = await project("const accent = '#235be6';\nconst density = 1;\nconst density = 1;\n")
  await expect(saveElementsDefaults(root, [element({ accent: '#ff8800', density: 2 })])).rejects.toThrow('default source prefix is not unique')
  await expect(readFile(join(root, 'src', 'Card.tsx'), 'utf8')).resolves.toContain("const accent = '#235be6'")
})

test('rejects controls without default-source metadata', async () => {
  const root = await project('const density = 1;\n')
  const value = element({ accent: '#ff8800', density: 2 })
  value.element.variables = [{ kind: 'group', id: 'layout', label: 'Layout', children: [
    { kind: 'variable', id: 'density', label: 'Density', control: 'number' },
  ] }]
  await expect(saveElementsDefaults(root, [value])).rejects.toThrow('no source-backed Element defaults')
})

test('refuses to replace a computed initializer instead of fixing it to the live value', async () => {
  const root = await project("const accent = resolveAccent();\nconst density = 1;\n")
  await expect(saveElementsDefaults(root, [element({ accent: '#ff8800', density: 2 })])).rejects.toThrow(
    'default is not a quoted string literal',
  )
  await expect(readFile(join(root, 'src', 'Card.tsx'), 'utf8')).resolves.toContain('resolveAccent()')
})

test('persists subtree-scoped CSS beside the Element source and restores its editable rules', async () => {
  const root = await project("'use client';\nconst accent = '#235be6';\nconst density = 1;\nexport { accent, density };\n")
  const snapshot = element({ accent: '#235be6', density: 1 })
  const rules = [{ selector: '&:hover', declarations: [
    { property: 'color', value: 'rgb(1, 2, 3)' },
    { property: 'border-radius', value: '8px' },
  ] }]

  const saved = await saveElementsSource(root, [snapshot], [{ elementId: 'card', rules }])
  expect(saved.files).toHaveLength(2)
  await expect(readFile(join(root, 'src', 'Card.tsx'), 'utf8')).resolves.toMatch(/^'use client';\nimport "\.\/Card\.dsh-studio-/)
  const cssFile = saved.files.find(file => file.endsWith('.css'))!
  await expect(readFile(join(root, cssFile), 'utf8')).resolves.toContain(
    '[data-ui-surface="surface"][data-ui-surface-path="[\\"card\\"]"]:hover',
  )
  await expect(readElementsStyles(root, [snapshot])).resolves.toEqual([{ elementId: 'card', rules }])
})
