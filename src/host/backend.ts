import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  StudioBuildResult,
  StudioClientRequest,
  StudioCreateDraftInput,
  StudioDraftRecord,
  StudioDraftView,
  StudioHarmonyInspection,
  StudioHarmonyService,
  StudioPreviewStatus,
  StudioPreviewUpdate,
  StudioProjectFile,
  StudioProjectState,
  StudioReadinessReport,
  StudioServerResponse,
  StudioSourceLocation,
  StudioWorkspaceState,
} from '../contracts.js'
import { StudioAgentController, type StudioAgentWorkspace } from './agent.js'
import { StudioBuildError, StudioBuildRunner } from './build.js'
import type { StudioCommandRunner, StudioDraftRegistry } from './drafts.js'
import { StudioPreviewSupervisor } from './preview.js'
import { applyProjectPatch, listProjectFiles, readProjectFile, writeProjectFile } from './project-files.js'
import { inspectReadiness, StudioPackRunner } from './readiness.js'
import { assertDraftPackageIdentity } from './runtime-profile.js'
import type { StudioWorkspaceStore } from './workspace.js'

function failure<T = never>(rpcId: string, code: string, message: string, details: unknown = {}): StudioServerResponse<T> {
  return { type: 'server-response', rpcId, result: { ok: false, error: { code, message, details } } }
}

function success<T>(rpcId: string, value: T): StudioServerResponse<T> {
  return { type: 'server-response', rpcId, result: { ok: true, value } }
}

function objectPayload(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null) throw new Error('request payload must be an object')
  return payload as Record<string, unknown>
}

function draftId(payload: unknown): string {
  const id = objectPayload(payload).draftId
  if (typeof id !== 'string') throw new Error('draftId is required')
  return id
}

class StudioDraftController implements StudioAgentWorkspace {
  private projectState?: StudioProjectState
  private previewState: StudioPreviewStatus = { connected: false, mode: 'browse' }
  private readonly builds: StudioBuildRunner
  private readonly packs: StudioPackRunner
  private readonly agent: StudioAgentController
  readonly preview: StudioPreviewSupervisor

  constructor(
    public record: StudioDraftRecord,
    profileDir: string,
    parentOrigin: string,
    commands: StudioCommandRunner,
    harmonyBinEntry: string,
    agents: AgentRegistry,
    subprocess: SubprocessRuntime,
  ) {
    this.preview = new StudioPreviewSupervisor(record, profileDir, parentOrigin, commands, harmonyBinEntry)
    this.builds = new StudioBuildRunner(subprocess)
    this.packs = new StudioPackRunner(subprocess)
    this.agent = new StudioAgentController(agents, this)
  }

  view(): StudioDraftView {
    const agent = this.agent.snapshot()
    return {
      ...this.record,
      runtime: this.preview.snapshot(),
      ...(this.projectState === undefined ? {} : { project: this.projectState }),
      ...(agent === undefined ? {} : { agent }),
    }
  }

  async start(): Promise<StudioDraftView> {
    await this.preview.start()
    this.projectState = await this.preview.state()
    return this.view()
  }

  async stop(): Promise<StudioDraftView> {
    await this.agent.dispose()
    await this.builds.cancel()
    await this.preview.stop()
    this.projectState = undefined
    this.previewState = { connected: false, mode: 'browse' }
    return this.view()
  }

  async dispose(): Promise<void> {
    await this.agent.dispose()
    await this.builds.dispose()
    await this.packs.dispose()
    await this.preview.dispose()
  }

  project(): StudioProjectState {
    if (this.projectState === undefined) throw new Error('Draft Preview Host is not running')
    return this.projectState
  }

  async refreshProject(): Promise<StudioProjectState> {
    this.projectState = await this.preview.state()
    return this.projectState
  }

  async activate(graphRev: string): Promise<StudioProjectState> {
    this.projectState = await this.preview.activate(graphRev)
    return this.projectState
  }

  selection(): StudioPreviewStatus['selection'] {
    return this.previewState.selection
  }

  updatePreview(update: StudioPreviewUpdate): StudioPreviewStatus {
    const next = { ...this.previewState, ...update } as StudioPreviewStatus & {
      selection?: StudioPreviewStatus['selection'] | null
      registry?: StudioPreviewStatus['registry'] | null
    }
    if (next.selection === null) delete next.selection
    if (next.registry === null) delete next.registry
    this.previewState = next
    return this.previewState
  }

  previewStatus(): StudioPreviewStatus {
    return this.previewState
  }

  resolveSource(source: StudioSourceLocation) {
    return this.preview.resolveSource(source)
  }

  readDependencySource(packageName: string, file: string): Promise<string> {
    return this.preview.readDependencySource(packageName, file)
  }

  async inspectHarmony(input: { package?: string; file?: string }): Promise<StudioHarmonyInspection> {
    return (await this.preview.inspect(input)).harmony
  }

  async readiness(): Promise<StudioReadinessReport> {
    const inspection = await this.preview.inspect()
    return inspectReadiness(
      this.record.root,
      this.record.name,
      inspection.harmony,
      `${this.record.runtimeHome}/profiles/web`,
      inspection.dependencies,
    )
  }

  async pack(): Promise<StudioReadinessReport> {
    const report = await this.readiness()
    report.pack = await this.packs.run(this.record.root)
    return report
  }

  async readFile(path: string): Promise<string> {
    return readProjectFile(this.record.root, path)
  }

  async applyPatch(path: string, before: string, after: string): Promise<'created' | 'updated'> {
    return applyProjectPatch(this.record.root, path, before, after)
  }

  async build(signal: AbortSignal): Promise<StudioBuildResult> {
    const current = this.project()
    if (current.state !== 'active') throw new Error('Draft must be active before it can be built')
    await assertDraftPackageIdentity(this.record)
    const build = await this.builds.run(current.root, signal)
    this.projectState = await this.preview.applyBuild()
    return { build, project: this.projectState }
  }

  cancelBuild(): Promise<boolean> {
    return this.builds.cancel()
  }

  createAgent(agentPreset?: string): Promise<{ sessionId: string; agentPreset?: string }> {
    return this.agent.create(agentPreset)
  }

  async disposeAgent(): Promise<void> {
    await this.agent.dispose()
  }
}

/** Stable-Host control plane for persistent, isolated Draft Preview runtimes. */
export class StudioBackend {
  private readonly controllers = new Map<string, StudioDraftController>()
  private readonly controllerCreations = new Map<string, Promise<StudioDraftController>>()

  constructor(
    private readonly harmony: StudioHarmonyService,
    private readonly agents: AgentRegistry,
    private readonly subprocess: SubprocessRuntime,
    private readonly registry: StudioDraftRegistry,
    private readonly workspace: StudioWorkspaceStore,
    private readonly commands: StudioCommandRunner,
    private readonly parentOrigin: string,
  ) {}

  async call(message: StudioClientRequest): Promise<StudioServerResponse> {
    const { method, payload, rpcId } = message
    try {
      if (method === 'studio.drafts.list') return success(rpcId, await this.list())
      if (method === 'studio.drafts.create') return success(rpcId, await this.create(payload))
      if (method === 'studio.workspace.get') {
        const records = await this.registry.list()
        return success(rpcId, await this.workspace.read(records.map(record => record.id)))
      }
      if (method === 'studio.workspace.update') {
        const records = await this.registry.list()
        return success(rpcId, await this.workspace.write(
          objectPayload(payload) as unknown as StudioWorkspaceState,
          records.map(record => record.id),
        ))
      }
      const controller = await this.controller(draftId(payload))
      if (method === 'studio.drafts.rename') {
        const label = objectPayload(payload).label
        if (typeof label !== 'string') throw new Error('Draft name is required')
        const record = await this.registry.rename(controller.record.id, label)
        controller.record = record
        return success(rpcId, controller.view())
      }
      if (method === 'studio.drafts.export') {
        const record = await this.registry.export(controller.record.id)
        controller.record = record
        return success(rpcId, controller.view())
      }
      if (method === 'studio.drafts.start') return success(rpcId, await controller.start())
      if (method === 'studio.drafts.stop') return success(rpcId, await controller.stop())
      if (method === 'studio.project.state') return success(rpcId, await controller.refreshProject())
      if (method === 'studio.project.activate') {
        const graphRev = objectPayload(payload).graphRev
        if (typeof graphRev !== 'string') throw new Error('graphRev is required')
        return success(rpcId, await controller.activate(graphRev))
      }
      if (method === 'studio.project.files') return success(rpcId, await listProjectFiles(controller.record.root))
      if (method === 'studio.project.readFile') {
        const path = objectPayload(payload).path
        if (typeof path !== 'string') throw new Error('path is required')
        return success(rpcId, { path, content: await controller.readFile(path) })
      }
      if (method === 'studio.project.writeFile') {
        const { path, content } = objectPayload(payload)
        if (typeof path !== 'string' || typeof content !== 'string') throw new Error('path and content are required')
        await writeProjectFile(controller.record.root, path, content)
        return success(rpcId, { path, saved: true })
      }
      if (method === 'studio.project.build') return success(rpcId, await controller.build(new AbortController().signal))
      if (method === 'studio.project.cancelBuild') return success(rpcId, { canceled: await controller.cancelBuild() })
      if (method === 'studio.readiness.inspect') return success(rpcId, await controller.readiness())
      if (method === 'studio.readiness.pack') return success(rpcId, await controller.pack())
      if (method === 'studio.harmony.inspect') {
        const input = objectPayload(payload)
        return success(rpcId, await controller.inspectHarmony({
          ...(typeof input.package === 'string' ? { package: input.package } : {}),
          ...(typeof input.file === 'string' ? { file: input.file } : {}),
        }))
      }
      if (method === 'studio.preview.status') return success(rpcId, controller.previewStatus())
      if (method === 'studio.preview.update') return success(rpcId, controller.updatePreview(this.previewStatus(payload)))
      if (method === 'studio.preview.resolveSource') {
        const source = objectPayload(payload).source as Partial<StudioSourceLocation> | undefined
        if (typeof source?.file !== 'string') throw new Error('source is required')
        return success(rpcId, await controller.resolveSource(source as StudioSourceLocation))
      }
      if (method === 'studio.agent.create') {
        const preset = objectPayload(payload).agentPreset
        if (preset !== undefined && typeof preset !== 'string') throw new Error('agentPreset must be a string')
        return success(rpcId, await controller.createAgent(preset))
      }
      if (method === 'studio.agent.dispose') {
        await controller.disposeAgent()
        return success(rpcId, { disposed: true })
      }
      return failure(rpcId, 'studio-method-forbidden', `method ${method} is not exposed by Studio`)
    } catch (error) {
      const code = error instanceof StudioBuildError ? error.code : 'studio-request-failed'
      const details = error instanceof StudioBuildError ? error.output : undefined
      return failure(rpcId, code, error instanceof Error ? error.message : String(error), details)
    }
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.controllerCreations.values()].map(creation => creation.catch(() => undefined)))
    await Promise.all([...this.controllers.values()].map(controller => controller.dispose()))
    this.controllers.clear()
    this.controllerCreations.clear()
  }

  private async list(): Promise<StudioDraftView[]> {
    const records = await this.registry.list()
    return records.map(record => this.controllers.get(record.id)?.view() ?? {
      ...record,
      runtime: { state: 'stopped' as const, log: '' },
    })
  }

  private async create(payload: unknown): Promise<StudioDraftView> {
    const candidate = objectPayload(payload) as unknown as StudioCreateDraftInput
    if ((candidate.profileMode !== 'main-home' && candidate.profileMode !== 'custom')
      || typeof candidate.source !== 'object' || candidate.source === null
      || (candidate.source.kind !== 'new' && candidate.source.kind !== 'existing')
      || (candidate.destinationDirectory !== undefined && typeof candidate.destinationDirectory !== 'string')) {
      throw new Error('Draft source and profileMode are invalid')
    }
    const record = await this.registry.create(candidate)
    return this.makeController(record).view()
  }

  private async controller(id: string): Promise<StudioDraftController> {
    const current = this.controllers.get(id)
    if (current !== undefined) return current
    const pending = this.controllerCreations.get(id)
    if (pending !== undefined) return pending
    const creation = this.registry.get(id).then(record => this.controllers.get(id) ?? this.makeController(record))
    this.controllerCreations.set(id, creation)
    try {
      return await creation
    } finally {
      if (this.controllerCreations.get(id) === creation) this.controllerCreations.delete(id)
    }
  }

  private makeController(record: StudioDraftRecord): StudioDraftController {
    const controller = new StudioDraftController(
      record,
      this.harmony.profileDir,
      this.parentOrigin,
      this.commands,
      this.harmony.binEntry,
      this.agents,
      this.subprocess,
    )
    this.controllers.set(record.id, controller)
    return controller
  }

  private previewStatus(payload: unknown): StudioPreviewUpdate {
    const candidate = objectPayload(payload) as unknown as Partial<StudioPreviewUpdate>
    if (typeof candidate.connected !== 'boolean' || (candidate.mode !== 'browse' && candidate.mode !== 'inspect')
      || (candidate.graphRev !== undefined && typeof candidate.graphRev !== 'string')) {
      throw new Error('Preview status is invalid')
    }
    if (candidate.registry !== undefined && candidate.registry !== null && (typeof candidate.registry !== 'object'
      || !Array.isArray(candidate.registry.elements) || !Array.isArray(candidate.registry.variables))) {
      throw new Error('Preview registry is invalid')
    }
    return {
      connected: candidate.connected,
      mode: candidate.mode,
      ...(candidate.graphRev === undefined ? {} : { graphRev: candidate.graphRev }),
      ...(candidate.selection === undefined ? {} : { selection: candidate.selection }),
      ...(candidate.registry === undefined ? {} : { registry: candidate.registry }),
    }
  }
}
