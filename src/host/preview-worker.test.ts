import { Context } from '@deepseek-ai/cordis'
import { beforeEach, expect, it, vi } from 'vitest'
import type { StudioHarmonyService } from '../contracts.js'

const previewDraft = vi.hoisted(() => ({ construct: vi.fn(), open: vi.fn() }))
const sourceResolver = vi.hoisted(() => ({ readDependencyTarget: vi.fn() }))

vi.mock('./preview-draft.js', () => ({
  StudioPreviewDraft: class {
    constructor() { previewDraft.construct() }
    open() { return previewDraft.open() }
  },
}))

vi.mock('./source-resolution.js', () => ({
  StudioSourceResolver: class {
    readDependencyTarget(packageName: string, file: string) {
      return sourceResolver.readDependencyTarget(packageName, file)
    }
  },
}))

import { StudioPreviewWorkerService } from './preview-worker.js'

const signal = new AbortController().signal

beforeEach(() => {
  previewDraft.construct.mockReset()
  previewDraft.open.mockReset()
  sourceResolver.readDependencyTarget.mockReset()
})

function worker(harmony: StudioHarmonyService = { profileDir: '/profile' } as StudioHarmonyService) {
  return new StudioPreviewWorkerService(new Context(), harmony, { root: '/draft', packageDirs: [] })
}

it('reports unavailable until the Draft startup promise resolves', async () => {
  let resolve!: (draft: { close(): Promise<void> }) => void
  previewDraft.open.mockReturnValue(new Promise(next => { resolve = next }))
  const service = worker()

  await expect(service.health(signal)).resolves.toEqual({ ready: false })
  resolve({ async close() {} })
  await vi.waitFor(async () => {
    await expect(service.health(signal)).resolves.toEqual({ ready: true })
  })
})

it('reports a Draft startup failure through health', async () => {
  previewDraft.open.mockRejectedValue(new Error('Draft Patch reload failed'))
  const service = worker()

  await vi.waitFor(async () => {
    await expect(service.health(signal)).resolves.toEqual({
      ready: false,
      error: 'Draft Patch reload failed',
    })
  })
})

it('reports a synchronous Draft construction failure', async () => {
  previewDraft.construct.mockImplementation(() => { throw new Error('Draft package resolution failed') })
  const service = worker()

  await vi.waitFor(async () => {
    await expect(service.health(signal)).resolves.toEqual({
      ready: false,
      error: 'Draft package resolution failed',
    })
  })
})

it('returns installed dependency source and version for automatic Patch analysis', async () => {
  previewDraft.open.mockResolvedValue({ snapshot: () => ({ name: 'draft-plugin' }), async close() {} })
  sourceResolver.readDependencyTarget.mockResolvedValue({
    package: 'target-plugin', file: 'lib/client.js', version: '1.2.3', source: 'const title = "Original";\n',
  })
  const service = worker()

  await expect(service.readPatchTarget('target-plugin', 'lib/client.js', signal)).resolves.toEqual({
    package: 'target-plugin', file: 'lib/client.js', version: '1.2.3', source: 'const title = "Original";\n',
  })
})

it('normalizes Harmony inspection output like the native JSON carrier', async () => {
  previewDraft.open.mockResolvedValue({ snapshot: () => ({ name: 'draft-plugin' }), async close() {} })
  const service = worker({
    profileDir: '/profile',
    inspect: () => ({ patches: [{ key: 'draft/patch', error: undefined }] }),
    inspectDependencies: () => [{ patch: 'draft/patch', reason: undefined }],
  } as unknown as StudioHarmonyService)

  await expect(service.inspect({}, signal)).resolves.toEqual({
    harmony: { patches: [{ key: 'draft/patch' }] },
    dependencies: [{ patch: 'draft/patch' }],
  })
})

it('resumes one build application after a Connection generation change', async () => {
  const applyBuild = vi.fn(async () => ({
    name: 'draft-plugin', root: '/draft', state: 'preview-pending' as const, graphRev: 'graph-2',
  }))
  previewDraft.open.mockResolvedValue({ applyBuild, async close() {} })
  const service = worker()

  await expect(service.applyBuild('build-operation-1', signal)).resolves.toMatchObject({ graphRev: 'graph-2' })
  await expect(service.applyBuild('build-operation-1', signal)).resolves.toMatchObject({ graphRev: 'graph-2' })
  expect(applyBuild).toHaveBeenCalledTimes(1)
})

it('reads and transactionally updates the active Preview Harmony profile', async () => {
  previewDraft.open.mockResolvedValue({ snapshot: () => ({ name: 'draft-plugin' }), async close() {} })
  const profile = {
    dir: '/draft/profile', order: ['dsh-harmony', 'draft-plugin'], patchOrder: ['draft-plugin/one'], disabled: [],
    plugins: [], orderViolations: [], patchOrderViolations: [], pluginConflicts: [],
  }
  const updateProfile = vi.fn(async (input: { disabled?: string[] }) => ({
    profile: { ...profile, ...input }, generation: 3, reload: { state: 'succeeded' as const }, clientGraphRev: 'graph-3',
  }))
  const service = worker({ profileDir: profile.dir, profile: () => profile, updateProfile } as unknown as StudioHarmonyService)

  await expect(service.profile(signal)).resolves.toEqual(profile)
  await expect(service.updateProfile({ operationId: 'profile-update-1', disabled: ['draft-plugin/one'] }, signal)).resolves.toMatchObject({
    generation: 3, profile: { disabled: ['draft-plugin/one'] },
  })
  expect(updateProfile).toHaveBeenCalledWith({ disabled: ['draft-plugin/one'] })

  await expect(service.updateProfile({ operationId: 'profile-update-1', disabled: ['draft-plugin/one'] }, signal)).resolves.toMatchObject({
    generation: 3, profile: { disabled: ['draft-plugin/one'] },
  })
  expect(updateProfile).toHaveBeenCalledTimes(1)
})
