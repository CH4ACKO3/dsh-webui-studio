import { createRequire } from 'node:module'
import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { StudioDraftRecord } from '../contracts.js'
import type { StudioCommandRunner } from './drafts.js'

const PROFILE_FILES = ['cordis.patch.yml', 'cordis.yml', 'harmony.json', 'pnpm-workspace.yaml'] as const
const READY_FILE = '.dsh-studio-profile-ready'
const require = createRequire(import.meta.url)
const PNPM_ENTRY = join(dirname(require.resolve('pnpm')), 'bin', 'pnpm.cjs')

interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
  [key: string]: unknown
}

export function bundledPnpmCommand(args: readonly string[]): [string, string[]] {
  return [process.execPath, [PNPM_ENTRY, ...args]]
}

function terminalToken(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`
}

export function terminalCommandLine(cwd: string, command: string, args: readonly string[]): string {
  return `${cwd}\n$ ${[command, ...args].map(terminalToken).join(' ')}\n`
}

function absoluteLink(spec: string, profileDir: string): string {
  if (!spec.startsWith('link:')) return spec
  const target = spec.slice('link:'.length)
  return `link:${isAbsolute(target) ? target : resolve(profileDir, target)}`
}

export async function materializeDraftProfile(
  draft: StudioDraftRecord,
  mainProfileDir: string,
  studioPackageRoot: string,
  commands: StudioCommandRunner,
  onOutput?: (chunk: string) => void,
): Promise<string> {
  if (draft.profileMode !== 'main-home') throw new Error('Custom Draft profiles are not implemented yet')
  const profileDir = join(draft.runtimeHome, 'profiles', 'web')
  try {
    await access(join(profileDir, READY_FILE))
    return profileDir
  } catch {}
  await rm(profileDir, { recursive: true, force: true })
  await mkdir(profileDir, { recursive: true })
  const manifest = JSON.parse(await readFile(join(mainProfileDir, 'package.json'), 'utf8')) as ProfileManifest
  const dependencies = Object.fromEntries(
    Object.entries(manifest.dependencies ?? {}).map(([name, spec]) => [name, absoluteLink(spec, mainProfileDir)]),
  )
  dependencies[draft.name] = `link:${draft.root}`
  dependencies['dsh-webui-studio'] = `link:${studioPackageRoot}`
  await writeFile(join(profileDir, 'package.json'), `${JSON.stringify({ ...manifest, dependencies }, null, 2)}\n`)
  for (const file of PROFILE_FILES) {
    try {
      await cp(join(mainProfileDir, file), join(profileDir, file))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  const [command, args] = bundledPnpmCommand(['install', '--prefer-offline'])
  onOutput?.(terminalCommandLine(profileDir, command, args))
  try {
    await commands.run(command, args, profileDir, onOutput)
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).split('\n', 1)[0]
    onOutput?.(`[studio] ${message}\n`)
    throw new Error('Profile dependency installation failed. Check the startup terminal for details.')
  }
  await writeFile(join(profileDir, READY_FILE), `${new Date().toISOString()}\n`)
  return profileDir
}
