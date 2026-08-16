import {
  type CSSProperties,
  FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  StudioElementSnapshot,
  StudioRegistrySnapshot,
  StudioVariableDefinition,
  StudioVariableValue,
} from 'dsh-harmony-react/studio'
import {
  type StudioCreateAgentResult,
  type StudioCreateDraftInput,
  type StudioBuildOutput,
  type StudioBuildResult,
  type StudioDraftView,
  type StudioDomSelection,
  type StudioHarmonyInspection,
  type StudioProjectFile,
  type StudioProjectState,
  type StudioPatchTrace,
  type StudioReadinessLevel,
  type StudioReadinessReport,
  type StudioServerRequest,
  type StudioSourceCandidate,
  type StudioWorkspaceState,
  STUDIO_PATH,
} from '../contracts'
import { apiValue, studioApi, subscribeStudioEvents } from './events'
import { callStudio, StudioRpcError } from './rpc'
import { CodeEditor } from './CodeEditor'
import { useStudioLocale, type StudioTranslate } from './i18n'
import {
  clamp,
  constrainRect,
  fitRect,
  moveRect,
  resizeRect,
  type LayoutRect,
  type ResizeDirection,
} from './layout'
import {
  Badge,
  Button,
  EmptyState,
  FormField,
  IconButton,
  Input,
  Notice,
  Panel,
  PanelBody,
  SegmentedControl,
  Select,
  Status,
  Tabs,
  Textarea,
} from './ui'
import { CreateDraftDialog } from './CreateDraftDialog'
import { SettingsDialog, SettingsIcon } from './SettingsDialog'
import {
  boundedBridgeText,
  isBridgeEnvelope,
  isBridgeOffer,
  isFinitePreviewPan,
  isFinitePreviewZoom,
  isStudioDomSelection,
  isStudioRegistrySnapshot,
} from './preview-messages'

interface SessionEvent {
  type: string
  seq: number
  time: number
  data: Record<string, unknown>
}

interface HistoryEntry {
  event: SessionEvent
}

interface ConversationRow {
  id: string
  role: 'user' | 'assistant'
  text: string
}

const panels = ['elements', 'selection', 'source', 'build', 'readiness', 'agent'] as const
type Panel = typeof panels[number]
const leftPanels = ['instance', 'plugins'] as const
type LeftPanel = typeof leftPanels[number]
type InstanceOperation = 'start' | 'stop' | 'restart'
type DraftTabDrag = {
  draftId: string
  sourceIndex: number
  targetIndex?: number
  indicator: boolean
  span: number
  width: number
}
type PreviewZoomFocus = {
  x: number
  y: number
  phase: 'active' | 'fading'
}

const previewAspectRatios = ['16:9', '16:10', '4:3', '1:1', '9:16'] as const
type PreviewAspectRatio = typeof previewAspectRatios[number] | 'custom'

const LEFT_SIDEBAR_MIN = 220
const LEFT_SIDEBAR_MAX = 480
const RIGHT_SIDEBAR_MIN = 320
const RIGHT_SIDEBAR_MAX = 560
const PREVIEW_GUTTER = 32
const PREVIEW_MIN_SIZE = { width: 1, height: 1 }
const PREVIEW_ZOOM_FOCUS_FADE_MS = 10_000
const PREVIEW_ZOOM_FOCUS_REDUCED_FADE_MS = 240
const TERMINAL_MIN_SIZE = { width: 280, height: 220 }
const resizeDirections: readonly ResizeDirection[] = ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw']

const EMPTY_REGISTRY: StudioRegistrySnapshot = { elements: [], variables: [] }

function PlusIcon(): JSX.Element {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M10 4v12M4 10h12" /></svg>
}

function RefreshIcon(): JSX.Element {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M15.5 7A6 6 0 1 0 16 12" /><path d="M15.5 3v4h-4" /></svg>
}

function FullscreenIcon({ active }: { active: boolean }): JSX.Element {
  return active
    ? <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M8 4v4H4M12 4v4h4M8 16v-4H4M12 16v-4h4" /></svg>
    : <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M8 4H4v4M12 4h4v4M8 16H4v-4M12 16h4v-4" /></svg>
}

function AspectRatioLockIcon({ locked }: { locked: boolean }): JSX.Element {
  return locked
    ? <svg aria-hidden="true" viewBox="0 0 20 20">
        <path d="M7.5 7.5l-2 2a3 3 0 0 0 4.2 4.2l2-2M12.5 12.5l2-2a3 3 0 0 0-4.2-4.2l-2 2M7.5 12.5l5-5" />
      </svg>
    : <svg aria-hidden="true" viewBox="0 0 20 20">
        <path d="M7 8l-1.5 1.5a3 3 0 0 0 4.2 4.2l1.5-1.5M13 12l1.5-1.5a3 3 0 0 0-4.2-4.2L8.8 7.8M5 4l10 12" />
      </svg>
}

function TerminalLayoutIcon({ expanded }: { expanded: boolean }): JSX.Element {
  return expanded
    ? <svg aria-hidden="true" viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="12" rx="2" /><path d="M7 8h6M7 12h6" /></svg>
    : <svg aria-hidden="true" viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="12" rx="2" /><path d="M8 12l4-4M8 8h4v4" /></svg>
}

function DisclosureIcon({ expanded }: { expanded: boolean }): JSX.Element {
  return <svg aria-hidden="true" viewBox="0 0 16 16">
    <path d={expanded ? 'M4 6l4 4 4-4' : 'M6 4l4 4-4 4'} />
  </svg>
}

function StartIcon(): JSX.Element {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M7 5l8 5-8 5z" /></svg>
}

function StopIcon(): JSX.Element {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><rect x="6" y="6" width="8" height="8" rx="1" /></svg>
}

function CloseIcon(): JSX.Element {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M6 6l8 8M14 6l-8 8" /></svg>
}

function ResizeHandles({
  kind,
  onPointerDown,
}: {
  kind: 'preview' | 'terminal'
  onPointerDown(event: ReactPointerEvent<HTMLSpanElement>, direction: ResizeDirection): void
}): JSX.Element {
  return <>{resizeDirections.map(direction => <span key={direction} aria-hidden="true"
    className={`resize-handle resize-handle-${direction}`} data-kind={kind}
    onPointerDown={event => onPointerDown(event, direction)} />)}</>
}

function aspectRatioValue(value: Exclude<PreviewAspectRatio, 'custom'>): number {
  const [width, height] = value.split(':').map(Number)
  return width! / height!
}

function aspectRatioLabel(width: number, height: number): PreviewAspectRatio {
  const ratio = width / height
  return previewAspectRatios.find(value => Math.abs(aspectRatioValue(value) - ratio) < 0.01) ?? 'custom'
}

function previewBounds(width: number, height: number): LayoutRect {
  return {
    x: PREVIEW_GUTTER,
    y: PREVIEW_GUTTER,
    width: Math.max(0, width - PREVIEW_GUTTER * 2),
    height: Math.max(0, height - PREVIEW_GUTTER * 2),
  }
}

function runtimeLabel(state: StudioDraftView['runtime']['state'], t: StudioTranslate): string {
  return state === 'running' ? t('runtimeRunning') : state === 'starting' ? t('runtimeStarting')
    : state === 'failed' ? t('runtimeFailed') : t('runtimeStopped')
}

function deviceViewport(): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(window.screen.width)),
    height: Math.max(1, Math.round(window.screen.height)),
  }
}

function SidebarToggleIcon({ side, collapsed }: { side: 'left' | 'right'; collapsed: boolean }): JSX.Element {
  const arrow = side === 'left'
    ? collapsed ? 'M8 7l3 3-3 3' : 'M11 7l-3 3 3 3'
    : collapsed ? 'M12 7l-3 3 3 3' : 'M9 7l3 3-3 3'
  return <svg aria-hidden="true" viewBox="0 0 20 20">
    <rect x="3" y="3" width="14" height="14" rx="2" />
    <path d={side === 'left' ? 'M7 3v14' : 'M13 3v14'} />
    <path d={arrow} />
  </svg>
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index])
}

function elementForSelection(
  selection: StudioDomSelection | undefined,
  registry: StudioRegistrySnapshot,
  owner: string | undefined,
): StudioElementSnapshot | undefined {
  if (selection === undefined || owner === undefined) return undefined
  for (const boundary of selection.boundaries) {
    const match = registry.elements.find(item => item.owner === owner
      && item.element.boundary.surfaceId === boundary.surfaceId
      && samePath(item.element.boundary.path, boundary.path))
    if (match !== undefined) return match
  }
  return undefined
}

function VariableControl({
  definition,
  value,
  onChange,
}: {
  definition: StudioVariableDefinition
  value: StudioVariableValue
  onChange(value: StudioVariableValue): void
}): JSX.Element {
  const id = useId()
  let control: JSX.Element
  if (definition.control === 'boolean') {
    control = <Input id={id} type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} />
  } else if (definition.control === 'enum') {
    control = <Select id={id} value={String(value)} onChange={event => {
      const option = definition.options?.find(candidate => String(candidate) === event.target.value)
      if (option !== undefined) onChange(option)
    }}>{definition.options?.map(option => <option key={String(option)} value={String(option)}>{String(option)}</option>)}</Select>
  } else if (definition.control === 'number') {
    control = <Input id={id} type="number" value={Number(value)} min={definition.constraints?.min}
      max={definition.constraints?.max} step={definition.constraints?.step} onChange={event => onChange(event.target.valueAsNumber)} />
  } else {
    control = <Input id={id} type={definition.control === 'color' ? 'color' : 'text'} value={String(value)}
      onChange={event => onChange(event.target.value)} />
  }
  return <label className="element-variable" htmlFor={id}>
    <span><strong>{definition.label}</strong><code>{definition.id}</code></span>
    {control}
  </label>
}

function PatchProvenance({
  patches,
  currentOwner,
  boundaryMatched,
  t,
}: {
  patches: readonly StudioPatchTrace[]
  currentOwner?: string
  boundaryMatched: boolean
  t: StudioTranslate
}): JSX.Element {
  const externallyPatched = boundaryMatched && currentOwner !== undefined
    && patches.some(patch => patch.owner !== currentOwner)

  return <section className="patch-provenance" aria-label={t('patchCandidates')}>
    <div className="section-heading">
      <strong>{t('patchCandidates')}</strong>
      <Badge tone="warning">{t('patchCandidate')}</Badge>
    </div>
    {externallyPatched && <Notice tone="warning">
      {t('patchExternalNotice')}
    </Notice>}
    {patches.length === 0
      ? <p className="inspection-empty">{t('patchEmpty')}</p>
      : <div className="patch-trace-list">{patches.map(patch => <article
          key={`${patch.owner}:${patch.key}:${patch.effect}:${patch.declaration}:${patch.target.package}:${patch.target.file}`}>
          <div><strong>{patch.owner}</strong><code>{patch.key}</code></div>
          <dl>
            <div><dt>{t('effect')}</dt><dd>{patch.effect}</dd></div>
            <div><dt>{t('declaration')}</dt><dd><code>{patch.declaration}</code></dd></div>
            <div><dt>{t('target')}</dt><dd><code>{patch.target.package} · {patch.target.file}</code></dd></div>
          </dl>
        </article>)}</div>}
  </section>
}

function textFromContent(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.flatMap(block => {
    if (typeof block !== 'object' || block === null) return []
    const candidate = block as { type?: unknown; text?: unknown }
    return (candidate.type === 'text' || candidate.type === 'reasoning') && typeof candidate.text === 'string'
      ? [candidate.text]
      : []
  }).join('\n')
}

function conversation(events: SessionEvent[]): ConversationRow[] {
  const rows: ConversationRow[] = []
  for (const event of events) {
    if (event.type === 'user/message') {
      const text = textFromContent(event.data.content)
      if (text !== '') rows.push({ id: String(event.seq), role: 'user', text })
    }
    if (event.type === 'assistant/message') {
      const message = event.data.message as { content?: unknown } | undefined
      const text = textFromContent(message?.content)
      if (text !== '') rows.push({ id: String(event.seq), role: 'assistant', text })
    }
  }
  return rows
}

function eventSessionId(envelope: StudioServerRequest<Record<string, unknown>>): string | undefined {
  return typeof envelope.payload.sessionId === 'string' ? envelope.payload.sessionId : undefined
}

export function App(): JSX.Element {
  const { t } = useStudioLocale()
  const initialViewport = useMemo(deviceViewport, [])
  const [drafts, setDrafts] = useState<StudioDraftView[]>([])
  const [openDraftIds, setOpenDraftIds] = useState<string[]>([])
  const [draftTabDrag, setDraftTabDrag] = useState<DraftTabDrag>()
  const [loadingDrafts, setLoadingDrafts] = useState(true)
  const [selectedDraftId, setSelectedDraftId] = useState<string>()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [project, setProject] = useState<StudioProjectState>()
  const [sessionId, setSessionId] = useState<string>()
  const [events, setEvents] = useState<SessionEvent[]>([])
  const [prompt, setPrompt] = useState('')
  const [streaming, setStreaming] = useState('')
  const [running, setRunning] = useState(false)
  const [connected, setConnected] = useState(false)
  const [creatingAgentDraftId, setCreatingAgentDraftId] = useState<string>()
  const [exportingDraftId, setExportingDraftId] = useState<string>()
  const [instanceOperations, setInstanceOperations] = useState<Record<string, InstanceOperation>>({})
  const [buildOperations, setBuildOperations] = useState<Record<string, true>>({})
  const [buildOutputs, setBuildOutputs] = useState<Record<string, StudioBuildOutput>>({})
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string>()
  const [interaction, setInteraction] = useState<string>()
  const [previewKey, setPreviewKey] = useState(0)
  const [previewMode, setPreviewMode] = useState<'browse' | 'inspect'>('browse')
  const [previewAspectRatio, setPreviewAspectRatio] = useState<PreviewAspectRatio>(
    () => aspectRatioLabel(initialViewport.width, initialViewport.height),
  )
  const [previewAspectLocked, setPreviewAspectLocked] = useState(false)
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false)
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false)
  const [leftPanel, setLeftPanel] = useState<LeftPanel>('instance')
  const [draftLabelInput, setDraftLabelInput] = useState('')
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(260)
  const [rightSidebarWidth, setRightSidebarWidth] = useState(400)
  const [previewStageSize, setPreviewStageSize] = useState({ width: 0, height: 0 })
  const [previewViewport, setPreviewViewport] = useState(initialViewport)
  const [previewScale, setPreviewScale] = useState(1)
  const [previewZoomFocus, setPreviewZoomFocus] = useState<PreviewZoomFocus>()
  const [previewOrigin, setPreviewOrigin] = useState({ x: PREVIEW_GUTTER, y: PREVIEW_GUTTER })
  const [selection, setSelection] = useState<StudioDomSelection>()
  const [registry, setRegistry] = useState<StudioRegistrySnapshot>(EMPTY_REGISTRY)
  const [focusedElementId, setFocusedElementId] = useState<string>()
  const [panel, setPanel] = useState<Panel>('elements')
  const [previewFullscreen, setPreviewFullscreen] = useState(false)
  const [terminalExpanded, setTerminalExpanded] = useState(false)
  const [terminalMinimized, setTerminalMinimized] = useState(false)
  const [terminalRect, setTerminalRect] = useState<LayoutRect>()
  const [files, setFiles] = useState<StudioProjectFile[]>([])
  const [filePath, setFilePath] = useState('')
  const [source, setSource] = useState('')
  const [savedSource, setSavedSource] = useState('')
  const [fileBusy, setFileBusy] = useState(false)
  const [inspection, setInspection] = useState<StudioHarmonyInspection>({ patches: [], targets: [] })
  const [readiness, setReadiness] = useState<StudioReadinessReport>({ findings: [] })
  const [packingDraftId, setPackingDraftId] = useState<string>()
  const sessionRef = useRef<string>()
  const runningVersion = useRef(0)
  const draftIdRef = useRef<string>()
  const projectRef = useRef<StudioProjectState>()
  const previewRef = useRef<HTMLIFrameElement>(null)
  const previewSectionRef = useRef<HTMLElement>(null)
  const previewStageRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<HTMLPreElement>(null)
  const terminalToggleRef = useRef<HTMLButtonElement>(null)
  const terminalPinnedRef = useRef(true)
  const previewPort = useRef<MessagePort>()
  const previewBridgeHandlerRef = useRef<(event: MessageEvent) => void>(() => {})
  const previewNonce = useRef(crypto.randomUUID())
  const previewModeRef = useRef(previewMode)
  const previewTransformRef = useRef({ scale: previewScale, origin: previewOrigin })
  const previewLockedAspectRatioRef = useRef(initialViewport.width / initialViewport.height)
  const previewUpdateQueue = useRef<Promise<void>>(Promise.resolve())
  const workspaceUpdateQueue = useRef<Promise<void>>(Promise.resolve())
  const suppressDraftTabClickRef = useRef<string>()
  const selectionResolve = useRef(0)
  const fileRequest = useRef(0)
  const draftViewRequest = useRef(0)
  const packRequest = useRef(0)
  const activeDragCleanupRef = useRef<() => void>()
  const openDrafts = openDraftIds.flatMap(id => {
    const draft = drafts.find(candidate => candidate.id === id)
    return draft === undefined ? [] : [draft]
  })
  const selectedDraft = drafts.find(draft => draft.id === selectedDraftId)
  const hasUnsavedSource = filePath !== '' && source !== savedSource
  const selectedInstanceOperation = selectedDraftId === undefined ? undefined : instanceOperations[selectedDraftId]
  const selectedInstanceStarting = selectedInstanceOperation === 'start' || selectedInstanceOperation === 'restart'
  const selectedBuildRunning = selectedDraftId !== undefined && buildOperations[selectedDraftId] === true
  const selectedBuildOutput = selectedDraftId === undefined ? undefined : buildOutputs[selectedDraftId]
  const terminalOutput = selectedDraft?.runtime.log ?? ''
  const terminalLatestLine = terminalOutput.trimEnd().split(/\r?\n/).at(-1) ?? t('terminalNotStarted')
  const terminalRuntimeState = selectedInstanceStarting ? 'starting' : selectedDraft?.runtime.state
  const terminalRuntimeLabel = selectedInstanceOperation === 'restart' ? t('operationRestarting')
    : selectedInstanceOperation === 'stop' ? t('operationStopping') : terminalRuntimeState === 'starting' ? t('operationRunning')
    : terminalRuntimeState === 'running' ? t('operationActive')
      : terminalRuntimeState === 'failed' ? t('operationFailed') : undefined
  const localDshStatusLabel = connected ? t('localDshActive') : t('localDshStopped')
  const hasLiveDraft = drafts.some(draft => draft.runtime.state === 'starting' || draft.runtime.state === 'running')
  const previewSession = selectedDraft?.runtime.bridgeCapability
  const previewUrl = selectedDraft?.runtime.previewUrl
  const messages = useMemo(() => conversation(events), [events])
  const draftElements = useMemo(() => registry.elements.filter(item => item.owner === selectedDraft?.name), [registry, selectedDraft?.name])
  const draftVariables = useMemo(() => registry.variables.filter(item => item.owner === selectedDraft?.name), [registry, selectedDraft?.name])
  const matchedElement = useMemo(
    () => elementForSelection(selection, registry, selectedDraft?.name),
    [registry, selectedDraft?.name, selection],
  )
  const focusedElement = draftElements.find(item => item.element.id === focusedElementId)
    ?? matchedElement
    ?? draftElements[0]
  const previewInsets = previewFullscreen
    ? { left: 0, right: 0 }
    : {
        left: leftSidebarCollapsed ? 48 : leftSidebarWidth,
        right: rightSidebarCollapsed ? 56 : rightSidebarWidth,
      }
  const previewRect: LayoutRect = {
    x: previewOrigin.x,
    y: previewOrigin.y,
    width: previewViewport.width * previewScale,
    height: previewViewport.height * previewScale,
  }

  const fitPreviewToStage = (viewport = previewViewport): void => {
    const stage = previewStageRef.current
    if (stage === null) return
    const bounds = previewBounds(
      stage.clientWidth - previewInsets.left - previewInsets.right,
      stage.clientHeight,
    )
    bounds.x += previewInsets.left
    if (bounds.width < PREVIEW_MIN_SIZE.width || bounds.height < PREVIEW_MIN_SIZE.height) return
    const fitted = fitRect(bounds, viewport.width / viewport.height)
    setPreviewScale(fitted.width / viewport.width)
    setPreviewOrigin({ x: fitted.x, y: fitted.y })
  }

  const zoomPreviewByWheel = (deltaY: number, deltaMode: number): void => {
    const stage = previewStageRef.current
    if (stage === null) return
    const center = { x: stage.clientWidth / 2, y: stage.clientHeight / 2 }
    const current = previewTransformRef.current
    const delta = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * stage.clientHeight : deltaY
    const scale = Math.max(0.01, current.scale * Math.exp(clamp(-delta * 0.0015, -0.35, 0.35)))
    const ratio = scale / current.scale
    const origin = {
      x: center.x - (center.x - current.origin.x) * ratio,
      y: center.y - (center.y - current.origin.y) * ratio,
    }
    previewTransformRef.current = { scale, origin }
    setPreviewScale(scale)
    setPreviewOrigin(origin)
  }

  const activateDraft = (draftId: string | undefined): void => {
    draftIdRef.current = draftId
    fileRequest.current += 1
    draftViewRequest.current += 1
    packRequest.current += 1
    setFileBusy(false)
    setFiles([])
    setFilePath('')
    setSource('')
    setSavedSource('')
    setInspection({ patches: [], targets: [] })
    setReadiness({ findings: [] })
    setSelectedDraftId(draftId)
  }

  useEffect(() => {
    sessionRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    setProject(selectedDraft?.project)
    setDraftLabelInput(selectedDraft?.label ?? '')
    terminalPinnedRef.current = true
    setSessionId(selectedDraft?.agent?.sessionId)
    setEvents([])
    setStreaming('')
    runningVersion.current += 1
    setRunning(false)
    setInteraction(undefined)
  }, [selectedDraftId])

  useEffect(() => {
    const terminal = terminalRef.current
    if (terminal !== null && terminalPinnedRef.current) terminal.scrollTop = terminal.scrollHeight
  }, [terminalOutput])

  useEffect(() => {
    const stage = previewStageRef.current
    if (stage === null) return
    const update = (): void => {
      setPreviewStageSize({ width: stage.clientWidth, height: stage.clientHeight })
    }
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    update()
    fitPreviewToStage()
    return () => observer.disconnect()
  }, [])

  useEffect(() => () => activeDragCleanupRef.current?.(), [])

  useEffect(() => {
    const receiveBridge = (event: MessageEvent): void => previewBridgeHandlerRef.current(event)
    window.addEventListener('message', receiveBridge)
    return () => window.removeEventListener('message', receiveBridge)
  }, [])

  useEffect(() => {
    if (previewZoomFocus?.phase !== 'fading') return
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? PREVIEW_ZOOM_FOCUS_REDUCED_FADE_MS
      : PREVIEW_ZOOM_FOCUS_FADE_MS
    const timeout = window.setTimeout(() => {
      setPreviewZoomFocus(current => current?.phase === 'fading' ? undefined : current)
    }, duration)
    return () => window.clearTimeout(timeout)
  }, [previewZoomFocus?.phase])

  useEffect(() => {
    const fadePreviewZoomFocus = (): void => {
      setPreviewZoomFocus(current => current?.phase === 'active'
        ? { ...current, phase: 'fading' }
        : current)
    }
    window.addEventListener('blur', fadePreviewZoomFocus)
    return () => window.removeEventListener('blur', fadePreviewZoomFocus)
  }, [])

  useEffect(() => {
    if (sessionId === undefined) return
    let current = true
    const initialRunningVersion = runningVersion.current
    void Promise.all([
      studioApi.sessions.history({ sessionId: sessionId as SessionId, maxMessages: 50 }),
      studioApi.sessions.list({}),
    ]).then(([historyResponse, listResponse]) => {
      if (!current) return
      const history = apiValue(historyResponse)
      const sessions = apiValue(listResponse)
      const restored = history.events.map(entry => entry.event as unknown as SessionEvent)
      setEvents(live => [...restored, ...live.filter(event => !restored.some(item => item.seq === event.seq))]
        .sort((a, b) => a.seq - b.seq))
      if (runningVersion.current === initialRunningVersion) {
        setRunning(sessions.items.some(item => item.sessionId === sessionId && item.running))
      }
    })
      .catch(cause => {
        if (current) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => { current = false }
  }, [sessionId])

  useEffect(() => {
    projectRef.current = project
  }, [project])

  useEffect(() => {
    if (selectedDraftId === undefined || project === undefined) return
    setDrafts(current => current.map(draft => draft.id === selectedDraftId ? { ...draft, project } : draft))
  }, [project, selectedDraftId])

  const queuePreviewUpdate = (draftId: string, update: Record<string, unknown>): void => {
    previewUpdateQueue.current = previewUpdateQueue.current.then(async () => {
      await callStudio('studio.preview.update', { draftId, ...update })
    }).catch(() => undefined)
  }

  const queueWorkspaceUpdate = (open: string[], selected: string | undefined): void => {
    const next: StudioWorkspaceState = {
      openDraftIds: open,
      ...(selected === undefined ? {} : { selectedDraftId: selected }),
    }
    workspaceUpdateQueue.current = workspaceUpdateQueue.current.then(async () => {
      await callStudio<StudioWorkspaceState>('studio.workspace.update', next)
    }).catch(cause => {
      setError(cause instanceof StudioRpcError ? cause.message : String(cause))
    })
  }

  useEffect(() => {
    previewModeRef.current = previewMode
  }, [previewMode])

  useEffect(() => {
    previewTransformRef.current = { scale: previewScale, origin: previewOrigin }
  }, [previewOrigin, previewScale])

  useEffect(() => {
    if (!previewFullscreen) return
    const exit = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPreviewFullscreen(false)
    }
    window.addEventListener('keydown', exit)
    return () => window.removeEventListener('keydown', exit)
  }, [previewFullscreen])

  useEffect(() => {
    const frame = requestAnimationFrame(() => previewPort.current?.postMessage({
      type: 'refresh-overlay',
      sessionId: previewSession,
      nonce: previewNonce.current,
    }))
    return () => cancelAnimationFrame(frame)
  }, [previewScale, previewSession, previewViewport.height, previewViewport.width])

  useEffect(() => {
    if (selection !== undefined && matchedElement !== undefined) setFocusedElementId(matchedElement.element.id)
  }, [matchedElement?.element.id, selection])

  useEffect(() => {
    const currentDraft = selectedDraftId
    previewPort.current?.close()
    previewPort.current = undefined
    previewNonce.current = crypto.randomUUID()
    selectionResolve.current += 1
    setRegistry(EMPTY_REGISTRY)
    setFocusedElementId(undefined)
    setSelection(undefined)
    return () => {
      previewPort.current?.close()
      previewPort.current = undefined
      if (currentDraft !== undefined) queuePreviewUpdate(currentDraft, {
        connected: false,
        mode: previewModeRef.current,
        selection: null,
        registry: null,
      })
    }
  }, [previewKey, previewSession, selectedDraftId])

  useEffect(() => {
    void Promise.all([
      callStudio<StudioDraftView[]>('studio.drafts.list', {}),
      callStudio<StudioWorkspaceState>('studio.workspace.get', {}),
    ]).then(([next, workspace]) => {
      setDrafts(next)
      setOpenDraftIds(workspace.openDraftIds)
      activateDraft(workspace.selectedDraftId)
      if (next.length === 0) setCreateDialogOpen(true)
    }).catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setLoadingDrafts(false))
  }, [])

  useEffect(() => {
    if (!hasLiveDraft) return
    let active = true
    let timer: number | undefined
    const sync = async (): Promise<void> => {
      try {
        const next = await callStudio<StudioDraftView[]>('studio.drafts.list', {})
        if (active) setDrafts(next)
      } catch {
        // The regular connection state reports transport failures.
      } finally {
        if (active) timer = window.setTimeout(() => void sync(), 250)
      }
    }
    timer = window.setTimeout(() => void sync(), 250)
    return () => {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [hasLiveDraft])

  useEffect(() => subscribeStudioEvents(envelope => {
    const current = sessionRef.current
    if (current === undefined || eventSessionId(envelope) !== current) return
    const frame = envelope.payload
    if (frame.type === 'host/session-status') {
      runningVersion.current += 1
      setRunning(frame.running === true)
    }
    if (frame.type === 'approval/requested') setInteraction(t('interactionApproval'))
    if (frame.type === 'question/requested') setInteraction(t('interactionQuestion'))
    if (frame.type === 'approval/resolved' || frame.type === 'question/resolved') setInteraction(undefined)
    if (frame.type !== 'session/event' || typeof frame.event !== 'object' || frame.event === null) return
    const event = frame.event as unknown as SessionEvent
    if (event.type === 'assistant/chunk') {
      const chunk = event.data.chunk as { type?: unknown; text?: unknown } | undefined
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') setStreaming(value => value + chunk.text)
      return
    }
    if (event.type === 'assistant/message') setStreaming('')
    setEvents(previous => previous.some(item => item.seq === event.seq)
      ? previous
      : [...previous, event].sort((a, b) => a.seq - b.seq))
    if (event.type === 'tool/result') {
      const currentDraft = draftIdRef.current
      if (currentDraft === undefined) return
      const request = ++draftViewRequest.current
      void Promise.all([
        callStudio<StudioProjectState>('studio.project.state', { draftId: currentDraft }),
        callStudio<StudioProjectFile[]>('studio.project.files', { draftId: currentDraft }),
        callStudio<StudioHarmonyInspection>('studio.harmony.inspect', { draftId: currentDraft }),
        callStudio<StudioReadinessReport>('studio.readiness.inspect', { draftId: currentDraft }),
      ]).then(([next, nextFiles, nextInspection, nextReadiness]) => {
        if (draftViewRequest.current !== request || draftIdRef.current !== currentDraft) return
        const previous = projectRef.current
        projectRef.current = next
        setProject(next)
        setFiles(nextFiles)
        setInspection(nextInspection)
        setReadiness(nextReadiness)
        if (next.state === 'preview-pending'
          && (previous?.state !== 'preview-pending' || previous.graphRev !== next.graphRev)) {
          setPreviewKey(value => value + 1)
        }
      }).catch(() => undefined)
    }
  }, setConnected), [])

  useEffect(() => {
    if (project?.root === undefined || selectedDraftId === undefined) {
      draftViewRequest.current += 1
      setFiles([])
      setFilePath('')
      setSource('')
      setSavedSource('')
      setInspection({ patches: [], targets: [] })
      setReadiness({ findings: [] })
      return
    }
    const draftId = selectedDraftId
    const request = ++draftViewRequest.current
    void Promise.all([
      callStudio<StudioProjectFile[]>('studio.project.files', { draftId }),
      callStudio<StudioHarmonyInspection>('studio.harmony.inspect', { draftId }),
      callStudio<StudioReadinessReport>('studio.readiness.inspect', { draftId }),
    ]).then(([nextFiles, nextInspection, nextReadiness]) => {
      if (draftViewRequest.current !== request || draftIdRef.current !== draftId) return
      setFiles(nextFiles)
      setInspection(nextInspection)
      setReadiness(nextReadiness)
    }).catch(cause => {
      if (draftViewRequest.current === request && draftIdRef.current === draftId) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    })
  }, [project?.root, selectedDraftId, t])

  const updateDraft = (next: StudioDraftView): void => {
    setDrafts(current => current.some(draft => draft.id === next.id)
      ? current.map(draft => draft.id === next.id ? next : draft)
      : [...current, next])
    if (draftIdRef.current === next.id) setProject(next.project)
  }

  const updateDraftProject = (draftId: string, next: StudioProjectState): void => {
    setDrafts(current => current.map(draft => draft.id === draftId ? { ...draft, project: next } : draft))
    if (draftIdRef.current !== draftId) return
    projectRef.current = next
    setProject(next)
  }

  const createDraft = async (input: StudioCreateDraftInput): Promise<void> => {
    if (hasUnsavedSource) {
      setPanel('source')
      throw new Error(t('errorUnsavedCreate'))
    }
    setError(undefined)
    const next = await callStudio<StudioDraftView>('studio.drafts.create', input)
    updateDraft(next)
    const nextOpenDraftIds = openDraftIds.includes(next.id) ? openDraftIds : [...openDraftIds, next.id]
    setOpenDraftIds(nextOpenDraftIds)
    activateDraft(next.id)
    queueWorkspaceUpdate(nextOpenDraftIds, next.id)
    setProject(next.project)
    setCreateDialogOpen(false)
  }

  const exportDraft = async (): Promise<void> => {
    if (selectedDraftId === undefined || selectedDraft?.destinationDirectory === undefined) return
    if (hasUnsavedSource) {
      setPanel('source')
      setError(t('errorUnsavedExport'))
      return
    }
    const draftId = selectedDraftId
    setExportingDraftId(draftId)
    setError(undefined)
    try {
      updateDraft(await callStudio<StudioDraftView>('studio.drafts.export', { draftId }))
    } catch (cause) {
      if (draftIdRef.current === draftId) setError(cause instanceof StudioRpcError ? cause.message : String(cause))
    } finally {
      setExportingDraftId(current => current === draftId ? undefined : current)
    }
  }

  const renameDraft = async (): Promise<void> => {
    if (selectedDraft === undefined) return
    const draftId = selectedDraft.id
    const previousLabel = selectedDraft.label
    const label = draftLabelInput.trim()
    if (label === selectedDraft.label) return
    if (label === '') {
      setDraftLabelInput(selectedDraft.label)
      setError(t('errorEmptyDraftName'))
      return
    }
    setError(undefined)
    try {
      updateDraft(await callStudio<StudioDraftView>('studio.drafts.rename', { draftId, label }))
      if (draftIdRef.current === draftId) setDraftLabelInput(label)
    } catch (cause) {
      if (draftIdRef.current === draftId) {
        setDraftLabelInput(previousLabel)
        setError(cause instanceof StudioRpcError ? cause.message : String(cause))
      }
    }
  }

  const clearSelectedRuntime = (draftId: string): void => {
    if (draftIdRef.current !== draftId) return
    setSessionId(undefined)
    setEvents([])
    setStreaming('')
    setRunning(false)
    setInteraction(undefined)
    setSelection(undefined)
    setReadiness({ findings: [] })
  }

  const runDraftStart = async (restart: boolean): Promise<void> => {
    if (selectedDraftId === undefined) return
    const id = selectedDraftId
    setInstanceOperations(current => ({ ...current, [id]: restart ? 'restart' : 'start' }))
    setError(undefined)
    let polling = true
    const syncProgress = async (): Promise<void> => {
      while (polling) {
        try {
          const next = await callStudio<StudioDraftView[]>('studio.drafts.list', {})
          if (!polling) return
          const draft = next.find(candidate => candidate.id === id)
          if (draft !== undefined) updateDraft(draft)
        } catch {
          return
        }
        await new Promise(resolve => setTimeout(resolve, 200))
      }
    }
    const progress = syncProgress()
    try {
      if (restart) {
        updateDraft(await callStudio<StudioDraftView>('studio.drafts.stop', { draftId: id }))
        clearSelectedRuntime(id)
      }
      const next = await callStudio<StudioDraftView>('studio.drafts.start', { draftId: id })
      polling = false
      updateDraft(next)
      if (draftIdRef.current === id) setPreviewKey(value => value + 1)
    } catch (cause) {
      polling = false
      try {
        const next = await callStudio<StudioDraftView[]>('studio.drafts.list', {})
        const draft = next.find(candidate => candidate.id === id)
        if (draft !== undefined) updateDraft(draft)
      } catch {}
      if (draftIdRef.current === id) setError(cause instanceof StudioRpcError ? cause.message : String(cause))
    } finally {
      polling = false
      await progress
      setInstanceOperations(current => {
        const next = { ...current }
        delete next[id]
        return next
      })
    }
  }

  const startDraft = (): Promise<void> => runDraftStart(false)
  const restartDraft = (): Promise<void> => runDraftStart(true)

  const stopDraft = async (): Promise<void> => {
    if (selectedDraftId === undefined) return
    const id = selectedDraftId
    setInstanceOperations(current => ({ ...current, [id]: 'stop' }))
    setError(undefined)
    try {
      updateDraft(await callStudio<StudioDraftView>('studio.drafts.stop', { draftId: id }))
      clearSelectedRuntime(id)
    } catch (cause) {
      if (draftIdRef.current === id) setError(cause instanceof StudioRpcError ? cause.message : String(cause))
    } finally {
      setInstanceOperations(current => {
        const next = { ...current }
        delete next[id]
        return next
      })
    }
  }

  const hotReloadDraft = async (): Promise<void> => {
    if (selectedDraftId === undefined) return
    if (hasUnsavedSource) {
      setPanel('source')
      setError(t('errorUnsavedReload'))
      return
    }
    const id = selectedDraftId
    setBuildOperations(current => ({ ...current, [id]: true }))
    setError(undefined)
    try {
      const result = await callStudio<StudioBuildResult>('studio.project.build', { draftId: id })
      setBuildOutputs(current => ({ ...current, [id]: result.build }))
      updateDraftProject(id, result.project)
      if (draftIdRef.current === id) setPreviewKey(value => value + 1)
    } catch (cause) {
      if (draftIdRef.current === id) setError(cause instanceof StudioRpcError ? cause.message : String(cause))
    } finally {
      setBuildOperations(current => {
        const next = { ...current }
        delete next[id]
        return next
      })
    }
  }

  const confirmPreview = async (graphRev: string): Promise<void> => {
    if (selectedDraftId === undefined || (project?.state !== 'staged' && project?.state !== 'preview-pending') || confirming) return
    setConfirming(true)
    setError(undefined)
    try {
      const active = await callStudio<StudioProjectState>('studio.project.activate', { draftId: selectedDraftId, graphRev })
      updateDraftProject(selectedDraftId, active)
    } catch (cause) {
      setError(cause instanceof StudioRpcError ? cause.message : String(cause))
    } finally {
      setConfirming(false)
    }
  }

  const connectPreview = (event: MessageEvent): void => {
    const target = previewRef.current?.contentWindow
    if (target === undefined || target === null || previewSession === undefined || previewUrl === undefined || selectedDraftId === undefined) return
    const targetOrigin = new URL(previewUrl).origin
    if (event.source !== target || event.origin !== targetOrigin || event.ports.length !== 1
      || previewPort.current !== undefined || !isBridgeOffer(event.data, previewSession)) return
    const nextPort = event.ports[0]
    previewPort.current = nextPort
    nextPort.onmessage = portEvent => {
      if (!isBridgeEnvelope(portEvent.data, previewSession, previewNonce.current)) return
      const message = portEvent.data
      if (message.type === 'preview-ready' && boundedBridgeText(message.graphRev) && message.graphRev !== ''
        && (message.mode === 'browse' || message.mode === 'inspect')) {
        nextPort.postMessage({ type: 'set-mode', sessionId: previewSession, nonce: previewNonce.current, mode: previewModeRef.current })
        queuePreviewUpdate(selectedDraftId, {
          connected: true,
          graphRev: message.graphRev,
          mode: previewModeRef.current,
        })
        void confirmPreview(message.graphRev)
      }
      if (message.type === 'selection' && isStudioDomSelection(message.selection)) {
        const raw = message.selection
        const request = ++selectionResolve.current
        const expectedNonce = previewNonce.current
        const commit = (next: StudioDomSelection): void => {
          if (request !== selectionResolve.current || previewPort.current !== nextPort
            || expectedNonce !== previewNonce.current) return
          setSelection(next)
          queuePreviewUpdate(selectedDraftId, { connected: true, mode: 'inspect', selection: next })
        }
        if (raw.react?.source === undefined) commit(raw)
        else void callStudio<StudioSourceCandidate>('studio.preview.resolveSource', {
          draftId: selectedDraftId,
          source: raw.react.source,
        }).then(resolved => commit({
          ...raw,
          react: { ...raw.react!, source: { ...raw.react!.source!, resolved } },
        })).catch(cause => {
          if (request === selectionResolve.current) setError(cause instanceof StudioRpcError ? cause.message : String(cause))
        })
      }
      if (message.type === 'preview-pan' && isFinitePreviewPan(message)) {
        setPreviewOrigin(current => ({
          x: current.x + message.dx,
          y: current.y + message.dy,
        }))
      }
      if (message.type === 'preview-zoom' && isFinitePreviewZoom(message)) {
        zoomPreviewByWheel(message.deltaY, message.deltaMode)
      }
      if (message.type === 'registry' && isStudioRegistrySnapshot(message.registry)) {
        const nextRegistry = message.registry
        setRegistry(nextRegistry)
        queuePreviewUpdate(selectedDraftId, {
          connected: true,
          mode: previewModeRef.current,
          registry: nextRegistry,
        })
      }
      if (message.type === 'registry-error' && boundedBridgeText(message.error)) {
        setError(message.error)
      }
      if (message.type === 'selection-error' && boundedBridgeText(message.error)) setError(message.error)
      if (message.type === 'variable-result' && message.ok === false && boundedBridgeText(message.error)) setError(message.error)
      if (message.type === 'mode' && (message.mode === 'browse' || message.mode === 'inspect')) {
        previewModeRef.current = message.mode
        setPreviewMode(message.mode)
      }
    }
    nextPort.start()
    nextPort.postMessage({ type: 'connect', sessionId: previewSession, nonce: previewNonce.current })
  }
  previewBridgeHandlerRef.current = connectPreview

  const openFile = async (path: string): Promise<void> => {
    if (path === '' || selectedDraftId === undefined) return
    if (path === filePath) return
    if (hasUnsavedSource) {
      setPanel('source')
      setError(t('errorUnsavedOpenFile'))
      return
    }
    const draftId = selectedDraftId
    const request = ++fileRequest.current
    setFileBusy(true)
    setError(undefined)
    try {
      const file = await callStudio<{ path: string; content: string }>('studio.project.readFile', { draftId, path })
      if (fileRequest.current !== request || draftIdRef.current !== draftId) return
      setFilePath(file.path)
      setSource(file.content)
      setSavedSource(file.content)
    } catch (cause) {
      if (fileRequest.current === request && draftIdRef.current === draftId) {
        setError(cause instanceof StudioRpcError ? cause.message : String(cause))
      }
    } finally {
      if (fileRequest.current === request && draftIdRef.current === draftId) setFileBusy(false)
    }
  }

  const saveFile = async (): Promise<void> => {
    if (filePath === '' || selectedDraftId === undefined) return
    const draftId = selectedDraftId
    const path = filePath
    const content = source
    const request = ++fileRequest.current
    setFileBusy(true)
    setError(undefined)
    try {
      await callStudio('studio.project.writeFile', { draftId, path, content })
      if (fileRequest.current !== request || draftIdRef.current !== draftId) return
      setSavedSource(content)
      void callStudio<StudioReadinessReport>('studio.readiness.inspect', { draftId }).then(next => {
        if (fileRequest.current === request && draftIdRef.current === draftId) setReadiness(next)
      }).catch(() => undefined)
    } catch (cause) {
      if (fileRequest.current === request && draftIdRef.current === draftId) {
        setError(cause instanceof StudioRpcError ? cause.message : String(cause))
      }
    } finally {
      if (fileRequest.current === request && draftIdRef.current === draftId) setFileBusy(false)
    }
  }

  useEffect(() => {
    const save = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      if (!fileBusy && filePath !== '' && source !== savedSource) void saveFile()
    }
    window.addEventListener('keydown', save, { capture: true })
    return () => window.removeEventListener('keydown', save, { capture: true })
  }, [fileBusy, filePath, savedSource, selectedDraftId, source])

  useEffect(() => {
    if (!hasUnsavedSource) return
    const warn = (event: BeforeUnloadEvent): void => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasUnsavedSource])

  const changePreviewMode = (mode: 'browse' | 'inspect'): void => {
    previewModeRef.current = mode
    setPreviewMode(mode)
    previewPort.current?.postMessage({
      type: 'set-mode',
      sessionId: previewSession,
      nonce: previewNonce.current,
      mode,
    })
    if (selectedDraftId !== undefined) queuePreviewUpdate(selectedDraftId, { connected: true, mode })
  }

  const setVariable = (
    target:
      | { scope: 'element'; owner: string; elementId: string; variableId: string; value: StudioVariableValue }
      | { scope: 'global'; owner: string; variableId: string; value: StudioVariableValue },
  ): void => {
    setError(undefined)
    previewPort.current?.postMessage({
      type: 'set-variable',
      requestId: crypto.randomUUID(),
      sessionId: previewSession,
      nonce: previewNonce.current,
      target,
    })
  }

  const togglePreviewFullscreen = (): void => {
    setPreviewZoomFocus(undefined)
    setPreviewFullscreen(current => !current)
  }

  const togglePreviewAspectLock = (): void => {
    setPreviewAspectLocked(current => {
      if (!current) previewLockedAspectRatioRef.current = previewViewport.width / previewViewport.height
      return !current
    })
  }

  const runPack = async (): Promise<void> => {
    if (project === undefined || selectedDraftId === undefined) return
    const draftId = selectedDraftId
    const request = ++packRequest.current
    setPackingDraftId(draftId)
    setError(undefined)
    try {
      const next = await callStudio<StudioReadinessReport>('studio.readiness.pack', { draftId })
      if (packRequest.current === request && draftIdRef.current === draftId) setReadiness(next)
    } catch (cause) {
      if (packRequest.current === request && draftIdRef.current === draftId) {
        setError(cause instanceof StudioRpcError ? cause.message : String(cause))
      }
    } finally {
      setPackingDraftId(current => current === draftId ? undefined : current)
    }
  }

  const createAgent = async (): Promise<void> => {
    if (selectedDraftId === undefined) return
    const draftId = selectedDraftId
    const projectName = project?.name ?? 'Draft'
    setCreatingAgentDraftId(draftId)
    setError(undefined)
    setInteraction(undefined)
    try {
      const result = await callStudio<StudioCreateAgentResult>('studio.agent.create', { draftId })
      setDrafts(current => current.map(draft => draft.id === draftId ? { ...draft, agent: result } : draft))
      if (draftIdRef.current === draftId) setSessionId(result.sessionId)
      const studioSession = result.sessionId as SessionId
      await studioApi.sessions.rename({ sessionId: studioSession, title: `Studio: ${projectName}` })
    } catch (cause) {
      if (draftIdRef.current === draftId) setError(cause instanceof StudioRpcError ? cause.message : String(cause))
    } finally {
      setCreatingAgentDraftId(current => current === draftId ? undefined : current)
    }
  }

  const sendPrompt = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const text = prompt.trim()
    if (sessionId === undefined || text === '') return
    setSending(true)
    setError(undefined)
    try {
      apiValue(await studioApi.sessions.prompt({
        sessionId: sessionId as SessionId,
        mode: 'queue',
        content: [{ type: 'text', text }],
      }))
      setPrompt('')
    } catch (cause) {
      setError(cause instanceof StudioRpcError ? cause.message : String(cause))
    } finally {
      setSending(false)
    }
  }

  const cancel = async (): Promise<void> => {
    if (sessionId === undefined) return
    try {
      apiValue(await studioApi.sessions.cancel({ sessionId: sessionId as SessionId }))
    } catch (cause) {
      setError(cause instanceof StudioRpcError ? cause.message : String(cause))
    }
  }

  const selectDraft = (draftId: string, nextOpenDraftIds = openDraftIds): boolean => {
    if (draftId !== selectedDraftId && hasUnsavedSource) {
      setPanel('source')
      setError(t('errorUnsavedSwitchDraft'))
      return false
    }
    activateDraft(draftId)
    setSelection(undefined)
    setRegistry(EMPTY_REGISTRY)
    setFocusedElementId(undefined)
    queueWorkspaceUpdate(nextOpenDraftIds, draftId)
    return true
  }

  const openDraft = (draftId: string): void => {
    const nextOpenDraftIds = openDraftIds.includes(draftId) ? openDraftIds : [...openDraftIds, draftId]
    if (!selectDraft(draftId, nextOpenDraftIds)) return
    setOpenDraftIds(nextOpenDraftIds)
  }

  const closeDraft = (draftId: string): void => {
    if (draftId === selectedDraftId && hasUnsavedSource) {
      setPanel('source')
      setError(t('errorUnsavedCloseDraft'))
      return
    }
    const index = openDraftIds.indexOf(draftId)
    const nextOpenDraftIds = openDraftIds.filter(id => id !== draftId)
    setOpenDraftIds(nextOpenDraftIds)
    const nextDraftId = draftId === selectedDraftId
      ? nextOpenDraftIds[Math.min(index, nextOpenDraftIds.length - 1)]
      : selectedDraftId
    queueWorkspaceUpdate(nextOpenDraftIds, nextDraftId)
    if (draftId !== selectedDraftId) return
    activateDraft(nextDraftId)
    setSelection(undefined)
    setRegistry(EMPTY_REGISTRY)
    setFocusedElementId(undefined)
  }

  const moveDraftTabToIndex = (draftId: string, targetIndex: number): void => {
    const sourceIndex = openDraftIds.indexOf(draftId)
    if (sourceIndex === -1) return
    const reordered = openDraftIds.filter(id => id !== draftId)
    const boundedIndex = Math.max(0, Math.min(targetIndex, reordered.length))
    reordered.splice(boundedIndex, 0, draftId)
    if (reordered.every((id, index) => id === openDraftIds[index])) return
    setOpenDraftIds(reordered)
    queueWorkspaceUpdate(reordered, selectedDraftId)
  }

  const beginDraftTabPointerDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    draftId: string,
    sourceIndex: number,
  ): void => {
    if (!event.isPrimary || event.button !== 0) return
    const tab = event.currentTarget.closest<HTMLElement>('.draft-tab')
    const root = event.currentTarget.closest<HTMLElement>('.studio-ui-root')
    const tabList = tab?.parentElement
    if (tab === null || root === null || !tabList?.classList.contains('draft-tab-list')) return
    const rail = tabList.parentElement
    if (rail === null || rail === undefined) return

    activeDragCleanupRef.current?.()
    const pointerId = event.pointerId
    const startX = event.clientX
    const startY = event.clientY
    const bounds = tab.getBoundingClientRect()
    const tabGap = Number.parseFloat(getComputedStyle(tabList).columnGap) || 0
    const tabSpan = bounds.width + tabGap
    const tabRects = Array.from(tabList.querySelectorAll<HTMLElement>(':scope > .draft-tab'))
      .map((element, index) => ({ id: element.dataset.draftId, index, bounds: element.getBoundingClientRect() }))
    const railBounds = rail.getBoundingClientRect()
    const siblingCenters = tabRects
      .filter(item => item.id !== draftId)
      .map(item => item.bounds.left + item.bounds.width / 2)
    const collapsedSiblingCenters = tabRects
      .filter(item => item.id !== draftId)
      .map(item => item.bounds.left + item.bounds.width / 2 - (item.index > sourceIndex ? tabSpan : 0))
    const pointerOffsetX = startX - bounds.left
    const pointerOffsetY = startY - bounds.top
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    let dragging = false
    let targetIndex: number | undefined
    let indicator = false
    let preview: HTMLElement | undefined

    const cleanup = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', cancel)
      preview?.remove()
      delete document.body.dataset.studioDragging
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      setDraftTabDrag(undefined)
      activeDragCleanupRef.current = undefined
    }
    const start = (nextEvent: PointerEvent): void => {
      dragging = true
      preview = tab.cloneNode(true) as HTMLElement
      preview.classList.add('draft-tab-drag-preview')
      preview.removeAttribute('data-active')
      preview.removeAttribute('data-dragging')
      preview.removeAttribute('data-draft-id')
      preview.style.removeProperty('--draft-tab-shift')
      preview.style.width = `${bounds.width}px`
      preview.style.height = `${bounds.height}px`
      root.append(preview)
      document.body.dataset.studioDragging = 'true'
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
      setDraftTabDrag({ draftId, sourceIndex, targetIndex, indicator, span: tabSpan, width: bounds.width })
      update(nextEvent)
    }
    const update = (nextEvent: PointerEvent): void => {
      const left = nextEvent.clientX - pointerOffsetX
      const top = nextEvent.clientY - pointerOffsetY
      if (preview !== undefined) preview.style.transform = `translate3d(${left}px, ${top}px, 0)`
      const draggedCenter = left + bounds.width / 2
      const insideRail = nextEvent.clientX >= railBounds.left && nextEvent.clientX <= railBounds.right
        && nextEvent.clientY >= railBounds.top && nextEvent.clientY <= railBounds.bottom
      const insertionIndex = siblingCenters.filter(center => center < draggedCenter).length
      const nextTargetIndex = insideRail
        ? insertionIndex !== sourceIndex ? insertionIndex : undefined
        : collapsedSiblingCenters.filter(center => center < draggedCenter).length
      const nextIndicator = !insideRail
      if (nextTargetIndex === targetIndex && nextIndicator === indicator) return
      targetIndex = nextTargetIndex
      indicator = nextIndicator
      setDraftTabDrag(current => current === undefined ? current : { ...current, targetIndex, indicator })
    }
    const move = (nextEvent: PointerEvent): void => {
      if (nextEvent.pointerId !== pointerId) return
      if (!dragging && Math.hypot(nextEvent.clientX - startX, nextEvent.clientY - startY) < 5) return
      nextEvent.preventDefault()
      if (!dragging) start(nextEvent)
      else update(nextEvent)
    }
    const end = (nextEvent: PointerEvent): void => {
      if (nextEvent.pointerId !== pointerId) return
      if (!dragging) {
        cleanup()
        return
      }
      suppressDraftTabClickRef.current = draftId
      cleanup()
      if (targetIndex !== undefined) moveDraftTabToIndex(draftId, targetIndex)
      window.setTimeout(() => {
        if (suppressDraftTabClickRef.current === draftId) suppressDraftTabClickRef.current = undefined
      })
    }
    const cancel = (nextEvent: PointerEvent): void => {
      if (nextEvent.pointerId === pointerId) cleanup()
    }

    activeDragCleanupRef.current = cleanup
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', cancel)
  }

  const selectDraftByKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault()
      const nextIndex = event.key === 'ArrowLeft' ? Math.max(0, index - 1) : Math.min(openDrafts.length - 1, index + 1)
      const draft = openDrafts[index]
      if (draft !== undefined && nextIndex !== index) moveDraftTabToIndex(draft.id, nextIndex)
      return
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const last = openDrafts.length - 1
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? last
      : event.key === 'ArrowLeft' ? (index + last) % openDrafts.length : (index + 1) % openDrafts.length
    const draft = openDrafts[nextIndex]
    if (draft === undefined || !selectDraft(draft.id)) return
    event.currentTarget.closest('.draft-tab-list')
      ?.querySelectorAll<HTMLButtonElement>('.draft-tab-select')[nextIndex]?.focus()
  }

  const beginPointerDrag = (
    event: ReactPointerEvent<HTMLElement>,
    cursor: string,
    onMove: (dx: number, dy: number) => void,
  ): void => {
    event.preventDefault()
    activeDragCleanupRef.current?.()
    const startX = event.clientX
    const startY = event.clientY
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.dataset.studioDragging = 'true'
    document.body.style.cursor = cursor
    document.body.style.userSelect = 'none'
    const move = (nextEvent: PointerEvent): void => onMove(nextEvent.clientX - startX, nextEvent.clientY - startY)
    const cleanup = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
      delete document.body.dataset.studioDragging
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      activeDragCleanupRef.current = undefined
    }
    activeDragCleanupRef.current = cleanup
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', cleanup)
    window.addEventListener('pointercancel', cleanup)
  }

  const beginPreviewPan = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 1) return
    event.stopPropagation()
    const initial = previewOrigin
    beginPointerDrag(event, 'grabbing', (dx, dy) => {
      setPreviewOrigin({ x: initial.x + dx, y: initial.y + dy })
    })
  }

  const beginPreviewZoomFocusMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || previewZoomFocus === undefined) return
    event.stopPropagation()
    const initial = previewZoomFocus
    const stage = previewStageRef.current?.getBoundingClientRect()
    const radius = event.currentTarget.getBoundingClientRect().width / 2
    beginPointerDrag(event, 'grabbing', (dx, dy) => {
      setPreviewZoomFocus(current => current === undefined || stage === undefined ? current : {
        x: clamp(initial.x + dx, radius, Math.max(radius, stage.width - radius)),
        y: clamp(initial.y + dy, radius, Math.max(radius, stage.height - radius)),
        phase: 'active',
      })
    })
  }

  const suppressPreviewMiddleMouse = (event: ReactMouseEvent<HTMLElement>): void => {
    if (event.button !== 1) return
    event.preventDefault()
    event.stopPropagation()
  }

  const zoomPreviewFromCanvas = (event: ReactWheelEvent<HTMLElement>): void => {
    if (event.target instanceof Element && event.target.closest('.preview-artboard') !== null) return
    event.preventDefault()
    if (previewMode === 'browse') {
      const overFocus = event.target instanceof Element && event.target.closest('.preview-zoom-focus') !== null
      const stage = event.currentTarget.getBoundingClientRect()
      const phase: PreviewZoomFocus['phase'] = document.hasFocus() ? 'active' : 'fading'
      setPreviewZoomFocus(current => overFocus && current !== undefined
        ? { ...current, phase }
        : { x: event.clientX - stage.left, y: event.clientY - stage.top, phase })
    }
    zoomPreviewByWheel(event.deltaY, event.deltaMode)
  }

  const beginSidebarResize = (event: ReactPointerEvent<HTMLElement>, side: 'left' | 'right'): void => {
    const initial = side === 'left' ? leftSidebarWidth : rightSidebarWidth
    beginPointerDrag(event, 'col-resize', dx => {
      if (side === 'left') setLeftSidebarWidth(clamp(initial + dx, LEFT_SIDEBAR_MIN, LEFT_SIDEBAR_MAX))
      else setRightSidebarWidth(clamp(initial - dx, RIGHT_SIDEBAR_MIN, RIGHT_SIDEBAR_MAX))
    })
  }

  const changeSidebarWidthByKeyboard = (side: 'left' | 'right', delta: number): void => {
    if (side === 'left') setLeftSidebarWidth(value => clamp(value + delta, LEFT_SIDEBAR_MIN, LEFT_SIDEBAR_MAX))
    else setRightSidebarWidth(value => clamp(value - delta, RIGHT_SIDEBAR_MIN, RIGHT_SIDEBAR_MAX))
  }

  const changePreviewAspectRatio = (value: PreviewAspectRatio): void => {
    if (value === 'custom') return
    const ratio = aspectRatioValue(value)
    const nextViewport = {
      ...previewViewport,
      height: Math.max(1, Math.round(previewViewport.width / ratio)),
    }
    if (previewAspectLocked) previewLockedAspectRatioRef.current = ratio
    setPreviewAspectRatio(value)
    setPreviewViewport(nextViewport)
    fitPreviewToStage(nextViewport)
  }

  const changePreviewDimension = (dimension: 'width' | 'height', value: number): void => {
    if (!Number.isFinite(value)) return
    setPreviewViewport(current => {
      const nextValue = Math.max(1, Math.round(value))
      const ratio = previewLockedAspectRatioRef.current
      const next = previewAspectLocked
        ? dimension === 'width'
          ? { width: nextValue, height: Math.max(1, Math.round(nextValue / ratio)) }
          : { width: Math.max(1, Math.round(nextValue * ratio)), height: nextValue }
        : { ...current, [dimension]: nextValue }
      setPreviewAspectRatio(aspectRatioLabel(next.width, next.height))
      return next
    })
  }

  const changePreviewScale = (nextScale: number): void => {
    if (!Number.isFinite(nextScale)) return
    const scale = Math.max(0.01, nextScale)
    const visibleWidth = Math.max(0, previewStageSize.width - previewInsets.left - previewInsets.right)
    setPreviewScale(scale)
    setPreviewOrigin({
      x: previewInsets.left + (visibleWidth - previewViewport.width * scale) / 2,
      y: (previewStageSize.height - previewViewport.height * scale) / 2,
    })
  }

  const beginPreviewResize = (event: ReactPointerEvent<HTMLElement>, direction: ResizeDirection): void => {
    const initial = previewRect
    beginPointerDrag(event, `${direction}-resize`, (dx, dy) => {
      const next = resizeRect(initial, direction, dx, dy, undefined, {
        width: PREVIEW_MIN_SIZE.width * previewScale,
        height: PREVIEW_MIN_SIZE.height * previewScale,
      }, previewAspectLocked)
      const viewport = {
        width: Math.max(1, Math.round(next.width / previewScale)),
        height: Math.max(1, Math.round(next.height / previewScale)),
      }
      setPreviewOrigin({ x: next.x, y: next.y })
      setPreviewViewport(viewport)
      setPreviewAspectRatio(aspectRatioLabel(viewport.width, viewport.height))
    })
  }

  const unlockPreviewSelection = (): void => {
    previewPort.current?.postMessage({
      type: 'unlock-selection',
      sessionId: previewSession,
      nonce: previewNonce.current,
    })
  }

  const terminalViewportBounds = (): LayoutRect => ({
    x: 8,
    y: 8,
    width: Math.max(0, window.innerWidth - 16),
    height: Math.max(0, window.innerHeight - 16),
  })

  const defaultTerminalRect = (): LayoutRect => {
    const preview = previewSectionRef.current?.getBoundingClientRect()
    const bounds = terminalViewportBounds()
    const availableWidth = Math.max(TERMINAL_MIN_SIZE.width, (preview?.width ?? bounds.width) - 24)
    const width = Math.min(900, availableWidth, bounds.width)
    const height = Math.min(440, Math.max(260, (preview?.height ?? bounds.height) * 0.42), bounds.height)
    const x = clamp((preview?.left ?? bounds.x) + 12, bounds.x, bounds.x + bounds.width - width)
    const y = clamp((preview?.bottom ?? bounds.y + bounds.height) - height - 12,
      bounds.y, bounds.y + bounds.height - height)
    return { x, y, width, height }
  }

  const beginTerminalMove = (event: ReactPointerEvent<HTMLElement>): void => {
    if (terminalRect === undefined || (event.target as HTMLElement).closest('button') !== null) return
    const initial = terminalRect
    beginPointerDrag(event, 'move', (dx, dy) => setTerminalRect(moveRect(initial, dx, dy, terminalViewportBounds())))
  }

  const beginTerminalResize = (event: ReactPointerEvent<HTMLElement>, direction: ResizeDirection): void => {
    if (terminalRect === undefined) return
    const initial = terminalRect
    beginPointerDrag(event, `${direction}-resize`, (dx, dy) => setTerminalRect(resizeRect(
      initial,
      direction,
      dx,
      dy,
      terminalViewportBounds(),
      TERMINAL_MIN_SIZE,
      false,
    )))
  }

  const toggleTerminal = (): void => {
    const scrollTop = terminalRef.current?.scrollTop
    if (terminalExpanded) setLeftSidebarCollapsed(false)
    else setTerminalRect(defaultTerminalRect())
    setTerminalMinimized(false)
    setTerminalExpanded(!terminalExpanded)
    requestAnimationFrame(() => {
      const terminal = terminalRef.current
      if (terminal !== null) terminal.scrollTop = terminalPinnedRef.current ? terminal.scrollHeight : scrollTop ?? 0
      terminalToggleRef.current?.focus()
    })
  }

  const toggleTerminalMinimized = (): void => {
    if (!terminalMinimized) {
      setTerminalExpanded(false)
      setLeftSidebarCollapsed(false)
    }
    setTerminalMinimized(value => !value)
    requestAnimationFrame(() => {
      const output = terminalRef.current
      if (output !== null && terminalPinnedRef.current) output.scrollTop = output.scrollHeight
    })
  }

  const terminal = selectedDraft === undefined ? null : <section id="draft-terminal"
    className="host-terminal studio-ui-root" data-expanded={terminalExpanded} data-minimized={terminalMinimized}
    style={terminalExpanded && terminalRect !== undefined ? {
      left: terminalRect.x,
      top: terminalRect.y,
      width: terminalRect.width,
      height: terminalRect.height,
    } : undefined}
    aria-label={t('terminalHostLabel')}>
    <div className="host-terminal-bar" data-draggable={terminalExpanded || undefined}
      onPointerDown={terminalExpanded ? beginTerminalMove : undefined}>
      <button type="button" className="terminal-section-toggle"
        aria-expanded={!terminalMinimized} aria-controls="draft-terminal-output" onClick={toggleTerminalMinimized}>
        <DisclosureIcon expanded={!terminalMinimized} /><strong>{t('terminal')}</strong>
        {terminalMinimized && <code className="terminal-latest-line" title={terminalLatestLine}>{terminalLatestLine}</code>}
        {!terminalMinimized && terminalRuntimeLabel !== undefined
          && <span className="terminal-runtime-state" aria-live="polite" data-state={terminalRuntimeState}>
            {terminalRuntimeLabel}
          </span>}
      </button>
      <div className="host-terminal-actions">
        <IconButton ref={terminalToggleRef} className="terminal-layout-button" size="small" variant="ghost"
          aria-expanded={terminalExpanded} aria-controls="draft-terminal" onClick={toggleTerminal}
          label={terminalExpanded ? t('terminalDock') : t('terminalExpand')}>
          <TerminalLayoutIcon expanded={terminalExpanded} />
        </IconButton>
      </div>
    </div>
    {!terminalMinimized && <pre id="draft-terminal-output" ref={terminalRef} role="log" aria-live="off"
      aria-label={t('terminalReadonly')} tabIndex={0} onScroll={event => {
      const terminal = event.currentTarget
      terminalPinnedRef.current = terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 24
    }}>{terminalOutput || t('terminalNotStarted')}</pre>}
    {terminalExpanded && !terminalMinimized && <ResizeHandles kind="terminal" onPointerDown={beginTerminalResize} />}
  </section>

  return <div className="studio-shell studio-ui-root" onPointerDownCapture={event => {
    const target = event.target instanceof Element ? event.target : undefined
    if (previewMode === 'inspect' && target?.closest('.preview-viewport') === null) unlockPreviewSelection()
  }}>
    <header className="studio-header">
      <div className="studio-brand">
        <span className="studio-mark" aria-hidden="true">
          <img className="studio-mark-color" src={`${STUDIO_PATH}/assets/harmony-icon.png`} alt="" />
          <img className="studio-mark-mono" src={`${STUDIO_PATH}/assets/harmony-icon-mono.png`} alt="" />
        </span>
        <div><strong>DeepSeek WebUI Studio</strong><span>{t('appSubtitle')}</span></div>
      </div>
      <nav className="draft-tabs" aria-label={t('draftWorkspace')} data-empty={!loadingDrafts && openDrafts.length === 0 || undefined}>
        <div className="draft-tab-list" role="tablist" aria-label={t('draftTabs')}>
          {loadingDrafts
            ? <span className="draft-tabs-loading" aria-live="polite">{t('draftLoading')}</span>
            : <>
              {openDrafts.map((draft, index) => {
                  const state = (instanceOperations[draft.id] === 'start' || instanceOperations[draft.id] === 'restart')
                    && draft.runtime.state !== 'running'
                    ? 'starting' : draft.runtime.state
                  const dirty = draft.id === selectedDraftId && hasUnsavedSource
                  let shift = 0
                  let dropIndicator: 'before' | 'after' | undefined
                  if (draftTabDrag !== undefined && draft.id !== draftTabDrag.draftId) {
                    const visibleIndex = index < draftTabDrag.sourceIndex ? index : index - 1
                    if (index > draftTabDrag.sourceIndex) shift -= draftTabDrag.span
                    if (!draftTabDrag.indicator && draftTabDrag.targetIndex !== undefined
                      && visibleIndex >= draftTabDrag.targetIndex) {
                      shift += draftTabDrag.span
                    }
                    if (draftTabDrag.indicator && draftTabDrag.targetIndex !== undefined) {
                      if (visibleIndex === draftTabDrag.targetIndex) dropIndicator = 'before'
                      else if (draftTabDrag.targetIndex === openDrafts.length - 1
                        && visibleIndex === openDrafts.length - 2) dropIndicator = 'after'
                    }
                  }
                  return <div key={draft.id} className="draft-tab" data-draft-id={draft.id}
                    data-active={draft.id === selectedDraftId || undefined}
                    data-dragging={draftTabDrag?.draftId === draft.id || undefined}
                    data-drop-indicator={dropIndicator}
                    style={{ '--draft-tab-shift': `${shift}px` } as CSSProperties}>
                    <button id={`draft-tab-${draft.id}`} className="draft-tab-select" type="button" role="tab"
                      aria-selected={draft.id === selectedDraftId} aria-controls="draft-workspace"
                      tabIndex={draft.id === selectedDraftId ? 0 : -1}
                      aria-label={t('draftTabLabel', {
                        name: draft.label,
                        state: runtimeLabel(state, t),
                        dirty: dirty ? t('draftTabDirtySuffix') : '',
                      })}
                      title={t('draftTabMoveHint')}
                      onPointerDown={event => beginDraftTabPointerDrag(event, draft.id, index)}
                      onClick={() => {
                        if (suppressDraftTabClickRef.current === draft.id) {
                          suppressDraftTabClickRef.current = undefined
                          return
                        }
                        selectDraft(draft.id)
                      }} onKeyDown={event => selectDraftByKeyboard(event, index)}>
                      <span className="draft-tab-label" data-state={state}>
                        <span className="draft-tab-dot" aria-hidden="true" />
                        <span>{draft.label}</span>
                        {dirty && <span className="draft-tab-dirty" aria-hidden="true" />}
                      </span>
                    </button>
                    <IconButton className="draft-tab-close" size="small" variant="ghost"
                      onClick={() => closeDraft(draft.id)} label={t('draftClose', { name: draft.label })}><CloseIcon /></IconButton>
                  </div>
                })}
            </>}
        </div>
        <IconButton className="draft-tab-add" size="small" variant="ghost" aria-haspopup="dialog"
          aria-expanded={createDialogOpen} aria-controls="studio-create-draft-dialog"
          style={{ '--draft-tab-add-shift': `${draftTabDrag !== undefined
            && (draftTabDrag.indicator || draftTabDrag.targetIndex === undefined) ? -draftTabDrag.span : 0}px` } as CSSProperties}
          data-empty={!loadingDrafts && openDrafts.length === 0 || undefined}
          onClick={() => setCreateDialogOpen(true)} label={t('draftNew')}>
          <PlusIcon />
          {!loadingDrafts && openDrafts.length === 0 && <span className="draft-tab-add-label">{t('draftNew')}</span>}
        </IconButton>
        {!loadingDrafts && openDrafts.length === 0
          && <span className="draft-tabs-empty">{t('draftOpenFromPlugins')}</span>}
      </nav>
      <div className="studio-header-actions">
        <IconButton className="settings-button" size="small" variant="ghost" label={t('settings')}
          title={t('settings')} onClick={() => setSettingsOpen(true)}><SettingsIcon /></IconButton>
        <Status tone={connected ? 'success' : 'neutral'} label={localDshStatusLabel}>{localDshStatusLabel}</Status>
      </div>
    </header>

    <main id="draft-workspace" className="studio-main" role="tabpanel"
      aria-labelledby={selectedDraftId === undefined ? undefined : `draft-tab-${selectedDraftId}`}
      data-left-collapsed={leftSidebarCollapsed} data-right-collapsed={rightSidebarCollapsed}
      data-preview-fullscreen={previewFullscreen || undefined}
      style={{
        '--studio-left-sidebar': `${leftSidebarCollapsed ? 48 : leftSidebarWidth}px`,
        '--studio-right-sidebar': `${rightSidebarCollapsed ? 56 : rightSidebarWidth}px`,
      } as CSSProperties}>
      <Panel id="dsh-control-sidebar" as="aside" className="studio-project studio-sidebar" data-collapsed={leftSidebarCollapsed}
        aria-label={t('controlSidebar')}>
        <div className="sidebar-heading">
          <div className="sidebar-title"><strong>{t('controlTitle')}</strong><span>{t('controlSubtitle')}</span></div>
          <IconButton size="small" variant="ghost" aria-expanded={!leftSidebarCollapsed}
            aria-controls="dsh-control-sidebar" onClick={() => setLeftSidebarCollapsed(value => !value)}
            label={leftSidebarCollapsed ? t('controlExpand') : t('controlCollapse')}>
            <SidebarToggleIcon side="left" collapsed={leftSidebarCollapsed} />
          </IconButton>
        </div>
        <div className="project-body sidebar-content">
        {drafts.length === 0
          ? <EmptyState title={t('createFirstDraft')} description={t('createFirstDraftDescription')}
              action={<Button size="small" variant="primary" onClick={() => setCreateDialogOpen(true)}>{t('draftNew')}</Button>} />
          : <>
              <Tabs id="left-sidebar" className="left-sidebar-tabs" label={t('controlPages')} value={leftPanel}
                onChange={(value: LeftPanel) => setLeftPanel(value)}
                options={[{ value: 'instance', label: t('instanceStatus') }, { value: 'plugins', label: t('pluginManagement') }]} />
              {leftPanel === 'instance' && selectedDraft === undefined
                ? <EmptyState title={t('noActiveDraft')} description={t('noActiveDraftDescription')}
                    action={<Button size="small" onClick={() => setLeftPanel('plugins')}>{t('openPluginManagement')}</Button>} />
                : leftPanel === 'instance' && selectedDraft !== undefined && <section id="left-sidebar-panel-instance" role="tabpanel"
                aria-labelledby="left-sidebar-tab-instance" className="left-sidebar-page instance-control-panel">
                <div className="instance-summary" data-state={selectedInstanceStarting ? 'starting' : selectedDraft.runtime.state}>
                  <span className="instance-status-dot" aria-hidden="true" />
                  <strong>{selectedInstanceOperation === 'restart' ? t('instanceRestarting')
                    : selectedInstanceOperation === 'start' ? t('instanceStarting') : selectedInstanceOperation === 'stop' ? t('instanceStopping')
                    : selectedDraft.runtime.state === 'running' ? t('instanceRunning')
                    : selectedDraft.runtime.state === 'failed' ? t('instanceFailed') : t('instanceStopped')}</strong>
                </div>
                <div className="instance-fields">
                  <label><span>{t('draftName')}</span><Input value={draftLabelInput} maxLength={120}
                    onChange={event => setDraftLabelInput(event.target.value)} onBlur={() => void renameDraft()}
                    onKeyDown={event => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                      if (event.key === 'Escape') {
                        setDraftLabelInput(selectedDraft.label)
                        event.currentTarget.blur()
                      }
                    }} /></label>
                  <label><span>{t('worktreeLocation')}</span><code title={selectedDraft.worktreeDir}>{selectedDraft.worktreeDir}</code></label>
                  {selectedDraft.destinationDirectory !== undefined && <label>
                    <span>{t('draftDestinationDirectory')}</span>
                    <code title={selectedDraft.destinationDirectory}>{selectedDraft.destinationDirectory}</code>
                  </label>}
                </div>
                <div className="instance-actions">
                  <Button size="small" variant="primary" className="sidebar-action-button"
                    onClick={() => void startDraft()} loading={selectedInstanceOperation === 'start'}
                    loadingLabel={t('starting')} disabled={selectedDraft.runtime.state === 'running' || selectedInstanceOperation !== undefined}>
                    <StartIcon />{t('start')}</Button>
                  <Button size="small" className="sidebar-action-button" onClick={() => void stopDraft()}
                    loading={selectedInstanceOperation === 'stop'} loadingLabel={t('stopping')}
                    disabled={selectedDraft.runtime.state !== 'running' || selectedInstanceOperation !== undefined}><StopIcon />{t('stop')}</Button>
                  <Button size="small" className="sidebar-action-button" onClick={() => void restartDraft()}
                    loading={selectedInstanceOperation === 'restart'} loadingLabel={t('restarting')}
                    disabled={selectedDraft.runtime.state !== 'running' || selectedInstanceOperation !== undefined}
                    aria-label={t('restartInstance')}><RefreshIcon />{t('restart')}</Button>
                </div>
                {selectedDraft.destinationDirectory !== undefined && <div className="instance-export">
                  <Button size="small" className="sidebar-action-button" onClick={() => void exportDraft()}
                    loading={exportingDraftId === selectedDraft.id} loadingLabel={t('draftExporting')}>
                    {t('draftExportToFolder')}
                  </Button>
                  <span>{selectedDraft.exportedAt === undefined ? t('draftDestinationPending') : t('draftDestinationSaved')}</span>
                </div>}
                {selectedDraft.runtime.error !== undefined && <Notice tone="danger">{selectedDraft.runtime.error}</Notice>}
              </section>}

              {leftPanel === 'plugins' && <section id="left-sidebar-panel-plugins" role="tabpanel"
                aria-labelledby="left-sidebar-tab-plugins" className="left-sidebar-page plugin-management-page">
                <div className="persistent-draft-list" aria-label={t('persistedDrafts')}>
                  {drafts.map(draft => <article key={draft.id} data-open={openDraftIds.includes(draft.id) || undefined}>
                    <div><strong>{draft.label}</strong><code>{draft.name}</code></div>
                    <Button size="small" variant="ghost" disabled={openDraftIds.includes(draft.id)}
                      onClick={() => openDraft(draft.id)}>{openDraftIds.includes(draft.id) ? t('alreadyOpen') : t('open')}</Button>
                  </article>)}
                </div>
                <p>{t('persistedDraftsDescription')}</p>
              </section>}
            </>}
        </div>
        {!terminalExpanded && terminal}
        {!leftSidebarCollapsed && <span className="sidebar-resizer" data-side="left" role="separator" tabIndex={0}
          aria-label={t('controlResize')} aria-orientation="vertical"
          aria-valuemin={LEFT_SIDEBAR_MIN} aria-valuemax={LEFT_SIDEBAR_MAX} aria-valuenow={leftSidebarWidth}
          onPointerDown={event => beginSidebarResize(event, 'left')}
          onKeyDown={event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            changeSidebarWidthByKeyboard('left', event.key === 'ArrowLeft' ? -12 : 12)
          }} />}
      </Panel>

      <Panel ref={previewSectionRef} className="studio-preview"
        data-fullscreen={previewFullscreen || undefined} aria-label={t('previewLabel')}>
        {previewFullscreen && <div className="preview-fullscreen-tools" aria-label={t('fullscreenStudioControls')}>
          <IconButton className="preview-fullscreen-exit" variant="secondary"
            onClick={togglePreviewFullscreen} label={t('previewExitFullscreen')}>
            <FullscreenIcon active />
          </IconButton>
        </div>}
        <div ref={previewStageRef} className="preview-stage"
          onPointerDownCapture={previewFullscreen ? undefined : beginPreviewPan}
          onMouseDownCapture={previewFullscreen ? undefined : suppressPreviewMiddleMouse}
          onAuxClickCapture={previewFullscreen ? undefined : suppressPreviewMiddleMouse}
          onWheel={previewFullscreen ? undefined : zoomPreviewFromCanvas}>
          {previewZoomFocus !== undefined && !previewFullscreen && <div className="preview-zoom-focus" aria-hidden="true"
            data-phase={previewZoomFocus.phase}
            style={{ left: previewZoomFocus.x, top: previewZoomFocus.y }}
            onPointerDown={beginPreviewZoomFocusMove}
            onPointerEnter={() => setPreviewZoomFocus(current => current === undefined
              ? undefined : { ...current, phase: document.hasFocus() ? 'active' : 'fading' })}
            onPointerLeave={() => setPreviewZoomFocus(current => current === undefined
              ? undefined : { ...current, phase: 'fading' })} />}
          <div className="preview-artboard" data-empty={previewUrl === undefined || undefined}
            data-mode={previewMode}
            style={previewFullscreen
              ? { inset: 0, width: '100%', height: '100%' }
              : { left: previewRect.x, top: previewRect.y, width: previewRect.width, height: previewRect.height }}>
            <div className="preview-viewport" style={previewFullscreen
              ? { width: '100%', height: '100%' }
              : { width: previewViewport.width, height: previewViewport.height, transform: `scale(${previewScale})` }}>
                {previewUrl === undefined
                  ? <EmptyState className="preview-empty"
                      title={selectedDraft !== undefined ? t('previewStartDraft', { name: selectedDraft.label })
                        : drafts.length === 0 ? t('createFirstDraft') : t('previewNoOpenDraft')}
                      description={selectedDraft !== undefined ? t('previewHostDescription')
                        : drafts.length === 0 ? t('previewCreateDescription')
                          : t('previewReopenDescription')}
                      action={selectedDraft === undefined
                        ? drafts.length === 0
                          ? <Button variant="primary" onClick={() => setCreateDialogOpen(true)}>{t('createDraft')}</Button>
                          : <Button variant="primary" onClick={() => {
                              setLeftSidebarCollapsed(false)
                              setLeftPanel('plugins')
                            }}>{t('openPluginManagement')}</Button>
                        : undefined} />
                  : <iframe ref={previewRef} key={`${selectedDraftId}:${previewKey}`} title={t('previewFrameTitle')}
                      src={previewUrl} />}
            </div>
            {!previewFullscreen && <ResizeHandles kind="preview" onPointerDown={beginPreviewResize} />}
          </div>
        </div>
      </Panel>

      <aside id="draft-control-sidebar" className="studio-inspector-rail studio-sidebar" data-collapsed={rightSidebarCollapsed}
        aria-label={t('inspectorSidebar')}>
        {!rightSidebarCollapsed && <span className="sidebar-resizer" data-side="right" role="separator" tabIndex={0}
          aria-label={t('inspectorResize')} aria-orientation="vertical"
          aria-valuemin={RIGHT_SIDEBAR_MIN} aria-valuemax={RIGHT_SIDEBAR_MAX} aria-valuenow={rightSidebarWidth}
          onPointerDown={event => beginSidebarResize(event, 'right')}
          onKeyDown={event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            changeSidebarWidthByKeyboard('right', event.key === 'ArrowLeft' ? -12 : 12)
          }} />}
        <Panel className="preview-inspector studio-inspector-block">
          <div className="preview-inspector-heading">
            {!rightSidebarCollapsed && <div className="control-section-heading"><div><strong>{t('livePreview')}</strong><span>{t('previewInteractionCanvas')}</span></div></div>}
          <IconButton size="small" variant="ghost" aria-expanded={!rightSidebarCollapsed}
            aria-controls="draft-control-sidebar" onClick={() => setRightSidebarCollapsed(value => !value)}
            label={rightSidebarCollapsed ? t('inspectorExpand') : t('inspectorCollapse')}>
            <SidebarToggleIcon side="right" collapsed={rightSidebarCollapsed} />
          </IconButton>
          </div>

        {!rightSidebarCollapsed && <section className="preview-controls" aria-label={t('livePreview')}>
          <div className="preview-mode-field" data-mode={previewMode} data-disabled={previewUrl === undefined || undefined}>
            <div className="preview-mode-heading">
              <strong>{t('interactionMode')}</strong>
              <span>{previewMode === 'browse' ? t('interactionBrowseDescription') : t('interactionInspectDescription')}</span>
            </div>
            <SegmentedControl className="preview-mode-control" label={t('previewInteractionMode')} value={previewMode}
              options={[
                { value: 'browse', label: t('browse'), disabled: previewUrl === undefined },
                { value: 'inspect', label: t('inspect'), disabled: previewUrl === undefined },
              ]} onChange={changePreviewMode} />
          </div>
          <div className="preview-resolution-line">
            <label><span>W</span><Input type="number" min={1} value={previewViewport.width}
              aria-label={t('viewportWidth')} onChange={event => changePreviewDimension('width', event.target.valueAsNumber)} /></label>
            <label><span>H</span><Input type="number" min={1} value={previewViewport.height}
              aria-label={t('viewportHeight')} onChange={event => changePreviewDimension('height', event.target.valueAsNumber)} /></label>
          </div>
          <div className="preview-canvas-line">
            <div className="preview-zoom-control" aria-label={t('previewZoom')}>
              <Button size="small" className="preview-zoom-step" onClick={() => changePreviewScale(previewScale / 1.25)}
                aria-label={t('zoomOut')}>-</Button>
              <span onWheel={event => {
                event.preventDefault()
                zoomPreviewByWheel(event.deltaY, event.deltaMode)
              }}>{Math.round(previewScale * 100)}%</span>
              <Button size="small" className="preview-zoom-step" onClick={() => changePreviewScale(previewScale * 1.25)}
                aria-label={t('zoomIn')}>+</Button>
            </div>
            <Select className="preview-aspect-select" value={previewAspectRatio} aria-label={t('artboardRatio')}
              onChange={event => changePreviewAspectRatio(event.target.value as PreviewAspectRatio)}>
              {previewAspectRatios.map(ratio => <option key={ratio} value={ratio}>{ratio}</option>)}
              {previewAspectRatio === 'custom' && <option value="custom">{t('custom')}</option>}
            </Select>
            <IconButton className="preview-aspect-lock" size="small" variant="secondary"
              aria-pressed={previewAspectLocked} onClick={togglePreviewAspectLock}
              label={previewAspectLocked ? t('unlockAspectRatio') : t('lockAspectRatio')}>
              <AspectRatioLockIcon locked={previewAspectLocked} />
            </IconButton>
          </div>
          <div className="control-action-row">
            <Button size="small" className="sidebar-action-button preview-fit-button"
              onClick={() => fitPreviewToStage()}>{t('fitCanvas')}</Button>
            <Button size="small" className="sidebar-action-button preview-fullscreen-button" disabled={previewUrl === undefined}
              onClick={togglePreviewFullscreen}>
              <FullscreenIcon active={previewFullscreen} />{previewFullscreen ? t('exitFullscreen') : t('fullscreen')}
            </Button>
          </div>
        </section>}
        </Panel>

        <Panel className="studio-inspector studio-inspector-block">
          <div className="inspector-nav">
            <Tabs id="studio" label={t('studioTools')} value={panel} onChange={(value: Panel) => setPanel(value)} options={panels.map(item => ({
              value: item,
              label: item === 'elements' ? t('panelElements') : item === 'selection' ? t('panelSelect') : item === 'source' ? t('panelSource')
                : item === 'build' ? t('panelBuild') : item === 'readiness' ? t('panelReady') : t('panelAgent'),
            }))} />
          </div>

        {error !== undefined && <Notice className="panel-error" tone="danger">{error}</Notice>}

        {panel === 'elements' && <PanelBody id="studio-panel-elements" aria-labelledby="studio-tab-elements" className="panel-content elements-panel" role="tabpanel">
          <div className="panel-heading">
            <div><h2>{t('elementsTitle')}</h2><p>{t('elementsDescription')}</p></div>
            <Badge tone="info">{draftElements.length}</Badge>
          </div>
          {draftElements.length === 0 && draftVariables.length === 0
            ? <EmptyState title={t('elementsEmpty')}
                description={t('elementsEmptyDescription')} />
            : <>
                {draftElements.length > 0 && <div className="element-list" aria-label={t('registeredElements')}>
                  {draftElements.map(item => <button key={item.element.id} type="button"
                    data-active={focusedElement?.element.id === item.element.id}
                    data-matched={matchedElement?.element.id === item.element.id}
                    onClick={() => setFocusedElementId(item.element.id)}>
                    <span><strong>{item.element.label}</strong><code>{item.element.id}</code></span>
                    {matchedElement?.element.id === item.element.id && <small>{t('previewSelection')}</small>}
                  </button>)}
                </div>}

                {focusedElement !== undefined && <section className="element-detail" aria-label={t('elementControls', { name: focusedElement.element.label })}>
                  <div className="element-source-row">
                    <div><strong>{focusedElement.element.label}</strong><code>{focusedElement.element.source.file}</code></div>
                    <Button className="source-link" variant="ghost" size="small" disabled={!files.some(file => file.path === focusedElement.element.source.file)}
                      onClick={() => {
                        setPanel('source')
                        void openFile(focusedElement.element.source.file)
                      }}>{t('openElementSource')}</Button>
                  </div>
                  {matchedElement?.element.id === focusedElement.element.id
                    ? <p className="element-match" data-state="matched">{t('elementMatched')}</p>
                    : selection !== undefined && <p className="element-match">{t('elementNotMatched')}</p>}
                  {matchedElement?.element.id === focusedElement.element.id && selection?.react !== undefined
                    && <PatchProvenance patches={selection.react.patches} currentOwner={selectedDraft?.name} boundaryMatched t={t} />}
                  {(focusedElement.element.variables ?? []).length === 0
                    ? <p className="inspection-empty">{t('elementNoVariables')}</p>
                    : <div className="element-variables">{focusedElement.element.variables?.map(definition => <VariableControl
                        key={definition.id}
                        definition={definition}
                        value={focusedElement.values[definition.id]!}
                        onChange={value => setVariable({
                          scope: 'element', owner: focusedElement.owner, elementId: focusedElement.element.id,
                          variableId: definition.id, value,
                        })}
                      />)}</div>}
                </section>}

                {draftVariables.map(group => <section className="global-variables" key={group.owner}>
                  <div className="section-heading"><strong>{t('pluginVariables')}</strong><span>{group.variables.length}</span></div>
                  <div className="element-variables">{group.variables.map(definition => <VariableControl
                    key={definition.id}
                    definition={definition}
                    value={group.values[definition.id]!}
                    onChange={value => setVariable({ scope: 'global', owner: group.owner, variableId: definition.id, value })}
                  />)}</div>
                </section>)}
                <p className="variable-note">{t('variableNote')}</p>
              </>}
        </PanelBody>}

        {panel === 'selection' && <PanelBody id="studio-panel-selection" aria-labelledby="studio-tab-selection" className="panel-content selection-panel" role="tabpanel">
          <div className="panel-heading">
            <div><h2>{t('selectionTitle')}</h2><p>{t('selectionDescription')}</p></div>
          </div>
          {selection === undefined
            ? <EmptyState title={t('selectionEmpty')}
                description={t('selectionEmptyDescription')} />
            : <section className="selection-result" aria-label={t('selectedElement')}>
                <div className="selection-title">
                  <code>{selection.tag}{selection.id === undefined ? '' : `#${selection.id}`}
                    {selection.classes.map(name => `.${name}`).join('')}</code>
                  <Badge tone={selection.confidence === 'mapped' ? 'success' : selection.confidence === 'component-only' ? 'info' : 'neutral'}>
                    {selection.confidence === 'mapped' ? t('confidenceSourceMapped')
                      : selection.confidence === 'component-only' ? t('confidenceReactMapped') : t('confidenceDomOnly')}
                  </Badge>
                </div>
                {selection.text !== '' && <p className="selection-text">{selection.text}</p>}
                <dl className="selection-meta">
                  <div><dt>{t('position')}</dt><dd>{Math.round(selection.rect.x)}, {Math.round(selection.rect.y)} · {Math.round(selection.rect.width)} × {Math.round(selection.rect.height)}</dd></div>
                  {selection.react?.component !== undefined && <div><dt>{t('component')}</dt><dd>{selection.react.component}</dd></div>}
                  {selection.react !== undefined && selection.react.owners.length > 0
                    && <div><dt>{t('owners')}</dt><dd>{selection.react.owners.join(' → ')}</dd></div>}
                  {selection.react?.source !== undefined && <div><dt>{t('source')}</dt><dd>
                    <code>{selection.react.source.resolved?.package === undefined ? '' : `${selection.react.source.resolved.package} · `}
                      {selection.react.source.resolved?.file ?? selection.react.source.file}
                      {selection.react.source.line === undefined ? '' : `:${selection.react.source.line}`}
                      {selection.react.source.column === undefined ? '' : `:${selection.react.source.column}`}</code>
                    {selection.react.source.resolved !== undefined && <small className="source-resolution">
                      {selection.react.source.resolved.kind} · {selection.react.source.resolved.confidence}
                    </small>}
                    {selection.react.source.resolved?.kind === 'draft' && <Button className="source-link" variant="ghost" size="small" onClick={() => {
                      setPanel('source')
                      void openFile(selection.react!.source!.resolved!.file)
                    }}>{t('openSelectedSource')}</Button>}
                  </dd></div>}
                </dl>
                {selection.react !== undefined && <PatchProvenance patches={selection.react.patches}
                  currentOwner={selectedDraft?.name} boundaryMatched={matchedElement !== undefined} t={t} />}
                {selection.react !== undefined && Object.keys(selection.react.props).length > 0 && <details>
                  <summary>{t('safeProps')}</summary>
                  <pre className="selection-code">{JSON.stringify(selection.react.props, null, 2)}</pre>
                </details>}
                <details>
                  <summary>{t('sanitizedHtml')}</summary>
                  <pre className="selection-code">{selection.outerHTML}</pre>
                </details>
              </section>}

          <section className="harmony-inspection" aria-label={t('harmonyTargets')}>
            <div className="section-heading"><strong>{t('materializedTargets')}</strong><span>{inspection.targets.length}</span></div>
            {inspection.targets.length === 0
              ? <p className="inspection-empty">{t('materializedTargetsEmpty')}</p>
              : inspection.targets.map(target => <details className="harmony-target" key={`${target.package}:${target.file}`}>
                  <summary><span>{target.package}</span><code>{target.file}</code></summary>
                  <div className="harmony-target-body">
                    <p>{t('patchSteps', { count: target.steps.length })}</p>
                    {target.steps.map(step => <details key={`${step.owner}:${step.key}`}>
                      <summary>{step.owner} / {step.key} · {step.matches} {t('matches')}</summary>
                      <pre className="selection-code">{step.source}</pre>
                    </details>)}
                    <details><summary>{t('original')}</summary><pre className="selection-code">{target.original}</pre></details>
                    <details><summary>{t('final')}</summary><pre className="selection-code">{target.final}</pre></details>
                  </div>
                </details>)}
          </section>
        </PanelBody>}

        {panel === 'source' && <PanelBody id="studio-panel-source" aria-labelledby="studio-tab-source" className="panel-content source-panel" role="tabpanel">
          <div className="panel-heading">
            <div><h2>{t('sourceTitle')}</h2><p>{t('sourceDescription')}</p></div>
          </div>
          <div className="source-toolbar">
            <FormField id="source-file" label={t('projectFile')}>
              <Select value={filePath} onChange={event => void openFile(event.target.value)}
                disabled={project === undefined || fileBusy}>
                <option value="">{files.length === 0 ? t('noEditableFiles') : t('selectFile')}</option>
                {files.map(file => <option key={file.path} value={file.path}>{file.path}</option>)}
              </Select>
            </FormField>
          </div>
          {filePath === ''
            ? <EmptyState className="source-empty" title={project === undefined ? t('openLinkedDraft') : t('selectDraftFile')}
                description={t('sourceSafety')} />
            : <>
                <CodeEditor key={filePath} path={filePath} value={source} onChange={setSource} />
                <div className="source-actions">
                  <span>{source === savedSource ? t('saved') : t('unsaved')}</span>
                  <Button variant="primary" onClick={() => void saveFile()} loading={fileBusy}
                    loadingLabel={t('saving')} disabled={source === savedSource}>{t('saveToDraft')}</Button>
                </div>
              </>}
        </PanelBody>}

        {panel === 'build' && <PanelBody id="studio-panel-build" aria-labelledby="studio-tab-build"
          className="panel-content build-panel" role="tabpanel">
          <div className="panel-heading build-heading">
            <div><h2>{t('panelBuild')}</h2><p>{t('buildDescription')}</p></div>
          </div>
          <section className="build-action" aria-label={t('hotReload')}>
            <div><strong>{t('hotReload')}</strong><p>{t('hotReloadDescription')}</p></div>
            <Button variant="primary" onClick={() => void hotReloadDraft()} loading={selectedBuildRunning}
              loadingLabel={t('hotReloading')}
              disabled={project?.state !== 'active' || selectedDraft?.runtime.state !== 'running'}>
              <RefreshIcon />{t('hotReload')}
            </Button>
          </section>
          {project?.state !== 'active' && <Notice className="build-notice" tone="warning">
            {t('hotReloadUnavailable')}
          </Notice>}
          {selectedBuildOutput !== undefined && <section className="build-output" aria-label={t('latestBuildOutput')}>
            <div><strong>{t('latestBuild')}</strong><code>{selectedBuildOutput.argv.join(' ')}</code></div>
            {(selectedBuildOutput.stdout !== '' || selectedBuildOutput.stderr !== '')
              && <pre className="selection-code">{[selectedBuildOutput.stdout, selectedBuildOutput.stderr].filter(Boolean).join('\n')}</pre>}
          </section>}
        </PanelBody>}

        {panel === 'readiness' && <PanelBody id="studio-panel-readiness" aria-labelledby="studio-tab-readiness"
          className="panel-content readiness-panel" role="tabpanel">
          <div className="panel-heading readiness-heading">
            <div><h2>{t('readinessTitle')}</h2><p>{t('readinessDescription')}</p></div>
            <Button size="small" onClick={() => void runPack()} loading={packingDraftId === selectedDraftId} loadingLabel={t('checking')}
              disabled={project === undefined}>{t('packDryRun')}</Button>
          </div>
          {project === undefined
            ? <EmptyState title={t('openDraftFirst')} description={t('readinessEmptyDescription')} />
            : <>
                <div className="readiness-summary" aria-label={t('readinessSummary')}>
                  {(['error', 'warning', 'info'] as StudioReadinessLevel[]).map(level => <div key={level} data-level={level}>
                    <strong>{readiness.findings.filter(item => item.level === level).length}</strong>
                    <span>{level === 'error' ? t('readinessError') : level === 'warning' ? t('readinessWarning') : t('readinessInfo')}</span>
                  </div>)}
                </div>
                {readiness.findings.length === 0
                  ? <p className="readiness-clear">{t('readinessClear')}</p>
                  : <div className="readiness-findings">{readiness.findings.map((item, index) => <article
                      key={`${item.code}:${item.patch ?? item.file ?? index}`} data-level={item.level}>
                      <div><span>{item.level}</span><code>{item.code}</code></div>
                      <p>{item.message}</p>
                      {(item.file !== undefined || item.patch !== undefined) && <small>{[item.patch, item.file].filter(Boolean).join(' · ')}</small>}
                    </article>)}</div>}
                {readiness.pack !== undefined && <section className="pack-result" data-ok={readiness.pack.ok} aria-label={t('packDryRunResult')}>
                  <div><strong>{readiness.pack.ok ? t('packPassed') : t('packFailed')}</strong>
                    <span>{t('fileCount', { count: readiness.pack.files.length })}</span></div>
                  {readiness.pack.files.length > 0 && <details><summary>{t('viewPackFiles')}</summary>
                    <pre className="selection-code">{readiness.pack.files.join('\n')}</pre></details>}
                  {(readiness.pack.stdout !== '' || readiness.pack.stderr !== '') && <details><summary>{t('viewNpmOutput')}</summary>
                    <pre className="selection-code">{[readiness.pack.stdout, readiness.pack.stderr].filter(Boolean).join('\n')}</pre></details>}
                </section>}
              </>}
        </PanelBody>}

        {panel === 'agent' && <PanelBody id="studio-panel-agent" aria-labelledby="studio-tab-agent" className="agent-panel" role="tabpanel">
          <div className="panel-heading agent-heading">
            <div><h2>{t('agentTitle')}</h2><p>{running ? t('agentWorking') : sessionId === undefined ? t('agentWaiting') : t('agentReady')}</p></div>
            {running && <Button variant="danger" size="small" onClick={() => void cancel()}>{t('agentCancel')}</Button>}
          </div>
          <p className="agent-scope">{t('agentScope')}</p>
          <div className="conversation" aria-live="polite">
            {messages.length === 0 && streaming === '' && <EmptyState className="agent-empty"
              title={project?.state === 'active' ? t('agentStartFromDraft') : t('agentOpenDraftFirst')}
              description={t('agentDescription')}
              action={project?.state === 'active' && sessionId === undefined
                ? <Button variant="primary" loading={creatingAgentDraftId === selectedDraftId} loadingLabel={t('agentStarting')}
                    onClick={() => void createAgent()}>{t('agentStart')}</Button>
                : undefined} />}
            {messages.map(message => <article key={message.id} className={`message ${message.role}`}>
              <span>{message.role === 'user' ? t('you') : t('panelAgent')}</span><p>{message.text}</p>
            </article>)}
            {streaming !== '' && <article className="message assistant streaming"><span>{t('panelAgent')}</span><p>{streaming}</p></article>}
          </div>
          {interaction !== undefined && <Notice className="interaction-notice" tone="warning">{interaction}</Notice>}
          <form className="composer" onSubmit={event => void sendPrompt(event)}>
            <Textarea aria-label={t('agentMessage')} value={prompt} onChange={event => setPrompt(event.target.value)}
              placeholder={sessionId === undefined ? t('agentPlaceholderStart') : t('agentPlaceholder')}
              disabled={sessionId === undefined || sending} rows={3} />
            <Button variant="primary" type="submit" loading={sending} loadingLabel={t('sending')}
              disabled={sessionId === undefined || prompt.trim() === ''}>{t('send')}</Button>
          </form>
        </PanelBody>}
      </Panel>
      </aside>
    </main>
    {terminalExpanded && terminal !== null && createPortal(terminal, document.body)}
    <CreateDraftDialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} onCreate={createDraft} />
    <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
  </div>
}
