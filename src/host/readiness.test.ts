import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SubprocessHandle, SubprocessOutcome, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { afterEach, expect, test, vi } from 'vitest'
import type { StudioHarmonyInspection } from '../contracts.js'
import { inspectReadiness, StudioPackRunner } from './readiness.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true })
})

function project(manifest: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh studio readiness '))
  roots.push(root)
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))
  return root
}

function inspection(patches: StudioHarmonyInspection['patches'] = []): StudioHarmonyInspection {
  return { patches, targets: [] }
}

test('reports a built, declared Draft as ready', () => {
  const root = project({
    name: '@scope/draft', version: '1.0.0', scripts: { build: 'tsc' },
    exports: { '.': './lib/index.js', './client': './lib/client.js', './package.json': './package.json' },
    peerDependencies: { 'target-ui': '^1.0.0' },
    dsh: { client: { platform: 'web' } },
  })
  mkdirSync(join(root, 'lib'))
  writeFileSync(join(root, 'lib/client.js'), '')
  writeFileSync(join(root, 'lib/index.js'), '')

  expect(inspectReadiness(root, '@scope/draft', inspection([{
    key: '@scope/draft/title', id: 'title', owner: '@scope/draft',
    target: { package: 'target-ui', files: ['lib/client.js'], version: '^1.0.0' },
    kind: 'source', state: 'bound', loaded: true, matches: 1, generation: 1, declaration: 'patch.cjs',
  }]), root)).toEqual({ findings: [] })
})

test('rejects a manifest name that diverges from the persistent Draft identity', () => {
  const root = project({
    name: 'renamed-draft', version: '1.0.0', scripts: { build: 'tsc' },
    exports: { '.': './index.js', './client': './client.js', './package.json': './package.json' },
    dsh: { client: { platform: 'web' } },
  })
  writeFileSync(join(root, 'index.js'), '')
  writeFileSync(join(root, 'client.js'), '')

  expect(inspectReadiness(root, 'draft', inspection(), root).findings).toContainEqual(expect.objectContaining({
    level: 'error', code: 'manifest-identity', file: 'package.json',
  }))
})

test('separates definite failures from ambient provider warnings and effective order info', () => {
  const root = project({
    name: 'draft', version: '', scripts: {}, exports: { '.': './dist/index.js', './client': './dist/client.js' },
    dsh: { client: { platform: 'web', inject: ['ambient-service'] }, harmony: { after: ['provider-a'] } },
  })
  writeFileSync(join(root, 'harmony.json'), JSON.stringify({ order: ['draft', 'provider-a'] }))
  const report = inspectReadiness(root, 'draft', inspection([{
    key: 'draft/title', id: 'title', owner: 'draft', target: { package: 'provider-a', files: ['lib/client.js'] },
    kind: 'source', state: 'failed', loaded: false, matches: 0, generation: 1,
    declaration: 'patch.cjs', error: 'selector did not match',
  }]), root)

  expect(report.findings).toEqual(expect.arrayContaining([
    expect.objectContaining({ level: 'error', code: 'manifest-version' }),
    expect.objectContaining({ level: 'error', code: 'artifact-missing' }),
    expect.objectContaining({ level: 'error', code: 'patch-failed' }),
    expect.objectContaining({ level: 'warning', code: 'ambient-client-service' }),
    expect.objectContaining({ level: 'warning', code: 'ambient-provider' }),
    expect.objectContaining({ level: 'info', code: 'effective-order' }),
  ]))
})

test('warns when a Source Patch only applies after an undeclared provider transformation', () => {
  const root = project({
    name: 'draft', version: '1.0.0', scripts: { build: 'tsc' },
    exports: { '.': './index.js', './client': './client.js' },
    dsh: { client: { platform: 'web' }, harmony: {} },
  })
  writeFileSync(join(root, 'index.js'), '')
  writeFileSync(join(root, 'client.js'), '')

  const report = inspectReadiness(root, 'draft', inspection(), root, [{
    patch: 'draft/slot', target: { package: 'target-ui', file: 'lib/client.js' },
    providerCandidates: ['provider-a'], reason: 'selector did not match',
  }])

  expect(report.findings).toContainEqual(expect.objectContaining({
    level: 'warning', code: 'differential-provider-stack', patch: 'draft/slot',
    message: expect.stringContaining('Earlier provider candidates'),
  }))
})

test('keeps an ambiguous provider-stack warning when every earlier candidate is declared', () => {
  const root = project({
    name: 'draft', version: '1.0.0', scripts: { build: 'tsc' },
    exports: { '.': './index.js', './client': './client.js' },
    dependencies: { 'provider-a': '1', 'provider-b': '1' },
    dsh: { client: { platform: 'web' }, harmony: { after: ['provider-a', 'provider-b'] } },
  })
  writeFileSync(join(root, 'index.js'), '')
  writeFileSync(join(root, 'client.js'), '')

  const report = inspectReadiness(root, 'draft', inspection(), root, [{
    patch: 'draft/slot', target: { package: 'target-ui', file: 'lib/client.js' },
    providerCandidates: ['provider-a', 'provider-b'], reason: 'selector did not match',
  }])

  expect(report.findings).toContainEqual(expect.objectContaining({
    code: 'differential-provider-stack', message: expect.stringContaining('provider-a'),
  }))
})

function outputReader(text: string) {
  return { readFrom: () => ({ text, nextOffset: Buffer.byteLength(text), lossy: false }) }
}

function handle(stdout: string, outcome: SubprocessOutcome = { exitCode: 0, signal: null }): SubprocessHandle {
  return {
    pid: 42, stdin: undefined, stdout: undefined, stderr: undefined,
    collected: { stdout: outputReader(stdout), stderr: outputReader('') },
    done: Promise.resolve(outcome), terminate() {}, async waitForExit() { return true },
  }
}

test('runs npm package inspection with fixed arguments and parses sorted files', async () => {
  const root = project({ name: 'draft', version: '1.0.0' })
  const runtime = {
    resolveExecutable: vi.fn(async () => '/bin/npm'),
    spawn: vi.fn((_spec: SubprocessSpawnSpec) => handle(JSON.stringify([{ files: [{ path: 'z.js' }, { path: 'a.js' }] }]))),
  } as unknown as SubprocessRuntime

  await expect(new StudioPackRunner(runtime).run(root)).resolves.toMatchObject({ ok: true, files: ['a.js', 'z.js'] })
  expect(runtime.spawn).toHaveBeenCalledWith(expect.objectContaining({
    argv: ['/bin/npm', 'pack', '--dry-run', '--json', '--ignore-scripts'], cwd: root, signal: expect.any(AbortSignal),
  }))
})

test('returns npm package failures as inspectable results', async () => {
  const root = project({ name: 'draft', version: '1.0.0' })
  const runtime = {
    resolveExecutable: vi.fn(async () => '/bin/npm'),
    spawn: vi.fn(() => handle('not json', { exitCode: 1, signal: null })),
  } as unknown as SubprocessRuntime

  await expect(new StudioPackRunner(runtime).run(root)).resolves.toMatchObject({ ok: false, stdout: 'not json' })
})
