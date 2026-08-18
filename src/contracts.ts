export const STUDIO_PATH = '/studio'
export const STUDIO_API_PATH = `${STUDIO_PATH}/api`
export const STUDIO_PREVIEW_FRAGMENT = 'dsh-studio-preview'
export const STUDIO_PREVIEW_API_PATH = '/dsh-harmony/studio-preview/api'

export interface StudioClientRequest {
  type: 'client-request'
  rpcId: string
  method: string
  payload: unknown
}

export interface StudioServerResponse<T = unknown> {
  type: 'server-response'
  rpcId: string
  result:
    | { ok: true; value: T }
    | { ok: false; error: { code: string; message: string; details?: unknown } }
}

export interface StudioServerRequest<T = unknown> {
  type: 'server-request'
  rpcId: string
  method: 'events.mux' | 'events.host'
  payload: T
}

export interface StudioCreateAgentResult {
  sessionId: string
  agentPreset?: string
}

export interface StudioReactSnapshot {
  component?: string
  owners: string[]
  props: Record<string, string | number | boolean | null>
  source?: StudioSourceLocation & { resolved?: StudioSourceCandidate }
  patches: StudioPatchTrace[]
}

export interface StudioPatchTrace {
  key: string
  owner: string
  effect: 'replace-element' | 'wrap-element' | 'insert-before' | 'insert-after' | 'transform-props'
  declaration: string
  target: { package: string; file: string }
  confidence: 'candidate'
}

export interface StudioSourceLocation {
  file: string
  line?: number
  column?: number
}

export interface StudioSourceCandidate extends StudioSourceLocation {
  package?: string
  kind: 'draft' | 'dependency' | 'generated' | 'unknown'
  confidence: 'exact' | 'candidate'
}

export interface StudioDomSelection {
  tag: string
  id?: string
  classes: string[]
  attributes: Record<string, string>
  text: string
  outerHTML: string
  rect: { x: number; y: number; width: number; height: number }
  style: Record<string, string>
  selector?: string
  boundaries: StudioSurfaceBoundary[]
  react?: StudioReactSnapshot
  confidence: 'mapped' | 'component-only' | 'dom-only'
}

export interface StudioSurfaceBoundary {
  surfaceId: string
  path: string[]
}

export interface StudioPreviewStatus {
  connected: boolean
  graphRev?: string
  mode: 'browse' | 'inspect'
  selection?: StudioDomSelection
  registry?: StudioRegistrySnapshot
}

export interface StudioAgentContext {
  selection: StudioDomSelection | null
  project: StudioProjectState
  preview: StudioPreviewStatus
  projectFiles: StudioProjectFile[]
  harmony: StudioHarmonyInspection | null
  targetRefs: Array<{ package: string; file: string }>
  targetRefsTruncated: boolean
  readiness: { findings: StudioReadinessFinding[] }
}

export interface StudioPreviewUpdate {
  connected: boolean
  graphRev?: string
  mode: 'browse' | 'inspect'
  selection?: StudioDomSelection | null
  registry?: StudioRegistrySnapshot | null
}

export type { StudioRegistrySnapshot }

export interface StudioProjectFile {
  path: string
  size: number
}

export type StudioHarmonyInspection = HarmonyInspection
export type StudioHarmonyProfile = HarmonyProfileView
export type StudioHarmonyProfileUpdateResult = HarmonyProfileUpdateResult

export type StudioReadinessLevel = 'error' | 'warning' | 'info'

export interface StudioReadinessFinding {
  level: StudioReadinessLevel
  code: string
  message: string
  file?: string
  patch?: string
}

export interface StudioPackResult {
  ok: boolean
  argv: string[]
  files: string[]
  stdout: string
  stderr: string
  truncated: boolean
}

export interface StudioReadinessReport {
  findings: StudioReadinessFinding[]
  pack?: StudioPackResult
}

export interface StudioProjectState {
  name: string
  root: string
  state: 'active' | 'preview-pending' | 'closed'
  graphRev: string
}

export type StudioDraftProfileMode = 'main-home' | 'custom'

export type StudioDraftSource =
  | { kind: 'new'; packageName: string }
  | { kind: 'existing'; directory: string }

export interface StudioDraftRecord {
  id: string
  name: string
  label: string
  source: StudioDraftSource
  destinationDirectory?: string
  exportedAt?: string
  repositoryDir: string
  worktreeDir: string
  root: string
  runtimeHome: string
  profileMode: StudioDraftProfileMode
  profileDirectory?: string
  createdAt: string
}

export interface StudioDraftView extends StudioDraftRecord {
  runtime: {
    state: 'stopped' | 'starting' | 'running' | 'failed'
    previewUrl?: string
    bridgeCapability?: string
    error?: string
    log: string
  }
  project?: StudioProjectState
  agent?: StudioCreateAgentResult
}

export interface StudioCreateDraftInput {
  source: StudioDraftSource
  profileMode: StudioDraftProfileMode
  profileDirectory?: string
  destinationDirectory?: string
}

export interface StudioWorkspaceState {
  openDraftIds: string[]
  selectedDraftId?: string
}

export interface StudioBuildOutput {
  argv: string[]
  stdout: string
  stderr: string
  truncated: boolean
}

export interface StudioBuildResult {
  project: StudioProjectState
  build: StudioBuildOutput
}

export interface StudioAutomaticPatchTarget {
  package: string
  file: string
}

export interface StudioAutomaticPatchRequest {
  kind: 'replace-string'
  targets: StudioAutomaticPatchTarget[]
  text: string
  replacement: string
}

export interface StudioAutomaticPatchMatch {
  line: number
  column: number
  excerpt: string
}

export interface StudioAutomaticPatchTargetAnalysis extends StudioAutomaticPatchTarget {
  version: string
  matches: StudioAutomaticPatchMatch[]
}

export interface StudioAutomaticPatchPlan {
  request: StudioAutomaticPatchRequest
  targets: StudioAutomaticPatchTargetAnalysis[]
  canApply: boolean
  provider: {
    file: string
    source: string
    patchIds: string[]
  }
}

export interface StudioAutomaticPatchWriteResult extends StudioAutomaticPatchPlan {
  files: string[]
}

export type StudioHarmonyService = HarmonyService

export interface StudioPreviewInspection {
  harmony: StudioHarmonyInspection
  dependencies: StudioPatchDependency[]
}

export type StudioPatchDependency = HarmonyPatchDependency
import type {
  HarmonyInspection,
  HarmonyPatchDependency,
  HarmonyProfileUpdateResult,
  HarmonyProfileView,
  HarmonyService,
} from 'dsh-harmony'
import type { StudioRegistrySnapshot } from 'dsh-harmony-react/studio'
