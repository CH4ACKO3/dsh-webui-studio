import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
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
    expect(draft.label).toBe('新插件_1')
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

  it('imports an existing WebUI plugin as an isolated snapshot', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-studio-registry-'))
    const source = await mkdtemp(join(tmpdir(), 'installed-webui-plugin-'))
    roots.push(home, source)
    await mkdir(join(source, 'src'))
    await mkdir(join(source, 'node_modules'))
    await mkdir(join(source, '.git'))
    await writeFile(join(source, 'package.json'), JSON.stringify({
      name: 'installed-webui-plugin',
      exports: { '.': './lib/index.js', './client': './lib/client.js' },
      scripts: { build: 'tsc' },
      dsh: { client: { platform: 'web' } },
    }))
    await writeFile(join(source, 'src', 'client.ts'), 'export const source = true\n')
    await writeFile(join(source, 'node_modules', 'ignored.txt'), 'ignored\n')
    await writeFile(join(source, '.git', 'ignored.txt'), 'ignored\n')
    const registry = new StudioDraftRegistry(home)

    const draft = await registry.create({
      source: { kind: 'existing', directory: source },
      profileMode: 'main-home',
    })

    expect(draft.name).toBe('installed-webui-plugin')
    expect(draft.label).toBe(source.split('/').at(-1))
    expect(draft.root).not.toBe(source)
    expect(await readFile(join(draft.root, 'src', 'client.ts'), 'utf8')).toBe('export const source = true\n')
    await expect(readFile(join(draft.root, 'node_modules', 'ignored.txt'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(draft.root, '.git', 'ignored.txt'), 'utf8')).rejects.toThrow()
    await writeFile(join(draft.root, 'src', 'client.ts'), 'export const draft = true\n')
    expect(await readFile(join(source, 'src', 'client.ts'), 'utf8')).toBe('export const source = true\n')
  })

  it('rejects folders that are not buildable WebUI plugins', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-studio-registry-'))
    const source = await mkdtemp(join(tmpdir(), 'not-a-webui-plugin-'))
    roots.push(home, source)
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'not-a-webui-plugin' }))
    const registry = new StudioDraftRegistry(home)

    await expect(registry.create({
      source: { kind: 'existing', directory: source },
      profileMode: 'main-home',
    })).rejects.toThrow('dsh.client.platform')
  })

  it('rejects symbolic links instead of importing files outside the plugin folder', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-studio-registry-'))
    const source = await mkdtemp(join(tmpdir(), 'webui-plugin-with-link-'))
    const outside = await mkdtemp(join(tmpdir(), 'outside-webui-plugin-'))
    roots.push(home, source, outside)
    await writeFile(join(source, 'package.json'), JSON.stringify({
      name: 'webui-plugin-with-link',
      exports: { '.': './lib/index.js', './client': './lib/client.js' },
      scripts: { build: 'tsc' },
      dsh: { client: { platform: 'web' } },
    }))
    await writeFile(join(outside, 'secret.txt'), 'secret\n')
    await symlink(join(outside, 'secret.txt'), join(source, 'secret.txt'))
    const registry = new StudioDraftRegistry(home)

    await expect(registry.create({
      source: { kind: 'existing', directory: source },
      profileMode: 'main-home',
    })).rejects.toThrow('does not include symbolic links')
  })

  it('persists a renamed Draft and advances generated names', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-studio-registry-'))
    roots.push(home)
    const registry = new StudioDraftRegistry(home)
    const first = await registry.create({ source: { kind: 'new', packageName: 'first-plugin' }, profileMode: 'main-home' })
    const renamed = await registry.rename(first.id, '  Header experiment  ')
    const second = await registry.create({ source: { kind: 'new', packageName: 'second-plugin' }, profileMode: 'main-home' })

    expect(renamed.label).toBe('Header experiment')
    await expect(registry.get(first.id)).resolves.toMatchObject({ label: 'Header experiment' })
    expect(second.label).toBe('新插件_2')
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
