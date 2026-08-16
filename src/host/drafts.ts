import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
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

function inside(root: string, path: string): boolean {
  const child = relative(root, path)
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child))
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

async function packageName(root: string): Promise<string> {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { name?: unknown }
  if (typeof manifest.name !== 'string' || manifest.name === '') throw new Error('Draft package.json must declare a name')
  return manifest.name
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

    let packagePath = ''
    if (input.source.kind === 'new') {
      if (!PACKAGE_NAME.test(input.source.packageName)) throw new Error('New Draft package name is invalid')
      await mkdir(repositoryDir)
      await initializeRepository(repositoryDir, input.source.packageName, this.commands)
      await this.commands.run('git', ['worktree', 'add', '-b', `dsh-studio/${id}`, worktreeDir, 'HEAD'], repositoryDir)
    } else {
      if (input.source.repository.trim() === '') throw new Error('Existing Draft repository is required')
      await this.commands.run('git', ['clone', '--no-checkout', '--', input.source.repository, repositoryDir])
      await this.commands.run('git', [
        'worktree', 'add', '-b', `dsh-studio/${id}`, worktreeDir, input.source.ref?.trim() || 'HEAD',
      ], repositoryDir)
      packagePath = input.source.packagePath?.trim() ?? ''
    }

    const canonicalWorktree = await realpath(worktreeDir)
    const root = await realpath(resolve(canonicalWorktree, packagePath))
    if (!inside(canonicalWorktree, root)) throw new Error('Draft package path escapes its worktree')
    const name = await packageName(root)
    const record: StudioDraftRecord = {
      id,
      name,
      source: input.source,
      repositoryDir: await realpath(repositoryDir),
      worktreeDir: canonicalWorktree,
      packagePath,
      root,
      runtimeHome,
      profileMode: input.profileMode,
      createdAt: new Date().toISOString(),
    }
    await writeFile(join(this.recordsDir, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' })
    return record
  }
}

export function dshHomeFromProfile(profileDir: string): string {
  if (basename(dirname(profileDir)) !== 'profiles') throw new Error('Harmony profile is not under a DSH_HOME/profiles directory')
  return dirname(dirname(profileDir))
}
