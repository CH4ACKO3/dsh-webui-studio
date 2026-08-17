import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import type { StudioHarmonyService } from '../contracts.js'
import { StudioPreviewDraft } from './preview-draft.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function previewHost() {
  const profile = mkdtempSync(join(tmpdir(), 'dsh-studio-preview-draft-'))
  roots.push(profile)
  const root = join(profile, 'node_modules', 'draft-plugin')
  mkdirSync(root, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { 'draft-plugin': 'link:./node_modules/draft-plugin' } }))
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'draft-plugin',
    type: 'module',
    exports: { '.': './index.js', './client': './client.js' },
    dsh: { client: { platform: 'web' }, harmony: { patches: ['./patch.cjs'] } },
  }))
  writeFileSync(join(root, 'index.js'), 'export function apply() {}\n')
  writeFileSync(join(root, 'client.js'), 'export {}\n')
  writeFileSync(join(root, 'patch.cjs'), 'module.exports = []\n')

  const entries: Array<{ id: string; options: { name: string } }> = []
  let graph = { rev: 'graph-1', entries: [] as Array<{ id: string }> }
  const calls: string[] = []
  const reloadPlugin = vi.fn(async (name: string) => { calls.push(`reload:${name}`) })
  const ctx = {
    loader: {
      *entries() { yield* entries },
      async create({ name }: { name: string }) {
        calls.push(`create:${name}`)
        entries.push({ id: 'draft-entry', options: { name } })
        graph = { rev: 'graph-1', entries: [{ id: name }] }
        return 'draft-entry'
      },
      async remove(id: string) {
        calls.push(`remove:${id}`)
        entries.splice(0)
        graph = { rev: 'graph-removed', entries: [] }
      },
    },
    clientModules: {
      graph: () => graph,
      onGraphChanged() { return () => {} },
    },
  } as unknown as Context
  const harmony = {
    profileDir: profile,
    reloadPlugin,
  } as unknown as StudioHarmonyService
  return {
    root,
    ctx,
    harmony,
    calls,
    reloadPlugin,
    setGraph(rev: string) { graph = { rev, entries: [{ id: 'draft-plugin' }] } },
  }
}

it('loads real Draft Patches before reporting the Preview as pending', async () => {
  const host = previewHost()
  const draft = await new StudioPreviewDraft(host.ctx, host.harmony, host.root).open()

  expect(draft.snapshot()).toEqual({
    name: 'draft-plugin', root: realpathSync(host.root), state: 'preview-pending', graphRev: 'graph-1',
  })
  expect(host.calls).toEqual(['create:draft-plugin', 'reload:draft-plugin'])

  expect(draft.activate('graph-1').state).toBe('active')
  host.setGraph('graph-2')
  await expect(draft.applyBuild()).resolves.toMatchObject({ state: 'preview-pending', graphRev: 'graph-2' })
  await draft.close()
  expect(host.calls.slice(-3)).toEqual(['reload:draft-plugin', 'remove:draft-entry', 'reload:draft-plugin'])
})

it('fails Preview startup and removes its Loader entry when the reload transaction fails', async () => {
  const host = previewHost()
  host.reloadPlugin.mockRejectedValueOnce(new Error('Draft plugin reload failed'))

  await expect(new StudioPreviewDraft(host.ctx, host.harmony, host.root).open()).rejects.toThrow('Draft plugin reload failed')
  expect(host.reloadPlugin).toHaveBeenCalledTimes(2)
  expect(host.calls).toEqual(['create:draft-plugin', 'remove:draft-entry', 'reload:draft-plugin'])
})

it('accepts only the live Preview graph', async () => {
  const host = previewHost()
  const draft = await new StudioPreviewDraft(host.ctx, host.harmony, host.root).open()

  expect(() => draft.activate('stale-graph')).toThrow('did not confirm')
  expect(draft.snapshot().state).toBe('preview-pending')
})
