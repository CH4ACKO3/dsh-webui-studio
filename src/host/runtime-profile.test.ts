import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it, vi } from 'vitest'
import type { StudioDraftRecord } from '../contracts.js'
import { buildDraft, bundledPnpmCommand, installDraftDependencies, materializeDraftProfile } from './runtime-profile.js'

const roots: string[] = []
const exec = promisify(execFile)

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('snapshots main profile declarations and links the Draft worktree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-studio-profile-'))
  roots.push(root)
  const mainProfile = join(root, 'main', 'profiles', 'web')
  const draftRoot = join(root, 'worktree')
  const studioRoot = join(root, 'studio-package')
  await Promise.all([mkdir(mainProfile, { recursive: true }), mkdir(draftRoot), mkdir(studioRoot)])
  await writeFile(join(mainProfile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    dependencies: { existing: 'link:../../../plugin', 'dsh-webui-studio': '1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }))
  await writeFile(join(mainProfile, 'cordis.patch.yml'), '[]\n')
  const workspacePolicy = `packages:\n  - .\nallowBuilds:\n  example@git-ref: true\n`
  await writeFile(join(mainProfile, 'pnpm-workspace.yaml'), workspacePolicy)
  const draft: StudioDraftRecord = {
    id: 'id', name: 'draft-plugin', label: 'Draft plugin', source: { kind: 'new', packageName: 'draft-plugin' },
    repositoryDir: root, worktreeDir: draftRoot, root: draftRoot,
    runtimeHome: join(root, 'runtime-home'), profileMode: 'main-home', createdAt: 'now',
  }
  const run = vi.fn(async () => {})

  const profile = await materializeDraftProfile(draft, mainProfile, studioRoot, { run })
  const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))

  expect(manifest.dependencies).toEqual({
    existing: `link:${join(root, 'plugin')}`,
    'dsh-webui-studio': `link:${studioRoot}`,
    'draft-plugin': `link:${draftRoot}`,
  })
  expect(manifest.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
  expect(await readFile(join(profile, 'pnpm-workspace.yaml'), 'utf8')).toBe(workspacePolicy)
  const [command, args] = bundledPnpmCommand(['install', '--prefer-offline'])
  expect(run).toHaveBeenCalledWith(command, args, profile, undefined, undefined)
  await materializeDraftProfile(draft, mainProfile, studioRoot, { run })
  expect(run).toHaveBeenCalledTimes(2)
})

it('snapshots a selected custom profile and resolves its relative links from that folder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-studio-custom-profile-'))
  roots.push(root)
  const mainProfile = join(root, 'main', 'profiles', 'web')
  const customProfile = join(root, 'profiles', 'custom-web')
  const linkedPlugin = join(root, 'profiles', 'plugin')
  const draftRoot = join(root, 'worktree')
  const studioRoot = join(root, 'studio-package')
  await Promise.all([
    mkdir(mainProfile, { recursive: true }),
    mkdir(customProfile, { recursive: true }),
    mkdir(linkedPlugin, { recursive: true }),
    mkdir(draftRoot),
    mkdir(studioRoot),
  ])
  await writeFile(join(mainProfile, 'package.json'), JSON.stringify({
    name: 'main-web-profile',
    dependencies: { 'main-only': '1.0.0' },
  }))
  await writeFile(join(mainProfile, 'cordis.yml'), 'main: true\n')
  await writeFile(join(customProfile, 'package.json'), JSON.stringify({
    name: 'custom-web-profile',
    dependencies: { 'custom-only': 'link:../plugin' },
  }))
  await writeFile(join(customProfile, 'cordis.yml'), 'custom: true\n')
  const draft: StudioDraftRecord = {
    id: 'id', name: 'draft-plugin', label: 'Draft plugin', source: { kind: 'new', packageName: 'draft-plugin' },
    repositoryDir: root, worktreeDir: draftRoot, root: draftRoot,
    runtimeHome: join(root, 'runtime-home'), profileMode: 'custom', profileDirectory: customProfile, createdAt: 'now',
  }
  const run = vi.fn(async () => {})

  const profile = await materializeDraftProfile(draft, mainProfile, studioRoot, { run })
  const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))

  expect(manifest.name).toBe('custom-web-profile')
  expect(manifest.dependencies).toEqual({
    'custom-only': `link:${linkedPlugin}`,
    'draft-plugin': `link:${draftRoot}`,
    'dsh-webui-studio': `link:${studioRoot}`,
  })
  expect(await readFile(join(profile, 'cordis.yml'), 'utf8')).toBe('custom: true\n')
})

it('runs the bundled pnpm without relying on the Host PATH', async () => {
  const [command, args] = bundledPnpmCommand(['--version'])
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'PATH'))
  const result = await exec(command, args, { env: { ...env, PATH: '' } })
  expect(result.stdout.trim()).toMatch(/^10\./)
})

it('installs Draft dependencies in the worktree with its declared package manager', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-studio-draft-dependencies-'))
  roots.push(root)
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'draft-plugin',
    packageManager: 'pnpm@10.34.5',
    dependencies: { react: '^18.3.1' },
  }))
  const draft: StudioDraftRecord = {
    id: 'id', name: 'draft-plugin', label: 'Draft plugin', source: { kind: 'new', packageName: 'draft-plugin' },
    repositoryDir: root, worktreeDir: root, root,
    runtimeHome: join(root, 'runtime-home'), profileMode: 'main-home', createdAt: 'now',
  }
  const run = vi.fn(async () => {})
  const output = vi.fn()

  await installDraftDependencies(draft, { run }, output)

  const [command, args] = bundledPnpmCommand(['install', '--prefer-offline'])
  expect(run).toHaveBeenCalledWith(command, args, root, output, undefined)
  expect(output).toHaveBeenCalledWith(expect.stringContaining(`${root}\n$ `))
})

it('builds a pnpm Draft with the bundled package manager', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-studio-draft-build-'))
  roots.push(root)
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'draft-plugin',
    packageManager: 'pnpm@10.34.5',
    scripts: { build: 'tsdown' },
  }))
  const draft: StudioDraftRecord = {
    id: 'id', name: 'draft-plugin', label: 'Draft plugin', source: { kind: 'new', packageName: 'draft-plugin' },
    repositoryDir: root, worktreeDir: root, root,
    runtimeHome: join(root, 'runtime-home'), profileMode: 'main-home', createdAt: 'now',
  }
  const run = vi.fn(async () => {})
  const output = vi.fn()

  await buildDraft(draft, { run }, output)

  const [command, args] = bundledPnpmCommand(['run', 'build'])
  expect(run).toHaveBeenCalledWith(command, args, root, output, undefined)
  expect(output).toHaveBeenCalledWith(expect.stringContaining(' run build\n'))
})

it('skips a Draft install when its manifest has no dependencies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-studio-draft-dependencies-'))
  roots.push(root)
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'draft-plugin', packageManager: 'npm@11' }))
  const draft: StudioDraftRecord = {
    id: 'id', name: 'draft-plugin', label: 'Draft plugin', source: { kind: 'new', packageName: 'draft-plugin' },
    repositoryDir: root, worktreeDir: root, root,
    runtimeHome: join(root, 'runtime-home'), profileMode: 'main-home', createdAt: 'now',
  }
  const run = vi.fn(async () => {})

  await installDraftDependencies(draft, { run })

  expect(run).not.toHaveBeenCalled()
})

it('rejects a package identity that diverges from the persistent Draft record', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-studio-draft-identity-'))
  roots.push(root)
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'renamed-plugin', packageManager: 'npm@11' }))
  const draft: StudioDraftRecord = {
    id: 'id', name: 'draft-plugin', label: 'Draft plugin', source: { kind: 'new', packageName: 'draft-plugin' },
    repositoryDir: root, worktreeDir: root, root,
    runtimeHome: join(root, 'runtime-home'), profileMode: 'main-home', createdAt: 'now',
  }

  await expect(installDraftDependencies(draft, { async run() {} }))
    .rejects.toThrow('Draft package.json name must remain "draft-plugin"')
})
