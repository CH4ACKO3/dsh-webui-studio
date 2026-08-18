import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  StudioHarmonyInspection,
  StudioPackResult,
  StudioReadinessFinding,
  StudioReadinessReport,
  StudioPatchDependency,
} from '../contracts.js'

const PACK_TIMEOUT_MS = 120_000
const OUTPUT_LIMIT_BYTES = 256 * 1024

interface DraftManifest {
  name?: unknown
  version?: unknown
  main?: unknown
  types?: unknown
  exports?: unknown
  files?: unknown
  scripts?: { build?: unknown }
  dependencies?: Record<string, unknown>
  peerDependencies?: Record<string, unknown>
  dsh?: {
    client?: { platform?: unknown; inject?: unknown }
    harmony?: { patches?: unknown; before?: unknown; after?: unknown; conflicts?: unknown }
  }
}

function finding(level: StudioReadinessFinding['level'], code: string, message: string, fields: Partial<StudioReadinessFinding> = {}): StudioReadinessFinding {
  return { level, code, message, ...fields }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function exportPath(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  return exportPath(record.import) ?? exportPath(record.default) ?? exportPath(record.require)
}

function clientExport(manifest: DraftManifest): string | undefined {
  if (typeof manifest.exports !== 'object' || manifest.exports === null) return undefined
  return exportPath((manifest.exports as Record<string, unknown>)['./client'])
}

function rootExport(manifest: DraftManifest): string | undefined {
  if (typeof manifest.main === 'string') return manifest.main
  if (typeof manifest.exports !== 'object' || manifest.exports === null) return undefined
  return exportPath((manifest.exports as Record<string, unknown>)['.'])
}

function within(root: string, path: string): boolean {
  const remainder = relative(root, path)
  return remainder === '' || (!remainder.startsWith('..') && !isAbsolute(remainder))
}

function artifactFinding(root: string, path: string, label: string): StudioReadinessFinding | undefined {
  const target = resolve(root, path)
  if (!within(root, target)) return finding('error', 'artifact-escapes-root', `${label} ${JSON.stringify(path)} escapes the Draft root`, { file: path })
  if (!existsSync(target)) return finding('error', 'artifact-missing', `${label} ${JSON.stringify(path)} does not exist; build the Draft before publishing`, { file: path })
  return undefined
}

function readManifest(root: string): DraftManifest {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as DraftManifest
}

export function inspectReadiness(
  root: string,
  projectName: string,
  inspection: StudioHarmonyInspection,
  profileDir: string,
  dependencies: StudioPatchDependency[] = [],
): StudioReadinessReport {
  const manifest = readManifest(root)
  const findings: StudioReadinessFinding[] = []
  if (typeof manifest.name !== 'string' || manifest.name === '') {
    findings.push(finding('error', 'manifest-name', 'package.json must declare a non-empty name', { file: 'package.json' }))
  } else if (manifest.name !== projectName) {
    findings.push(finding('error', 'manifest-identity', `package.json name must remain ${JSON.stringify(projectName)}`, { file: 'package.json' }))
  }
  if (typeof manifest.version !== 'string' || manifest.version === '') {
    findings.push(finding('error', 'manifest-version', 'package.json must declare a publishable version', { file: 'package.json' }))
  }
  if (manifest.dsh?.client?.platform !== 'web') {
    findings.push(finding('error', 'client-platform', 'dsh.client.platform must be "web"', { file: 'package.json' }))
  }
  if (typeof manifest.scripts?.build !== 'string' || manifest.scripts.build.trim() === '') {
    findings.push(finding('error', 'build-script', 'package.json must declare a non-empty scripts.build', { file: 'package.json' }))
  }

  const client = clientExport(manifest)
  if (client === undefined) {
    findings.push(finding('error', 'client-export', 'package.json must export "./client"', { file: 'package.json' }))
  } else {
    const missing = artifactFinding(root, client, 'Client export')
    if (missing !== undefined) findings.push(missing)
  }
  if (typeof manifest.exports !== 'object' || manifest.exports === null
    || (manifest.exports as Record<string, unknown>)['./package.json'] === undefined) {
    findings.push(finding('error', 'package-json-export', 'package.json must export "./package.json" for DSH Client discovery', { file: 'package.json' }))
  }
  const host = rootExport(manifest)
  if (host === undefined) {
    findings.push(finding('error', 'host-export', 'package.json must expose a root Host entry through main or exports["."]', { file: 'package.json' }))
  } else {
    const missing = artifactFinding(root, host, 'Host export')
    if (missing !== undefined) findings.push(missing)
  }
  for (const [path, label] of [[manifest.types, 'Types entry']] as const) {
    if (typeof path !== 'string') continue
    const missing = artifactFinding(root, path, label)
    if (missing !== undefined) findings.push(missing)
  }

  const harmony = manifest.dsh?.harmony
  const patchFiles = stringArray(harmony?.patches)
  if (harmony?.patches !== undefined && (!Array.isArray(harmony.patches) || patchFiles.length !== harmony.patches.length)) {
    findings.push(finding('error', 'patch-manifest', 'dsh.harmony.patches must contain only file paths', { file: 'package.json' }))
  }
  for (const path of patchFiles) {
    const target = resolve(root, path)
    if (!within(root, target)) {
      findings.push(finding('error', 'patch-escapes-root', `Harmony patch ${JSON.stringify(path)} escapes the Draft root`, { file: path }))
      continue
    }
    if (!existsSync(target)) {
      findings.push(finding('error', 'patch-file-missing', `Harmony patch ${JSON.stringify(path)} does not exist`, { file: path }))
      continue
    }
    if (!within(realpathSync(root), realpathSync(target))) {
      findings.push(finding('error', 'patch-symlink-escape', `Harmony patch ${JSON.stringify(path)} resolves outside the Draft root`, { file: path }))
    }
  }

  const declared = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})])
  const declaredAfter = new Set(stringArray(harmony?.after))
  for (const dependency of stringArray(manifest.dsh?.client?.inject)) {
    if (!declared.has(dependency)) {
      findings.push(finding('warning', 'ambient-client-service', `Client inject ${JSON.stringify(dependency)} is supplied by the current profile but is not declared as a dependency or peer dependency`))
    }
  }
  for (const dependency of [...stringArray(harmony?.before), ...stringArray(harmony?.after), ...stringArray(harmony?.conflicts)]) {
    if (!declared.has(dependency)) {
      findings.push(finding('warning', 'ambient-provider', `Harmony provider ${JSON.stringify(dependency)} affects ordering or compatibility but is not declared as a dependency or peer dependency`))
    }
  }

  const patches = inspection.patches.filter(patch => patch.owner === projectName)
  for (const patch of patches) {
    const targets = new Map(patch.targets.map(target => [`${target.package}\0${target.version ?? ''}`, target]))
    for (const target of targets.values()) {
      if (!declared.has(target.package)) {
        findings.push(finding('warning', 'ambient-patch-target', `Patch target ${JSON.stringify(target.package)} is available in this Preview but is not declared as a dependency or peer dependency`, { patch: patch.key }))
      }
      if (target.version === undefined) {
        findings.push(finding('warning', 'unbounded-target-version', `Patch ${JSON.stringify(patch.key)} does not constrain target package ${JSON.stringify(target.package)}`, { patch: patch.key }))
      }
    }
    if (patch.state === 'failed') {
      findings.push(finding('error', 'patch-failed', patch.error ?? `Patch ${JSON.stringify(patch.key)} failed against the current provider stack`, { patch: patch.key, file: patch.file }))
    } else if (patch.state === 'disabled') {
      findings.push(finding('warning', 'patch-disabled', `Patch ${JSON.stringify(patch.key)} is disabled in the current profile`, { patch: patch.key, file: patch.file }))
    } else if (patch.state === 'pending' || !patch.loaded) {
      findings.push(finding('warning', 'patch-unverified', `Patch ${JSON.stringify(patch.key)} has not been exercised by the current Preview`, { patch: patch.key, file: patch.file }))
    }
  }

  for (const dependency of dependencies) {
    const explicit = dependency.providerCandidates.filter(provider => declared.has(provider) && declaredAfter.has(provider))
    if (dependency.providerCandidates.length === 1 && explicit.length === 1) continue
    findings.push(finding(
      'warning',
      'differential-provider-stack',
      `Patch ${JSON.stringify(dependency.patch)} fails against the base target but succeeds against the current transformed stack. Earlier provider candidates: ${dependency.providerCandidates.map(provider => JSON.stringify(provider)).join(', ')}. Inspect the ordered Patch steps before declaring a dependency or dsh.harmony.after relationship`,
      { patch: dependency.patch, file: dependency.target.file },
    ))
  }

  const orderPath = join(profileDir, 'harmony.json')
  if (existsSync(orderPath)) {
    const order = (JSON.parse(readFileSync(orderPath, 'utf8')) as { order?: unknown }).order
    if (Array.isArray(order) && order.every((item): item is string => typeof item === 'string')) {
      const position = new Map(order.map((name, index) => [name, index]))
      for (const target of stringArray(harmony?.before)) {
        if ((position.get(projectName) ?? -1) > (position.get(target) ?? Number.MAX_SAFE_INTEGER)) {
          findings.push(finding('info', 'effective-order', `Current Preview places ${projectName} after ${target}, contrary to its before declaration`))
        }
      }
      for (const target of stringArray(harmony?.after)) {
        if ((position.get(target) ?? -1) > (position.get(projectName) ?? Number.MAX_SAFE_INTEGER)) {
          findings.push(finding('info', 'effective-order', `Current Preview places ${projectName} before ${target}, contrary to its after declaration`))
        }
      }
    }
  }

  const rank = { error: 0, warning: 1, info: 2 }
  findings.sort((left, right) => rank[left.level] - rank[right.level] || left.code.localeCompare(right.code) || left.message.localeCompare(right.message))
  return { findings }
}

function outputOf(handle: SubprocessHandle, argv: string[]): StudioPackResult {
  const stdout = handle.collected.stdout?.readFrom(0)
  const stderr = handle.collected.stderr?.readFrom(0)
  return {
    ok: false,
    argv,
    files: [],
    stdout: stdout?.text ?? '',
    stderr: stderr?.text ?? '',
    truncated: stdout?.lossy === true || stderr?.lossy === true,
  }
}

export class StudioPackRunner {
  private active?: { controller: AbortController; handle?: SubprocessHandle }

  constructor(private readonly subprocess: SubprocessRuntime, private readonly timeoutMs = PACK_TIMEOUT_MS) {}

  async run(root: string): Promise<StudioPackResult> {
    if (this.active !== undefined) throw new Error('a package dry-run is already running')
    const controller = new AbortController()
    const active = { controller } as { controller: AbortController; handle?: SubprocessHandle }
    this.active = active
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    const argv = ['npm', 'pack', '--dry-run', '--json', '--ignore-scripts']
    let handle: SubprocessHandle | undefined
    try {
      argv[0] = await this.subprocess.resolveExecutable('npm', undefined, controller.signal)
      handle = this.subprocess.spawn({
        argv,
        cwd: root,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: OUTPUT_LIMIT_BYTES },
          stderr: { maxBytes: OUTPUT_LIMIT_BYTES },
        },
        graceMs: 2_000,
        signal: controller.signal,
      })
      active.handle = handle
      const outcome = await handle.done
      const output = outputOf(handle, argv)
      if (outcome.exitCode !== 0) return output
      try {
        const records = JSON.parse(output.stdout) as Array<{ files?: Array<{ path?: unknown }> }>
        if (!Array.isArray(records) || records.length !== 1 || !Array.isArray(records[0]?.files)) {
          return { ...output, stderr: `${output.stderr}${output.stderr === '' ? '' : '\n'}npm pack returned an unexpected JSON result` }
        }
        return {
          ...output,
          ok: true,
          files: records[0].files.flatMap(file => typeof file.path === 'string' ? [file.path] : []).sort(),
        }
      } catch (error) {
        return { ...output, stderr: `${output.stderr}${output.stderr === '' ? '' : '\n'}${error instanceof Error ? error.message : String(error)}` }
      }
    } finally {
      clearTimeout(timeout)
      if (controller.signal.aborted && handle !== undefined) await handle.waitForExit()
      if (this.active === active) this.active = undefined
    }
  }

  async dispose(): Promise<void> {
    const active = this.active
    if (active === undefined) return
    active.controller.abort()
    if (active.handle !== undefined) await active.handle.waitForExit()
  }
}
