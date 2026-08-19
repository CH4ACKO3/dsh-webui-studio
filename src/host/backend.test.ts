import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StudioClientRequest, StudioDraftRecord, StudioHarmonyService } from '../contracts.js'
import { StudioBackend } from './backend.js'
import type { StudioCommandRunner, StudioDraftRegistry } from './drafts.js'
import type { StudioWorkspaceStore } from './workspace.js'

const previewState = vi.hoisted(() => ({
  project: { name: 'draft-plugin', root: '', state: 'preview-pending' as const, graphRev: 'graph-1' },
  profile: {
    dir: '/draft/profiles/web',
    order: ['dsh-harmony', 'draft-plugin'],
    patchOrder: ['draft-plugin/one'],
    disabled: [] as string[],
    plugins: [],
    orderViolations: [],
    patchOrderViolations: [],
    incompatibilities: [],
  },
  updateProfile: vi.fn(),
}))

vi.mock('./preview.js', () => ({
  StudioPreviewSupervisor: class {
    runtime = { state: 'stopped', log: '' } as Record<string, string>
    snapshot() { return this.runtime }
    async start() {
      this.runtime = { state: 'running', previewUrl: 'http://127.0.0.1:4000/', bridgeCapability: 'cap', log: '' }
      return this.runtime
    }
    async stop() { this.runtime = { state: 'stopped', log: '' }; return this.runtime }
    async state() { return previewState.project }
    async activate(graphRev: string) { return { ...previewState.project, state: 'active', graphRev } }
    async applyBuild() { return { ...previewState.project, state: 'preview-pending', graphRev: 'graph-2' } }
    async inspect() { return { harmony: { patches: [], targets: [] }, dependencies: [] } }
    async profile() { return previewState.profile }
    async updateProfile(input: { order?: string[]; patchOrder?: string[]; disabled?: string[] }) {
      previewState.updateProfile(input)
      previewState.profile = { ...previewState.profile, ...input }
      return { profile: previewState.profile, generation: 2, reload: { state: 'succeeded' }, clientGraphRev: 'graph-2' }
    }
    async readPatchTarget(packageName: string, file: string) {
      return { package: packageName, file, version: '1.2.3', source: 'const first = "Original";\nconst second = "Original";\n' }
    }
    async dispose() {}
  },
}))

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

function request(method: string, payload: unknown): StudioClientRequest {
  return { type: 'client-request', rpcId: 'rpc-1', method, payload }
}

function record(root: string): StudioDraftRecord {
  return {
    id: '4f5e9f53-5d56-4cb5-837e-a4c084ab6e9c',
    name: 'draft-plugin',
    label: 'Draft plugin',
    source: { kind: 'new', packageName: 'draft-plugin' },
    repositoryDir: root,
    worktreeDir: root,
    root,
    runtimeHome: join(root, 'runtime'),
    profileMode: 'main-home',
    createdAt: '2026-08-16T00:00:00.000Z',
  }
}

function backend(
  draft: StudioDraftRecord,
  get = vi.fn(async () => draft),
  harmony = { profileDir: '/home/profiles/web' } as StudioHarmonyService,
  agentRegistry?: AgentRegistry,
): StudioBackend {
  previewState.project = { name: draft.name, root: draft.root, state: 'preview-pending', graphRev: 'graph-1' }
  const agents = agentRegistry ?? ({ create: vi.fn(async () => ({ dispose: vi.fn(async () => {}) })) } as unknown as AgentRegistry)
  const subprocess = {} as SubprocessRuntime
  const registry = {
    list: vi.fn(async () => [draft]),
    get,
    create: vi.fn(async () => draft),
    rename: vi.fn(async (_id: string, label: string) => ({ ...draft, label: label.trim() })),
    export: vi.fn(async () => ({ ...draft, exportedAt: '2026-08-17T00:00:00.000Z' })),
  } as unknown as StudioDraftRegistry
  const workspace = {
    read: vi.fn(async () => ({ openDraftIds: [] })),
    write: vi.fn(async (state: unknown) => state),
  } as unknown as StudioWorkspaceStore
  const commands = { run: vi.fn() } as unknown as StudioCommandRunner
  return new StudioBackend(harmony, agents, subprocess, registry, workspace, commands, 'http://127.0.0.1:3081')
}

describe('StudioBackend', () => {
  it('reads and transactionally updates the active Draft Preview Harmony profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-studio-backend-'))
    temporaryDirectories.push(root)
    const draft = record(root)
    previewState.profile = {
      ...previewState.profile,
      order: ['dsh-harmony', draft.name],
      patchOrder: [`${draft.name}/one`],
      disabled: [],
    }
    previewState.updateProfile.mockClear()
    const studio = backend(draft)

    const current = await studio.call(request('studio.drafts.harmony.profile', { draftId: draft.id }))
    const updated = await studio.call(request('studio.drafts.harmony.updateProfile', {
      draftId: draft.id,
      order: ['dsh-harmony', draft.name],
      patchOrder: [`${draft.name}/one`],
      disabled: [`${draft.name}/*`],
    }))

    expect(current.result).toMatchObject({ ok: true, value: { dir: '/draft/profiles/web', disabled: [] } })
    expect(previewState.updateProfile).toHaveBeenCalledWith({
      order: ['dsh-harmony', draft.name],
      patchOrder: [`${draft.name}/one`],
      disabled: [`${draft.name}/*`],
    })
    expect(updated.result).toMatchObject({ ok: true, value: {
      profile: { disabled: [`${draft.name}/*`] }, generation: 2, clientGraphRev: 'graph-2',
    } })
  })

  it('rejects malformed Draft Preview profile updates before calling the worker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-studio-backend-'))
    temporaryDirectories.push(root)
    const draft = record(root)
    previewState.updateProfile.mockClear()
    const response = await backend(draft).call(request('studio.drafts.harmony.updateProfile', {
      draftId: draft.id,
      disabled: ['plugin-a/*', 1],
    }))

    expect(response.result).toMatchObject({ ok: false, error: { message: 'disabled must be an array of non-empty strings' } })
    expect(previewState.updateProfile).not.toHaveBeenCalled()
  })

  it('lists persistent Drafts and starts one isolated Preview runtime', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-studio-backend-'))
    temporaryDirectories.push(root)
    const studio = backend(record(root))

    const listed = await studio.call(request('studio.drafts.list', {}))
    const started = await studio.call(request('studio.drafts.start', { draftId: record(root).id }))

    expect(listed.result).toMatchObject({ ok: true, value: [{ runtime: { state: 'stopped' } }] })
    expect(started.result).toMatchObject({ ok: true, value: {
      runtime: { state: 'running', previewUrl: 'http://127.0.0.1:4000/' },
      project: { state: 'preview-pending', graphRev: 'graph-1' },
    } })
  })

  it('creates one controller for concurrent first access to a persistent Draft', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-studio-backend-'))
    temporaryDirectories.push(root)
    const draft = record(root)
    const get = vi.fn(async () => draft)
    const studio = backend(draft, get)

    const responses = await Promise.all([
      studio.call(request('studio.drafts.start', { draftId: draft.id })),
      studio.call(request('studio.drafts.start', { draftId: draft.id })),
    ])

    expect(responses.every(response => response.result.ok)).toBe(true)
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('renames the persistent Draft without replacing its package identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-studio-backend-'))
    temporaryDirectories.push(root)
    const draft = record(root)
    const studio = backend(draft)

    const renamed = await studio.call(request('studio.drafts.rename', {
      draftId: draft.id,
      label: 'Header experiment',
    }))
    const listed = await studio.call(request('studio.drafts.list', {}))

    expect(renamed.result).toMatchObject({ ok: true, value: { name: 'draft-plugin', label: 'Header experiment' } })
    expect(listed.result).toMatchObject({ ok: true, value: [{ name: 'draft-plugin', label: 'Header experiment' }] })
  })

  it('reads and updates the persistent workspace without requiring a Draft id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-studio-backend-'))
    temporaryDirectories.push(root)
    const draft = record(root)
    const studio = backend(draft)

    const initial = await studio.call(request('studio.workspace.get', {}))
    const updated = await studio.call(request('studio.workspace.update', {
      openDraftIds: [draft.id],
      selectedDraftId: draft.id,
    }))

    expect(initial.result).toEqual({ ok: true, value: { openDraftIds: [] } })
    expect(updated.result).toEqual({ ok: true, value: { openDraftIds: [draft.id], selectedDraftId: draft.id } })
  })

  it('routes activation and Preview selection by Draft id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-studio-backend-'))
    temporaryDirectories.push(root)
    const draft = record(root)
    const studio = backend(draft)
    await studio.call(request('studio.drafts.start', { draftId: draft.id }))
    const selection = {
      tag: 'button', classes: ['save'], attributes: {}, text: 'Save', outerHTML: '<button>Save</button>',
      rect: { x: 0, y: 0, width: 40, height: 20 }, style: {}, boundaries: [], confidence: 'dom-only',
    }
    const registry = {
      elements: [{
        owner: 'draft-plugin',
        element: {
          id: 'theme', label: 'Theme', boundary: { surfaceId: 'settings', path: ['appearance'] },
          source: { file: 'src/theme.tsx' }, variables: [],
        },
        values: {},
      }],
      variables: [],
    }

    const active = await studio.call(request('studio.project.activate', { draftId: draft.id, graphRev: 'graph-1' }))
    await studio.call(request('studio.preview.update', {
      draftId: draft.id, connected: true, mode: 'inspect', selection, registry,
    }))
    const connected = await studio.call(request('studio.preview.status', { draftId: draft.id }))
    await studio.call(request('studio.preview.update', {
      draftId: draft.id, connected: false, mode: 'browse', selection: null, registry: null,
    }))
    const disconnected = await studio.call(request('studio.preview.status', { draftId: draft.id }))

    expect(active.result).toMatchObject({ ok: true, value: { state: 'active' } })
    expect(connected.result).toMatchObject({ ok: true, value: { selection, registry } })
    expect(disconnected.result).toEqual({ ok: true, value: { connected: false, mode: 'browse' } })
  })

  it('reads and writes files in the selected Draft worktree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-studio-backend-'))
    temporaryDirectories.push(root)
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src/index.ts'), 'before\n')
    const draft = record(root)
    const studio = backend(draft)

    const read = await studio.call(request('studio.project.readFile', { draftId: draft.id, path: 'src/index.ts' }))
    const saved = await studio.call(request('studio.project.writeFile', { draftId: draft.id, path: 'src/index.ts', content: 'after\n' }))

    expect(read.result).toMatchObject({ ok: true, value: { content: 'before\n' } })
    expect(saved.result).toMatchObject({ ok: true, value: { saved: true } })
  })

  it('persists every registered Element value through one Draft-level save', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-studio-backend-'))
    temporaryDirectories.push(root)
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src/theme.ts'), "const accent = '#235be6';\nexport { accent };\n")
    await writeFile(join(root, 'src/layout.ts'), "const density = 1;\nexport { density };\n")
    const draft = record(root)
    const studio = backend(draft)
    await studio.call(request('studio.drafts.start', { draftId: draft.id }))
    await studio.call(request('studio.preview.update', {
      draftId: draft.id,
      connected: true,
      mode: 'browse',
      registry: {
        elements: [{
          owner: draft.name,
          element: {
            id: 'theme',
            label: 'Theme',
            boundary: { surfaceId: 'settings', path: ['theme'] },
            source: { file: 'src/theme.ts' },
            variables: [{
              kind: 'variable',
              id: 'accent',
              label: 'Accent',
              control: 'color',
              defaultSource: { file: 'src/theme.ts', before: 'const accent = ', after: ';' },
            }],
          },
          values: { accent: '#ff8800' },
        }, {
          owner: draft.name,
          element: {
            id: 'layout',
            label: 'Layout',
            boundary: { surfaceId: 'settings', path: ['layout'] },
            source: { file: 'src/layout.ts' },
            variables: [{
              kind: 'variable',
              id: 'density',
              label: 'Density',
              control: 'number',
              defaultSource: { file: 'src/layout.ts', before: 'const density = ', after: ';' },
            }],
          },
          values: { density: 2 },
        }],
        variables: [],
      },
    }))

    const saved = await studio.call(request('studio.elements.saveSource', { draftId: draft.id, styles: [] }))

    expect(saved.result).toEqual({ ok: true, value: { files: ['src/theme.ts', 'src/layout.ts'] } })
    await expect(readFile(join(root, 'src/theme.ts'), 'utf8')).resolves.toBe(
      "const accent = '#ff8800';\nexport { accent };\n",
    )
    await expect(readFile(join(root, 'src/layout.ts'), 'utf8')).resolves.toBe(
      "const density = 2;\nexport { density };\n",
    )
  })

  it('analyzes multiple automatic Patch matches before explicitly writing the provider', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-studio-backend-'))
    temporaryDirectories.push(root)
    await writeFile(join(root, 'package.json'), `${JSON.stringify({
      name: 'draft-plugin', packageManager: 'npm@11', dsh: { client: { platform: 'web' }, harmony: { patches: [] } },
    })}\n`)
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src/client.tsx'), 'export function apply(): void {}\n')
    const draft = record(root)
    const studio = backend(draft)
    const payload = {
      draftId: draft.id,
      kind: 'replace-string',
      targets: [{ package: 'target-plugin', file: 'lib/client.js' }],
      text: 'Original',
      replacement: 'Changed',
      clientFile: 'src/client.tsx',
      boundary: { surfaceId: 'home', path: ['hero'] },
      selector: '&',
      elementId: 'hero',
      elementLabel: 'Hero',
    }

    const analyzed = await studio.call(request('studio.patches.analyzeAutomatic', payload))
    expect(analyzed.result).toMatchObject({ ok: true, value: {
      canApply: true,
      targets: [{ package: 'target-plugin', file: 'lib/client.js', matches: [{ line: 1 }, { line: 2 }] }],
      provider: { patchIds: [expect.any(String)] },
    } })
    await expect(readFile(join(root, 'package.json'), 'utf8')).resolves.not.toContain('patch.auto-')

    const created = await studio.call(request('studio.patches.createAutomatic', payload))
    expect(created.result).toMatchObject({ ok: true, value: { files: [
      expect.stringMatching(/^patch\.auto-/), expect.stringMatching(/^src\/client\.dsh-studio-auto-/), 'src/client.tsx', 'package.json',
    ] } })
    await expect(readFile(join(root, 'package.json'), 'utf8')).resolves.toContain('patch.auto-')
  })

  it('exports a Draft only through its explicit folder action', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-studio-backend-'))
    temporaryDirectories.push(root)
    const draft = { ...record(root), destinationDirectory: join(root, 'saved-plugin') }
    const studio = backend(draft)

    const exported = await studio.call(request('studio.drafts.export', { draftId: draft.id }))

    expect(exported.result).toMatchObject({ ok: true, value: {
      destinationDirectory: draft.destinationDirectory,
      exportedAt: '2026-08-17T00:00:00.000Z',
    } })
  })

  it('requires a Draft id for Draft-scoped methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-studio-backend-'))
    temporaryDirectories.push(root)
    const response = await backend(record(root)).call(request('studio.project.state', {}))
    expect(response.result).toMatchObject({ ok: false, error: { message: 'draftId is required' } })
  })

  it('keeps the active Agent session attached to its Draft view', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-studio-backend-'))
    temporaryDirectories.push(root)
    const draft = record(root)
    const studio = backend(draft)
    await studio.call(request('studio.drafts.start', { draftId: draft.id }))
    await studio.call(request('studio.project.activate', { draftId: draft.id, graphRev: 'graph-1' }))

    const created = await studio.call(request('studio.agent.create', { draftId: draft.id }))
    const listed = await studio.call(request('studio.drafts.list', {}))

    expect(created.result).toMatchObject({ ok: true, value: { sessionId: expect.any(String), source: 'created' } })
    expect(listed.result).toMatchObject({ ok: true, value: [{ agent: created.result.ok ? created.result.value : undefined }] })
  })

  it('attaches an existing idle session and leaves Studio mode without stopping the Draft', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-studio-backend-'))
    temporaryDirectories.push(root)
    const draft = record(root)
    const cleanup = vi.fn()
    const agent = {
      status: 'idle',
      session: { header: { agentPreset: 'ordinary' } },
    } as Record<string, unknown>
    const agentCtx = {
      agent,
      inject: vi.fn((_dependencies: string[], callback: (ctx: unknown) => unknown) => {
        const dispose = callback(agentCtx)
        return {
          dispose: vi.fn(async () => { if (typeof dispose === 'function') dispose() }),
          then: (resolve: (value?: unknown) => unknown) => Promise.resolve(resolve()),
        }
      }),
      tools: {
        schemas: vi.fn(() => []),
        restrict: vi.fn(() => cleanup),
        register: vi.fn(() => cleanup),
      },
      systemPrompt: { section: vi.fn(() => cleanup), context: vi.fn(() => cleanup) },
      skills: { register: vi.fn(() => cleanup) },
    }
    agent.ctx = agentCtx
    const agents = {
      get: vi.fn(() => agent),
      resume: vi.fn(),
    } as unknown as AgentRegistry
    const studio = backend(draft, undefined, undefined, agents)
    await studio.call(request('studio.drafts.start', { draftId: draft.id }))
    await studio.call(request('studio.project.activate', { draftId: draft.id, graphRev: 'graph-1' }))

    const attached = await studio.call(request('studio.agent.attach', {
      draftId: draft.id,
      sessionId: 'c33dc5b3-5bcd-4168-bd6b-c86ad54412b1',
    }))
    const left = await studio.call(request('studio.agent.leave', { draftId: draft.id }))

    expect(attached.result).toMatchObject({ ok: true, value: {
      sessionId: 'c33dc5b3-5bcd-4168-bd6b-c86ad54412b1', agentPreset: 'ordinary', source: 'existing',
    } })
    expect(left.result).toMatchObject({ ok: true, value: { runtime: { state: 'running' } } })
    if (left.result.ok) expect(left.result.value).not.toHaveProperty('agent')
    expect(cleanup).toHaveBeenCalledTimes(11)
    expect(agents.resume).not.toHaveBeenCalled()
  })
})
