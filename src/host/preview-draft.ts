import { readFileSync, realpathSync } from 'node:fs'
import { createRequire, findPackageJSON } from 'node:module'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { StudioHarmonyService, StudioProjectState } from '../contracts.js'
import { studioCommands, type StudioCommandRunner } from './drafts.js'

const CLIENT_ENTRY_TIMEOUT_MS = 10_000
const HARMONY_BIN_ENTRY = fileURLToPath(import.meta.resolve('dsh-harmony/bin'))

function packageNameOf(specifier: string): string | undefined {
  const clean = specifier.replace(/\?dsh-harmony=\d+$/, '')
  if (clean.startsWith('.') || clean.startsWith('/') || clean.startsWith('file:') || clean.includes(':')) return undefined
  return clean.startsWith('@') ? clean.split('/').slice(0, 2).join('/') : clean.split('/')[0]
}

function resolveDraft(profileDir: string, inputRoot: string): { name: string; root: string } {
  if (!isAbsolute(inputRoot)) throw new Error('harmony-studio: Draft root must be an absolute path')
  const root = realpathSync(inputRoot)
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    name?: unknown
    dsh?: { client?: { platform?: unknown } }
  }
  if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
    throw new Error('harmony-studio: Draft package name must be a non-empty string')
  }
  if (manifest.dsh?.client?.platform !== 'web') {
    throw new Error(`harmony-studio: Draft ${JSON.stringify(manifest.name)} must declare dsh.client.platform as "web"`)
  }
  const profileManifest = join(profileDir, 'package.json')
  const profile = JSON.parse(readFileSync(profileManifest, 'utf8')) as { dependencies?: Record<string, string> }
  if (!(manifest.name in (profile.dependencies ?? {}))) {
    throw new Error(`harmony-studio: Draft ${JSON.stringify(manifest.name)} is not a dependency of the Preview profile`)
  }
  const installedManifest = findPackageJSON(manifest.name, pathToFileURL(profileManifest))
  if (installedManifest === undefined || realpathSync(dirname(installedManifest)) !== root) {
    throw new Error(`harmony-studio: Draft ${JSON.stringify(manifest.name)} is not linked to the selected root`)
  }
  try {
    createRequire(profileManifest).resolve(`${manifest.name}/client`)
  } catch {
    throw new Error(`harmony-studio: Draft ${JSON.stringify(manifest.name)} must export "./client"`)
  }
  return { name: manifest.name, root }
}

export class StudioPreviewDraft {
  private readonly name: string
  private readonly root: string
  private entryId?: string
  private createdEntry = false
  private project?: StudioProjectState

  constructor(
    private readonly ctx: Context,
    private readonly harmony: StudioHarmonyService,
    root: string,
    private readonly commands: StudioCommandRunner = studioCommands,
  ) {
    const draft = resolveDraft(harmony.profile().dir, root)
    this.name = draft.name
    this.root = draft.root
  }

  async open(): Promise<this> {
    const entries = [...this.ctx.loader.entries()].filter(entry => packageNameOf(entry.options.name) === this.name)
    if (entries.length > 1) throw new Error(`harmony-studio: Draft ${JSON.stringify(this.name)} has multiple Loader entries`)
    try {
      if (entries.length === 1) {
        this.entryId = entries[0]!.id
      } else {
        this.entryId = await this.ctx.loader.create({ name: this.name })
        this.createdEntry = true
      }
      await this.waitForClientEntry()
      await this.reload()
      const graph = this.ctx.clientModules.graph()
      if (!graph.entries.some(entry => entry.id === this.name)) {
        throw new Error(`harmony-studio: Draft ${JSON.stringify(this.name)} left the client graph while loading its Patches`)
      }
      this.project = { name: this.name, root: this.root, state: 'preview-pending', graphRev: graph.rev }
      return this
    } catch (error) {
      if (!this.createdEntry || this.entryId === undefined) throw error
      const cleanupErrors: unknown[] = []
      try {
        await this.ctx.loader.remove(this.entryId)
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
      try {
        await this.reload()
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError([error, ...cleanupErrors], 'harmony-studio: failed to clean up Draft after Preview startup failed')
      }
      throw error
    }
  }

  snapshot(): StudioProjectState {
    if (this.project === undefined) throw new Error('harmony-studio: Draft Preview is still preparing')
    return { ...this.project }
  }

  activate(graphRev: string): StudioProjectState {
    if (this.project?.state !== 'preview-pending') throw new Error('harmony-studio: Draft is not waiting for Preview confirmation')
    const graph = this.ctx.clientModules.graph()
    if (graph.rev !== graphRev || !graph.entries.some(entry => entry.id === this.name)) {
      throw new Error('harmony-studio: Preview did not confirm the current Draft client graph')
    }
    this.project = { ...this.project, state: 'active', graphRev }
    return this.snapshot()
  }

  async applyBuild(): Promise<StudioProjectState> {
    if (this.project?.state !== 'active') throw new Error('harmony-studio: Draft is not active')
    const graph = this.ctx.clientModules.graph()
    if (!graph.entries.some(entry => entry.id === this.name)) {
      throw new Error(`harmony-studio: Draft ${JSON.stringify(this.name)} left the client graph while applying its build`)
    }
    this.project = { ...this.project, state: 'preview-pending', graphRev: graph.rev }
    return this.snapshot()
  }

  async close(): Promise<void> {
    if (this.project?.state === 'closed') return
    if (this.createdEntry && this.entryId !== undefined) {
      await this.ctx.loader.remove(this.entryId)
      await this.reload()
    }
    this.project = { name: this.name, root: this.root, state: 'closed', graphRev: this.project?.graphRev ?? '' }
  }

  private async waitForClientEntry(): Promise<void> {
    const modules = this.ctx.clientModules
    if (modules.graph().entries.some(entry => entry.id === this.name)) return
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        stop()
        reject(new Error(`harmony-studio: Draft ${JSON.stringify(this.name)} did not enter the client graph`))
      }, CLIENT_ENTRY_TIMEOUT_MS)
      const stop = modules.onGraphChanged(() => {
        if (!modules.graph().entries.some(entry => entry.id === this.name)) return
        clearTimeout(timeout)
        stop()
        resolve()
      })
    })
  }

  private reload(): Promise<void> {
    return this.commands.run(process.execPath, [HARMONY_BIN_ENTRY, 'harmony', 'reload', this.name])
  }
}
