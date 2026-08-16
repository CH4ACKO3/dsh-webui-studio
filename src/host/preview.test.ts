import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { StudioDraftRecord } from '../contracts.js'
import type { StudioCommandRunner } from './drafts.js'
import { StudioPreviewSupervisor } from './preview.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('publishes profile installation progress and a failed runtime snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-studio-preview-'))
  roots.push(root)
  const mainProfile = join(root, 'main', 'profiles', 'web')
  const draftRoot = join(root, 'draft')
  await Promise.all([mkdir(mainProfile, { recursive: true }), mkdir(draftRoot)])
  await writeFile(join(mainProfile, 'package.json'), JSON.stringify({ name: 'dsh-profile-web', private: true }))
  await writeFile(join(mainProfile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  const draft: StudioDraftRecord = {
    id: 'id', name: 'draft-plugin', label: 'Draft plugin', source: { kind: 'new', packageName: 'draft-plugin' },
    repositoryDir: root, worktreeDir: draftRoot, root: draftRoot,
    runtimeHome: join(root, 'runtime-home'), profileMode: 'main-home', createdAt: 'now',
  }
  let rejectInstall!: (reason: Error) => void
  let commandStarted!: () => void
  const started = new Promise<void>(resolve => { commandStarted = resolve })
  const install = new Promise<void>((_resolve, reject) => { rejectInstall = reject })
  const commands: StudioCommandRunner = {
    async run(_command, _args, _cwd, onOutput) {
      onOutput?.('Resolving packages\n')
      commandStarted()
      await install
    },
  }
  const preview = new StudioPreviewSupervisor(draft, mainProfile, 'http://127.0.0.1:3081', commands, '/unused/dsh.js')

  const start = preview.start()
  await started
  const starting = preview.snapshot()
  expect(starting.state).toBe('starting')
  expect(starting.log).toContain(`${join(draft.runtimeHome, 'profiles', 'web')}\n$ `)
  expect(starting.log).toContain(' install --prefer-offline\nResolving packages')
  rejectInstall(new Error('Command exited with code 1\ndependency build rejected'))
  await expect(start).rejects.toThrow('Check the startup terminal')
  expect(preview.snapshot()).toMatchObject({
    state: 'failed',
    error: 'Profile dependency installation failed. Check the startup terminal for details.',
    log: expect.stringContaining('Command exited with code 1'),
  })
})
