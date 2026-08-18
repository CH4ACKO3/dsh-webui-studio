import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  StudioBuildResult,
  StudioAgentContext,
  StudioAutomaticPatchPlan,
  StudioAutomaticPatchRequest,
  StudioAutomaticPatchWriteResult,
  StudioClientRequest,
  StudioCreateDraftInput,
  StudioDraftRecord,
  StudioDraftView,
  StudioHarmonyInspection,
  StudioHarmonyProfileUpdateResult,
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
import { analyzeAutomaticPatch, writeAutomaticPatch } from './automatic-patch.js'
import { StudioBuildError, StudioBuildRunner } from './build.js'
import type { StudioCommandRunner, StudioDraftRegistry } from './drafts.js'
import { saveElementsDefaults as saveElementsDefaultsToProject } from './element-source.js'
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

function optionalStringList(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.length === 0)) {
    throw new Error(`${field} must be an array of non-empty strings`)
  }
  return value
}

function automaticPatchRequest(payload: unknown): StudioAutomaticPatchRequest {
  const input = objectPayload(payload)
  if (input.kind !== 'replace-string') throw new Error('automatic Patch kind must be replace-string')
  if (!Array.isArray(input.targets) || input.targets.length === 0) {
    throw new Error('automatic Patch targets must be a non-empty array')
  }
  const targets = input.targets.map((value, index) => {
    if (typeof value !== 'object' || value === null) throw new Error(`automatic Patch target ${index} must be an object`)
    const target = value as Record<string, unknown>
    if (typeof target.package !== 'string' || target.package === '' || typeof target.file !== 'string' || target.file === '') {
      throw new Error(`automatic Patch target ${index} requires package and file`)
    }
    return { package: target.package, file: target.file }
  })
  if (typeof input.text !== 'string' || typeof input.replacement !== 'string') {
    throw new Error('automatic string Patch requires text and replacement strings')
  }
  return { kind: input.kind, targets, text: input.text, replacement: input.replacement }
}

class StudioDraftController implements StudioAgentWorkspace {
  private projectState?: StudioProjectState
  private previewState: StudioPreviewStatus = { connected: false, mode: 'browse' }
  private readonly builds: StudioBuildRunner
  private readonly packs: StudioPackRunner
  private readonly agent: StudioAgentController
  private automaticPatchWrites: Promise<void> = Promise.resolve()
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

  async context(): Promise<StudioAgentContext> {
    const selection = this.selection()
    const refs = new Map<string, { package: string; file: string }>()
    for (const patch of selection?.react?.patches ?? []) {
      const key = `${patch.target.package}\0${patch.target.file}`
      refs.set(key, patch.target)
    }
    const source = selection?.react?.source?.resolved
    if (source?.package !== undefined) {
      const key = `${source.package}\0${source.file}`
      refs.set(key, { package: source.package, file: source.file })
    }
    const allTargetRefs = [...refs.values()]
    const targetRefs = allTargetRefs.slice(0, 8)
    const inspections = await Promise.all(targetRefs.map(ref => this.inspectHarmony(ref)))
    const inspectedHarmony = inspections.length === 0 ? null : {
      patches: [...new Map(inspections.flatMap(item => item.patches).map(patch => [patch.key, patch])).values()],
      targets: [...new Map(inspections.flatMap(item => item.targets).map(target => [`${target.package}\0${target.file}`, target])).values()],
    }
    const harmony = inspectedHarmony !== null && Buffer.byteLength(JSON.stringify(inspectedHarmony)) <= 256 * 1024
      ? inspectedHarmony : null
    const readiness = await this.readiness()
    return {
      selection: selection ?? null,
      project: this.project(),
      preview: this.previewStatus(),
      projectFiles: await listProjectFiles(this.record.root),
      harmony,
      targetRefs,
      targetRefsTruncated: targetRefs.length < allTargetRefs.length,
      readiness: { findings: readiness.findings },
    }
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

  async saveElementDefaults(): Promise<{ files: string[] }> {
    const elements = this.previewStatus().registry?.elements.filter(item => item.owner === this.record.name) ?? []
    if (elements.length === 0) throw new Error('No Elements are registered by the active Draft')
    return saveElementsDefaultsToProject(this.record.root, elements)
  }

  async analyzeAutomaticPatch(request: StudioAutomaticPatchRequest): Promise<StudioAutomaticPatchPlan> {
    const sources = await Promise.all(request.targets.map(target => this.preview.readPatchTarget(target.package, target.file)))
    return analyzeAutomaticPatch(request, sources)
  }

  async createAutomaticPatch(request: StudioAutomaticPatchRequest): Promise<StudioAutomaticPatchWriteResult> {
    const run = this.automaticPatchWrites.then(async () => {
      const plan = await this.analyzeAutomaticPatch(request)
      return writeAutomaticPatch(this.record.root, plan)
    })
    this.automaticPatchWrites = run.then(() => undefined, () => undefined)
    return run
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
      if (method === 'studio.harmony.profile') return success(rpcId, this.harmony.profile())
      if (method === 'studio.harmony.updateProfile') {
        const input = objectPayload(payload)
        const order = optionalStringList(input.order, 'order')
        const disabled = optionalStringList(input.disabled, 'disabled')
        const update: { order?: string[]; disabled?: string[] } = {
          ...(order === undefined ? {} : { order }),
          ...(disabled === undefined ? {} : { disabled }),
        }
        return success<StudioHarmonyProfileUpdateResult>(rpcId, await this.harmony.updateProfile(update))
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
      if (method === 'studio.elements.saveDefaults') {
        objectPayload(payload)
        return success(rpcId, await controller.saveElementDefaults())
      }
      if (method === 'studio.patches.analyzeAutomatic') {
        return success(rpcId, await controller.analyzeAutomaticPatch(automaticPatchRequest(payload)))
      }
      if (method === 'studio.patches.createAutomatic') {
        return success(rpcId, await controller.createAutomaticPatch(automaticPatchRequest(payload)))
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
      || (candidate.profileDirectory !== undefined && typeof candidate.profileDirectory !== 'string')
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
