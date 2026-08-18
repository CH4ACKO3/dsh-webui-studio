import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import type { StudioElementSnapshot } from 'dsh-harmony-react/studio'
import { saveElementDefaults } from './element-source.js'

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
      variables: [
        { id: 'accent', label: 'Accent', control: 'color', defaultSource: { file: 'src/Card.tsx', before: 'const accent = ', after: ';' } },
        { id: 'density', label: 'Density', control: 'number', defaultSource: { file: 'src/Card.tsx', before: 'const density = ', after: ';' } },
      ],
    },
    values,
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true })))
})

test('updates source defaults without fixing the runtime value at its use sites', async () => {
  const root = await project("const accent = '#235be6';\nconst density = 1;\nexport const fallback = '#235be6';\nexport { accent, density };\n")
  await expect(saveElementDefaults(root, element({ accent: '#ff8800', density: 2 }))).resolves.toEqual({ files: ['src/Card.tsx'] })
  await expect(readFile(join(root, 'src', 'Card.tsx'), 'utf8')).resolves.toBe(
    "const accent = '#ff8800';\nconst density = 2;\nexport const fallback = '#235be6';\nexport { accent, density };\n",
  )
})

test('rejects ambiguous default anchors before writing any file', async () => {
  const root = await project("const accent = '#235be6';\nconst density = 1;\nconst density = 1;\n")
  await expect(saveElementDefaults(root, element({ accent: '#ff8800', density: 2 }))).rejects.toThrow('default source prefix is not unique')
  await expect(readFile(join(root, 'src', 'Card.tsx'), 'utf8')).resolves.toContain("const accent = '#235be6'")
})

test('rejects controls without default-source metadata', async () => {
  const root = await project('const density = 1;\n')
  const value = element({ accent: '#ff8800', density: 2 })
  value.element.variables = [{ id: 'density', label: 'Density', control: 'number' }]
  await expect(saveElementDefaults(root, value)).rejects.toThrow('no source-backed defaults')
})

test('refuses to replace a computed initializer instead of fixing it to the live value', async () => {
  const root = await project("const accent = resolveAccent();\nconst density = 1;\n")
  await expect(saveElementDefaults(root, element({ accent: '#ff8800', density: 2 }))).rejects.toThrow(
    'default is not a quoted string literal',
  )
  await expect(readFile(join(root, 'src', 'Card.tsx'), 'utf8')).resolves.toContain('resolveAccent()')
})
