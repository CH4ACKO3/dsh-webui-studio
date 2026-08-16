import { randomBytes } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type {
  StudioDraftRecord,
  StudioPreviewInspection,
  StudioProjectState,
  StudioSourceCandidate,
  StudioSourceLocation,
} from '../contracts.js'
import { STUDIO_PREVIEW_API_PATH } from '../contracts.js'
import type { StudioCommandRunner } from './drafts.js'
import { installDraftDependencies, materializeDraftProfile, terminalCommandLine } from './runtime-profile.js'

const START_TIMEOUT_MS = 30_000
const LOG_LIMIT = 64_000

export interface StudioPreviewRuntime {
  state: 'stopped' | 'starting' | 'running' | 'failed'
  previewUrl?: string
  bridgeCapability?: string
  error?: string
  log: string
}

interface WorkerState {
  project: StudioProjectState
}

function appendLog(current: string, chunk: Buffer | string): string {
  return `${current}${chunk.toString()}`.slice(-LOG_LIMIT)
}

function studioPackageRoot(): string {
  return fileURLToPath(new URL('../../', import.meta.url))
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise(resolve => {
    const exited = (): void => {
      clearTimeout(timeout)
      resolve(true)
    }
    const timeout = setTimeout(() => {
      child.removeListener('exit', exited)
      resolve(false)
    }, timeoutMs)
    child.once('exit', exited)
  })
}

export class StudioPreviewSupervisor {
  private child?: ChildProcess
  private controlToken?: string
  private runtime: StudioPreviewRuntime = { state: 'stopped', log: '' }

  constructor(
    readonly draft: StudioDraftRecord,
    private readonly mainProfileDir: string,
    private readonly parentOrigin: string,
    private readonly commands: StudioCommandRunner,
    private readonly harmonyBinEntry: string,
    private readonly stopTimeoutMs = 5_000,
  ) {}

  snapshot(): StudioPreviewRuntime {
    return { ...this.runtime }
  }

  async start(): Promise<StudioPreviewRuntime> {
    if (this.runtime.state === 'running' || this.runtime.state === 'starting') return this.snapshot()
    this.runtime = { state: 'starting', log: '[studio] Preparing Draft dependencies and isolated profile\n' }
    try {
      await installDraftDependencies(
        this.draft,
        this.commands,
        chunk => { this.runtime.log = appendLog(this.runtime.log, chunk) },
      )
      await materializeDraftProfile(
        this.draft,
        this.mainProfileDir,
        studioPackageRoot(),
        this.commands,
        chunk => { this.runtime.log = appendLog(this.runtime.log, chunk) },
      )
      const hostArgs = [this.harmonyBinEntry, 'web', '--port', '0']
      this.runtime.log = appendLog(this.runtime.log,
        `[studio] Profile dependencies ready\n[studio] Starting Preview Host\nDSH_HOME=${this.draft.runtimeHome}\n${terminalCommandLine(this.draft.worktreeDir, process.execPath, hostArgs)}`)
      const controlToken = randomBytes(32).toString('hex')
      const bridgeCapability = randomBytes(24).toString('base64url')
      this.controlToken = controlToken
      const child = spawn(process.execPath, hostArgs, {
        cwd: this.draft.worktreeDir,
        env: {
          ...process.env,
          DSH_HOME: this.draft.runtimeHome,
          DSH_STUDIO_PREVIEW_DRAFT_ROOT: this.draft.root,
          DSH_STUDIO_PREVIEW_CONTROL_TOKEN: controlToken,
          DSH_STUDIO_PREVIEW_PARENT_ORIGIN: this.parentOrigin,
          DSH_STUDIO_PREVIEW_BRIDGE_CAPABILITY: bridgeCapability,
          DSH_HARMONY_REACT_TRACE: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      this.child = child
      child.stdout?.on('data', chunk => {
        this.runtime.log = appendLog(this.runtime.log, chunk)
        const match = this.runtime.log.match(/dsh web:\s+(http:\/\/127\.0\.0\.1:\d+)/)
        if (match?.[1] !== undefined) {
          this.runtime = {
            ...this.runtime,
            state: 'running',
            previewUrl: `${match[1]}/#dsh-studio-preview=${encodeURIComponent(bridgeCapability)}`,
            bridgeCapability,
            error: undefined,
          }
        }
      })
      child.stderr?.on('data', chunk => { this.runtime.log = appendLog(this.runtime.log, chunk) })
      child.once('exit', (code, signal) => {
        if (this.child !== child) return
        this.child = undefined
        this.controlToken = undefined
        if (this.runtime.state === 'stopped') return
        const error = `Preview Host exited (${signal ?? code ?? 'unknown'})`
        this.runtime = { state: 'failed', error, log: this.runtime.log }
      })
      await this.waitUntilRunning(child)
      await this.waitForWorker(child)
      await this.worker<WorkerState>('state', {})
      return this.snapshot()
    } catch (error) {
      await this.stop()
      this.runtime = { state: 'failed', error: error instanceof Error ? error.message : String(error), log: this.runtime.log }
      throw error
    }
  }

  async stop(): Promise<StudioPreviewRuntime> {
    const child = this.child
    this.controlToken = undefined
    this.runtime = { state: 'stopped', log: this.runtime.log }
    if (child !== undefined && child.exitCode === null) {
      child.kill('SIGTERM')
      if (!await waitForExit(child, this.stopTimeoutMs)) {
        child.kill('SIGKILL')
        if (!await waitForExit(child, this.stopTimeoutMs)) {
          const error = 'Preview Host did not exit after SIGTERM and SIGKILL'
          this.runtime = { state: 'failed', error, log: this.runtime.log }
          throw new Error(error)
        }
      }
    }
    if (this.child === child) this.child = undefined
    return this.snapshot()
  }

  async state(): Promise<StudioProjectState> {
    return (await this.worker<WorkerState>('state', {})).project
  }

  async activate(graphRev: string): Promise<StudioProjectState> {
    return (await this.worker<WorkerState>('activate', { graphRev })).project
  }

  async applyBuild(): Promise<StudioProjectState> {
    return (await this.worker<WorkerState>('apply-build', {})).project
  }

  async inspect(input: { package?: string; file?: string } = {}): Promise<StudioPreviewInspection> {
    return this.worker<StudioPreviewInspection>('inspect', input)
  }

  async resolveSource(source: StudioSourceLocation): Promise<StudioSourceCandidate> {
    return this.worker<StudioSourceCandidate>('resolve-source', { source })
  }

  async readDependencySource(packageName: string, file: string): Promise<string> {
    return this.worker<string>('read-source', { package: packageName, file })
  }

  async dispose(): Promise<void> {
    await this.stop()
  }

  private async waitUntilRunning(child: ChildProcess): Promise<void> {
    const started = Date.now()
    while (this.child === child && this.runtime.state === 'starting' && Date.now() - started < START_TIMEOUT_MS) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    if (this.runtime.state !== 'running') throw new Error(this.runtime.error ?? 'Preview Host did not publish its URL before timeout')
  }

  private async waitForWorker(child: ChildProcess): Promise<void> {
    const started = Date.now()
    let lastError = 'worker route was not reachable'
    while (this.child === child && Date.now() - started < START_TIMEOUT_MS) {
      try {
        await this.worker<{ ready: true }>('health', {})
        return
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }
    throw new Error(`Preview worker did not become ready before timeout: ${lastError}`)
  }

  private async worker<T>(method: string, payload: unknown): Promise<T> {
    if (this.runtime.previewUrl === undefined || this.controlToken === undefined) throw new Error('Preview Host is not running')
    const endpoint = new URL(`${STUDIO_PREVIEW_API_PATH}/${method}`, this.runtime.previewUrl)
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.controlToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const text = await response.text()
    if (text === '') throw new Error(`Preview worker returned an empty HTTP ${response.status} response`)
    const body = JSON.parse(text) as { ok: true; value: T } | { ok: false; error: string }
    if (!response.ok || !body.ok) throw new Error(body.ok ? `Preview worker failed with HTTP ${response.status}` : body.error)
    return body.value
  }
}
