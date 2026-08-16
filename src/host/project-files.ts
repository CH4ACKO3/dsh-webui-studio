import { randomUUID } from 'node:crypto'
import { lstat, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

const MAX_FILE_BYTES = 1024 * 1024
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules'])

export interface StudioProjectFile {
  path: string
  size: number
}

function inside(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function relativePath(input: string): string {
  if (input === '' || isAbsolute(input) || input.includes('\\')) throw new Error('path must be a relative project path')
  const parts = input.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) throw new Error('path contains an invalid segment')
  return parts.join(sep)
}

async function projectRoot(root: string): Promise<string> {
  return realpath(root)
}

async function existingPath(root: string, input: string): Promise<string> {
  const base = await projectRoot(root)
  const target = await realpath(resolve(base, relativePath(input)))
  if (!inside(base, target)) throw new Error('path escapes the Draft root')
  return target
}

export async function listProjectFiles(root: string): Promise<StudioProjectFile[]> {
  const base = await projectRoot(root)
  const files: StudioProjectFile[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) await walk(absolute)
        continue
      }
      if (!entry.isFile()) continue
      const info = await lstat(absolute)
      files.push({ path: relative(base, absolute).split(sep).join('/'), size: info.size })
    }
  }
  await walk(base)
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

export async function readProjectFile(root: string, path: string): Promise<string> {
  const target = await existingPath(root, path)
  const info = await lstat(target)
  if (!info.isFile()) throw new Error('path does not point to a file')
  if (info.size > MAX_FILE_BYTES) throw new Error('file exceeds the 1 MiB Studio limit')
  const content = await readFile(target)
  if (content.includes(0)) throw new Error('binary files cannot be opened in Studio')
  return content.toString('utf8')
}

export async function writeProjectFile(root: string, path: string, content: string): Promise<void> {
  if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new Error('file exceeds the 1 MiB Studio limit')
  const base = await projectRoot(root)
  const target = resolve(base, relativePath(path))
  if (!inside(base, target)) throw new Error('path escapes the Draft root')
  const parent = await realpath(resolve(target, '..'))
  if (!inside(base, parent)) throw new Error('path parent escapes the Draft root')
  try {
    if ((await lstat(target)).isSymbolicLink()) throw new Error('Studio does not write through symbolic links')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const temporary = join(parent, `.${randomUUID()}.dsh-studio.tmp`)
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' })
    await rename(temporary, target)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

export async function applyProjectPatch(root: string, path: string, before: string, after: string): Promise<'created' | 'updated'> {
  let source: string
  try {
    source = await readProjectFile(root, path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    if (before !== '') throw new Error('cannot patch a missing file unless before is empty')
    await writeProjectFile(root, path, after)
    return 'created'
  }
  const first = source.indexOf(before)
  if (first === -1) throw new Error('patch before text was not found')
  if (source.indexOf(before, first + before.length) !== -1) throw new Error('patch before text is not unique')
  await writeProjectFile(root, path, `${source.slice(0, first)}${after}${source.slice(first + before.length)}`)
  return 'updated'
}
