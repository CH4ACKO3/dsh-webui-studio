import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StudioSourceCandidate, StudioSourceLocation } from '../contracts.js'

interface PackageRoot {
  name: string
  root: string
  kind: 'draft' | 'dependency'
}

interface SourceReference {
  absolute?: string
  relative?: string
  package?: string
  generated: boolean
}

interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

const MAX_SOURCE_BYTES = 1024 * 1024

function inside(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function posix(path: string): string {
  return path.split(sep).join('/')
}

function relativeSource(path: string): string | undefined {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '')
  if (normalized === '' || normalized.startsWith('/') || normalized.split('/').some(part => part === '' || part === '.' || part === '..')) {
    return undefined
  }
  return normalized
}

function sourceReference(file: string): SourceReference {
  const trimmed = file.trim()
  if (trimmed.startsWith('file:')) {
    try {
      return { absolute: fileURLToPath(trimmed), generated: false }
    } catch {
      return { generated: false }
    }
  }
  if (trimmed.startsWith('/@fs/')) return { absolute: trimmed.slice('/@fs'.length).replace(/[?#].*$/, ''), generated: false }
  if (isAbsolute(trimmed)) return { absolute: trimmed.replace(/[?#].*$/, ''), generated: false }
  const bundler = trimmed.match(/^(?:webpack|webpack-internal|vite):\/\/(.*)$/)
  if (bundler !== null) {
    const body = bundler[1]!.replace(/[?#].*$/, '')
    const relativeMarker = body.indexOf('/./')
    if (relativeMarker !== -1) {
      const packageName = body.slice(0, relativeMarker).replace(/^\/+|\/+$/g, '')
      return {
        relative: relativeSource(body.slice(relativeMarker + 3)),
        ...(packageName === '' ? {} : { package: packageName }),
        generated: true,
      }
    }
    if (body.startsWith('/')) return { absolute: body.replace(/^\/{2}/, '/'), generated: true }
    return { generated: true }
  }
  if (/^https?:\/\//.test(trimmed)) return { generated: true }
  return { relative: relativeSource(trimmed.replace(/[?#].*$/, '')), generated: false }
}

async function packageRoot(path: string, expectedName: string): Promise<PackageRoot | undefined> {
  try {
    const root = await realpath(path)
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { name?: unknown }
    return manifest.name === expectedName ? { name: expectedName, root, kind: 'dependency' } : undefined
  } catch {
    return undefined
  }
}

async function packageRoots(draftRoot: string, profileDir: string): Promise<PackageRoot[]> {
  const draft = await realpath(draftRoot)
  const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as ProfileManifest
  const dependencies = Object.keys(manifest.dependencies ?? {})
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const roots: PackageRoot[] = [{
    name: JSON.parse(await readFile(join(draft, 'package.json'), 'utf8')).name as string,
    root: draft,
    kind: 'draft',
  }]
  for (const name of dependencies) {
    const installed = await packageRoot(join(profileDir, 'node_modules', ...name.split('/')), name)
    if (installed !== undefined) roots.push(installed)
  }
  for (const name of bundles.filter(name => !dependencies.includes(name))) {
    const installed = await packageRoot(join(profileDir, 'node_modules', ...name.split('/')), name)
    if (installed !== undefined) roots.push(installed)
  }
  return roots.filter((item, index, all) => all.findIndex(candidate => candidate.root === item.root) === index)
}

function result(
  source: StudioSourceLocation,
  file: string,
  kind: StudioSourceCandidate['kind'],
  confidence: StudioSourceCandidate['confidence'],
  packageName?: string,
): StudioSourceCandidate {
  return {
    ...(packageName === undefined ? {} : { package: packageName }),
    file: file.slice(0, 4_000),
    ...(source.line === undefined ? {} : { line: source.line }),
    ...(source.column === undefined ? {} : { column: source.column }),
    kind,
    confidence,
  }
}

async function exactMatch(path: string, roots: PackageRoot[]): Promise<{ root: PackageRoot; file: string } | undefined> {
  let target: string
  try {
    target = await realpath(path)
  } catch {
    return undefined
  }
  const matches = roots.filter(item => inside(item.root, target)).sort((left, right) => right.root.length - left.root.length)
  const root = matches[0]
  return root === undefined ? undefined : { root, file: posix(relative(root.root, target)) }
}

export class StudioSourceResolver {
  readonly #roots: Promise<PackageRoot[]>

  constructor(draftRoot: string, profileDir: string) {
    this.#roots = packageRoots(draftRoot, profileDir)
  }

  async resolve(source: StudioSourceLocation): Promise<StudioSourceCandidate> {
    const roots = await this.#roots
    const reference = sourceReference(source.file)
    if (reference.absolute !== undefined) {
      const match = await exactMatch(reference.absolute, roots)
      if (match !== undefined) return result(source, match.file, match.root.kind, 'exact', match.root.name)
    }
    if (reference.relative !== undefined) {
      const candidates = roots.filter(root => reference.package === undefined || root.name === reference.package)
      const matches = (await Promise.all(candidates.map(async root => {
        const match = await exactMatch(resolve(root.root, reference.relative!), [root])
        return match === undefined ? undefined : { root, file: match.file }
      }))).filter(match => match !== undefined)
      const unique = matches.filter((match, index, all) => all.findIndex(candidate => candidate.root.root === match.root.root && candidate.file === match.file) === index)
      if (unique.length === 1) return result(source, unique[0]!.file, unique[0]!.root.kind, 'candidate', unique[0]!.root.name)
    }
    return result(source, source.file, reference.generated ? 'generated' : 'unknown', 'candidate')
  }

  async readDependency(packageName: string, file: string): Promise<string> {
    return (await this.readDependencyTarget(packageName, file)).source
  }

  async readDependencyTarget(packageName: string, file: string): Promise<{
    package: string
    file: string
    version: string
    source: string
  }> {
    const relativeFile = relativeSource(file)
    if (packageName === '' || relativeFile === undefined) throw new Error('dependency source reference is invalid')
    const roots = (await this.#roots).filter(root => root.kind === 'dependency' && root.name === packageName)
    if (roots.length !== 1) throw new Error(`dependency package ${JSON.stringify(packageName)} is not uniquely installed in Preview`)
    const match = await exactMatch(resolve(roots[0]!.root, relativeFile), roots)
    if (match === undefined || match.root !== roots[0] || match.file !== relativeFile) {
      throw new Error('dependency source escapes its installed package root')
    }
    const target = resolve(match.root.root, match.file)
    const info = await lstat(target)
    if (!info.isFile()) throw new Error('dependency source is not a file')
    if (info.size > MAX_SOURCE_BYTES) throw new Error('dependency source exceeds the 1 MiB Studio limit')
    const content = await readFile(target)
    if (content.includes(0)) throw new Error('binary dependency sources cannot be read')
    const manifest = JSON.parse(await readFile(join(roots[0]!.root, 'package.json'), 'utf8')) as { version?: unknown }
    if (typeof manifest.version !== 'string' || manifest.version === '') {
      throw new Error(`dependency package ${JSON.stringify(packageName)} does not declare a version`)
    }
    return { package: packageName, file: relativeFile, version: manifest.version, source: content.toString('utf8') }
  }
}
