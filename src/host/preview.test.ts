import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { StudioDraftRecord } from '../contracts.js'
import type { StudioCommandRunner } from './drafts.js'
import { StudioPreviewSupervisor } from './preview.js'

const roots: string[] = []
const children: ChildProcess[] = []

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('publishes profile installation progress and a failed runtime snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-studio-preview-'))
  roots.push(root)
  const mainProfile = join(root, 'main', 'profiles', 'web')
  const draftRoot = join(root, 'draft')
  await Promise.all([mkdir(mainProfile, { recursive: true }), mkdir(draftRoot)])
  await writeFile(join(mainProfile, 'package.json'), JSON.stringify({ name: 'dsh-profile-web', private: true }))
  await writeFile(join(draftRoot, 'package.json'), JSON.stringify({ name: 'draft-plugin', packageManager: 'npm@11' }))
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

it('forcefully reaps a Preview Host that ignores SIGTERM', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-studio-preview-stop-'))
  roots.push(root)
  const child = spawn(process.execPath, ['-e', `
    process.on('SIGTERM', () => {})
    process.stdout.write('ready\\n')
    setInterval(() => {}, 1_000)
  `], { stdio: ['ignore', 'pipe', 'ignore'] })
  children.push(child)
  await once(child.stdout!, 'data')
  const draft: StudioDraftRecord = {
    id: 'id', name: 'draft-plugin', label: 'Draft plugin', source: { kind: 'new', packageName: 'draft-plugin' },
    repositoryDir: root, worktreeDir: root, root,
    runtimeHome: join(root, 'runtime-home'), profileMode: 'main-home', createdAt: 'now',
  }
  const preview = new StudioPreviewSupervisor(
    draft,
    root,
    'http://127.0.0.1:3081',
    { async run() {} },
    '/unused/dsh.js',
    20,
  )
  const mutablePreview = preview as unknown as { child: ChildProcess }
  mutablePreview.child = child

  await expect(preview.stop()).resolves.toMatchObject({ state: 'stopped' })
  expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
  if (process.platform !== 'win32') expect(child.signalCode).toBe('SIGKILL')
})

it('cancels and waits for a Preview start that is still installing dependencies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-studio-preview-cancel-'))
  roots.push(root)
  const mainProfile = join(root, 'main', 'profiles', 'web')
  const draftRoot = join(root, 'draft')
  await Promise.all([mkdir(mainProfile, { recursive: true }), mkdir(draftRoot)])
  await writeFile(join(mainProfile, 'package.json'), JSON.stringify({ name: 'dsh-profile-web', private: true }))
  await writeFile(join(draftRoot, 'package.json'), JSON.stringify({
    name: 'draft-plugin',
    packageManager: 'npm@11',
    dependencies: { example: '1.0.0' },
  }))
  const draft: StudioDraftRecord = {
    id: 'id', name: 'draft-plugin', label: 'Draft plugin', source: { kind: 'new', packageName: 'draft-plugin' },
    repositoryDir: root, worktreeDir: draftRoot, root: draftRoot,
    runtimeHome: join(root, 'runtime-home'), profileMode: 'main-home', createdAt: 'now',
  }
  let commandStarted!: () => void
  const started = new Promise<void>(resolve => { commandStarted = resolve })
  const commands: StudioCommandRunner = {
    async run(_command, _args, _cwd, _onOutput, signal) {
      await new Promise<void>((_resolve, reject) => {
        if (signal?.aborted) reject(signal.reason)
        else signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        commandStarted()
      })
    },
  }
  const preview = new StudioPreviewSupervisor(draft, mainProfile, 'http://127.0.0.1:3081', commands, '/unused/dsh.js')

  const start = preview.start().catch(error => error as Error)
  await started
  await expect(preview.stop()).resolves.toMatchObject({ state: 'stopped' })
  await expect(start).resolves.toMatchObject({ message: 'Preview start canceled' })
  expect(preview.snapshot()).toMatchObject({ state: 'stopped' })
})

it('terminates a spawned Preview child before waiting for start to settle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-studio-preview-start-stop-'))
  roots.push(root)
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], { stdio: 'ignore' })
  children.push(child)
  const draft: StudioDraftRecord = {
    id: 'id', name: 'draft-plugin', label: 'Draft plugin', source: { kind: 'new', packageName: 'draft-plugin' },
    repositoryDir: root, worktreeDir: root, root,
    runtimeHome: join(root, 'runtime-home'), profileMode: 'main-home', createdAt: 'now',
  }
  const preview = new StudioPreviewSupervisor(draft, root, 'http://127.0.0.1:3081', { async run() {} }, '/unused/dsh.js', 100)
  const abort = new AbortController()
  const start = once(child, 'exit').then(() => { throw abort.signal.reason })
  const mutablePreview = preview as unknown as {
    child: ChildProcess
    startAbort: AbortController
    startPromise: Promise<never>
  }
  mutablePreview.child = child
  mutablePreview.startAbort = abort
  mutablePreview.startPromise = start

  await expect(preview.stop()).resolves.toMatchObject({ state: 'stopped' })
  await expect(start).rejects.toThrow('Preview start canceled')
  expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
})
