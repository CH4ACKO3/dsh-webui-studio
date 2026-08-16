import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StudioDraftRegistry, studioCommands } from './drafts.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('StudioDraftRegistry', () => {
  it('streams command output and preserves it when a command fails', async () => {
    const output: string[] = []
    await expect(studioCommands.run(process.execPath, ['-e', `
      process.stdout.write('installing\\n')
      process.stderr.write('dependency rejected\\n')
      process.exit(3)
    `], undefined, chunk => output.push(chunk))).rejects.toThrow(/dependency rejected/)
    expect(output.join('')).toContain('installing\n')
    expect(output.join('')).toContain('dependency rejected\n')
  })

  it('creates and persists a new plugin in a managed Git worktree', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-studio-registry-'))
    roots.push(home)
    const registry = new StudioDraftRegistry(home)

    const draft = await registry.create({
      source: { kind: 'new', packageName: 'dsh-test-draft' },
      profileMode: 'main-home',
    })

    expect(draft.root).toBe(draft.worktreeDir)
    expect(draft.worktreeDir).toContain(join(home, 'studio', 'worktrees'))
    expect(JSON.parse(await readFile(join(draft.root, 'package.json'), 'utf8'))).toMatchObject({
      name: 'dsh-test-draft',
      dsh: { client: { platform: 'web' } },
    })
    const client = await readFile(join(draft.root, 'lib/client.js'), 'utf8')
    let registration: { id: string; factory: () => { apply: () => void } } | undefined
    Function('window', client)({ __ModuleLoader__: { load(value: typeof registration) { registration = value } } })
    expect(registration?.id).toBe('dsh-test-draft')
    expect(registration?.factory().apply).toBeTypeOf('function')
    await expect(registry.list()).resolves.toEqual([draft])
    await expect(registry.get(draft.id)).resolves.toEqual(draft)
  })

  it('keeps custom profile creation as an explicit placeholder', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-studio-registry-'))
    roots.push(home)
    const registry = new StudioDraftRegistry(home)
    await expect(registry.create({
      source: { kind: 'new', packageName: 'dsh-test-draft' },
      profileMode: 'custom',
    })).rejects.toThrow('not implemented')
  })
})
