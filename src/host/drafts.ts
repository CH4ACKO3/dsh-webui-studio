import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import type { StudioCreateDraftInput, StudioDraftRecord } from '../contracts.js'

const PACKAGE_NAME = /^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/
const COMMAND_OUTPUT_LIMIT = 2 * 1024 * 1024

export interface StudioCommandRunner {
  run(command: string, args: string[], cwd?: string, onOutput?: (chunk: string) => void): Promise<void>
}

export const studioCommands: StudioCommandRunner = {
  run(command, args, cwd, onOutput) {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''
      const read = (chunk: Buffer | string): void => {
        const text = chunk.toString()
        output = `${output}${text}`.slice(-COMMAND_OUTPUT_LIMIT)
        onOutput?.(text)
      }
      child.stdout.on('data', read)
      child.stderr.on('data', read)
      child.once('error', reject)
      child.once('close', (code, signal) => {
        if (code === 0) resolve()
        else reject(new Error(`Command exited with ${code === null ? signal ?? 'a signal' : `code ${code}`}\n${output.trimEnd()}`))
      })
    })
  },
}

function templateManifest(name: string): string {
  return `${JSON.stringify({
    name,
    version: '0.1.0',
    private: true,
    type: 'module',
    packageManager: 'npm@10.0.0',
    exports: { '.': './lib/index.js', './client': './lib/client.js', './package.json': './package.json' },
    scripts: { build: 'node --check lib/index.js && node --check lib/client.js' },
    dsh: { client: { platform: 'web' }, harmony: { patches: [] } },
  }, null, 2)}\n`
}

function templateClient(name: string): string {
  return `window.__ModuleLoader__.load({
  id: ${JSON.stringify(name)},
  factory: () => ({
    apply() {},
  }),
})
`
}

interface PluginManifest {
  name?: unknown
  exports?: unknown
  scripts?: { build?: unknown }
  dsh?: { client?: { platform?: unknown } }
}

async function pluginManifest(root: string): Promise<PluginManifest & { name: string }> {
  let manifest: PluginManifest
  try {
    manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as PluginManifest
  } catch (error) {
    throw new Error(`Plugin folder must contain a readable package.json: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof manifest.name !== 'string' || !PACKAGE_NAME.test(manifest.name)) {
    throw new Error('Plugin package.json must declare a valid npm package name')
  }
  if (manifest.dsh?.client?.platform !== 'web') {
    throw new Error('Plugin package.json must declare dsh.client.platform as "web"')
  }
  if (typeof manifest.exports !== 'object' || manifest.exports === null
    || !Object.hasOwn(manifest.exports, '.') || !Object.hasOwn(manifest.exports, './client')) {
    throw new Error('Plugin package.json exports must include "." and "./client"')
  }
  if (typeof manifest.scripts?.build !== 'string' || manifest.scripts.build.trim() === '') {
    throw new Error('Plugin package.json must declare a non-empty scripts.build')
  }
  return manifest as PluginManifest & { name: string }
}

async function copyPluginDirectory(source: string, target: string): Promise<void> {
  const info = await lstat(source)
  if (info.isSymbolicLink()) throw new Error(`Plugin snapshot does not include symbolic links: ${source}`)
  if (info.isDirectory()) {
    await mkdir(target, { mode: info.mode, recursive: true })
    const entries = await readdir(source, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      await copyPluginDirectory(join(source, entry.name), join(target, entry.name))
    }
    return
  }
  if (!info.isFile()) throw new Error(`Plugin snapshot only supports regular files and directories: ${source}`)
  await copyFile(source, target)
  await chmod(target, info.mode)
}

async function initializeRepository(root: string, name: string, commands: StudioCommandRunner): Promise<void> {
  await mkdir(join(root, 'lib'), { recursive: true })
  await writeFile(join(root, 'package.json'), templateManifest(name))
  await writeFile(join(root, 'lib/index.js'), 'export const name = "draft-host"\nexport function apply() {}\n')
  await writeFile(join(root, 'lib/client.js'), templateClient(name))
  await writeFile(join(root, 'README.md'), `# ${name}\n\nCreated by dsh-webui-studio.\n`)
  await commands.run('git', ['init', '--initial-branch=main'], root)
  await commands.run('git', ['add', '.'], root)
  await commands.run('git', ['-c', 'user.name=dsh-webui-studio', '-c', 'user.email=studio@localhost', 'commit', '-m', 'Initial Draft'], root)
}

function nextNewPluginLabel(records: readonly StudioDraftRecord[]): string {
  const labels = new Set(records.map(record => record.label))
  for (let index = records.filter(record => record.source.kind === 'new').length + 1; ; index += 1) {
    const label = `新插件_${index}`
    if (!labels.has(label)) return label
  }
}

export class StudioDraftRegistry {
  readonly root: string
  readonly recordsDir: string
  readonly repositoriesDir: string
  readonly worktreesDir: string
  readonly runtimesDir: string

  constructor(
    dshHome: string,
    private readonly commands: StudioCommandRunner = studioCommands,
  ) {
    this.root = join(dshHome, 'studio')
    this.recordsDir = join(this.root, 'drafts')
    this.repositoriesDir = join(this.root, 'repositories')
    this.worktreesDir = join(this.root, 'worktrees')
    this.runtimesDir = join(this.root, 'runtimes')
  }

  async list(): Promise<StudioDraftRecord[]> {
    await mkdir(this.recordsDir, { recursive: true })
    const files = (await readdir(this.recordsDir)).filter(file => file.endsWith('.json')).sort()
    return Promise.all(files.map(async file => JSON.parse(await readFile(join(this.recordsDir, file), 'utf8')) as StudioDraftRecord))
  }

  async get(id: string): Promise<StudioDraftRecord> {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('invalid Draft id')
    return JSON.parse(await readFile(join(this.recordsDir, `${id}.json`), 'utf8')) as StudioDraftRecord
  }

  async create(input: StudioCreateDraftInput): Promise<StudioDraftRecord> {
    if (input.profileMode === 'custom') throw new Error('Custom Draft profiles are not implemented yet')
    const id = randomUUID()
    const repositoryDir = join(this.repositoriesDir, id)
    const worktreeDir = join(this.worktreesDir, id)
    const runtimeHome = join(this.runtimesDir, id, 'dsh-home')
    await Promise.all([
      mkdir(this.recordsDir, { recursive: true }),
      mkdir(this.repositoriesDir, { recursive: true }),
      mkdir(this.worktreesDir, { recursive: true }),
      mkdir(dirname(runtimeHome), { recursive: true }),
    ])

    let name: string
    let label: string
    let source: StudioCreateDraftInput['source']
    if (input.source.kind === 'new') {
      const packageName = input.source.packageName
      if (typeof packageName !== 'string' || !PACKAGE_NAME.test(packageName)) throw new Error('New Draft package name is invalid')
      name = packageName
      label = nextNewPluginLabel(await this.list())
      source = { kind: 'new', packageName }
      await mkdir(repositoryDir)
      await initializeRepository(repositoryDir, packageName, this.commands)
      await this.commands.run('git', ['worktree', 'add', '-b', `dsh-studio/${id}`, worktreeDir, 'HEAD'], repositoryDir)
    } else {
      if (typeof input.source.directory !== 'string' || input.source.directory.trim() === '') {
        throw new Error('Existing plugin folder is required')
      }
      const directory = input.source.directory.trim()
      if (!isAbsolute(directory)) throw new Error('Existing plugin folder must be an absolute path')
      const canonicalSource = await realpath(directory)
      if (!(await lstat(canonicalSource)).isDirectory()) throw new Error('Existing plugin path must be a directory')
      const manifest = await pluginManifest(canonicalSource)
      name = manifest.name
      label = basename(canonicalSource)
      source = { kind: 'existing', directory: canonicalSource }
      await mkdir(repositoryDir)
      await copyPluginDirectory(canonicalSource, repositoryDir)
      await this.commands.run('git', ['init', '--initial-branch=main'], repositoryDir)
      await this.commands.run('git', ['add', '.'], repositoryDir)
      await this.commands.run('git', [
        '-c', 'user.name=dsh-webui-studio', '-c', 'user.email=studio@localhost',
        'commit', '-m', 'Import plugin snapshot',
      ], repositoryDir)
      await this.commands.run('git', ['worktree', 'add', '-b', `dsh-studio/${id}`, worktreeDir, 'HEAD'], repositoryDir)
    }

    const canonicalWorktree = await realpath(worktreeDir)
    const root = canonicalWorktree
    const record: StudioDraftRecord = {
      id,
      name,
      label,
      source,
      repositoryDir: await realpath(repositoryDir),
      worktreeDir: canonicalWorktree,
      root,
      runtimeHome,
      profileMode: input.profileMode,
      createdAt: new Date().toISOString(),
    }
    await writeFile(join(this.recordsDir, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' })
    return record
  }

  async rename(id: string, label: string): Promise<StudioDraftRecord> {
    const nextLabel = label.trim()
    if (nextLabel === '' || nextLabel.length > 120) throw new Error('Draft name must contain 1 to 120 characters')
    const record = await this.get(id)
    const next = { ...record, label: nextLabel }
    const file = join(this.recordsDir, `${id}.json`)
    const temporary = join(this.recordsDir, `.${id}.${randomUUID()}.tmp`)
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' })
    await rename(temporary, file)
    return next
  }
}

export function dshHomeFromProfile(profileDir: string): string {
  if (basename(dirname(profileDir)) !== 'profiles') throw new Error('Harmony profile is not under a DSH_HOME/profiles directory')
  return dirname(dirname(profileDir))
}
