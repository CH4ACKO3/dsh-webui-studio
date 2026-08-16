import { type CSSProperties, FormEvent, type PointerEvent as ReactPointerEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
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
  type StudioDraftSource,
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
} from '../contracts'
import { apiValue, studioApi, subscribeStudioEvents } from './events'
import { callStudio, StudioRpcError } from './rpc'
import { CodeEditor } from './CodeEditor'
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
  ThemeSwitcher,
} from './ui'

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

const panels = ['elements', 'selection', 'source', 'readiness', 'agent'] as const
type Panel = typeof panels[number]
const leftPanels = ['instance', 'plugins'] as const
type LeftPanel = typeof leftPanels[number]
const instancePanels = ['layers', 'details'] as const
type InstancePanel = typeof instancePanels[number]

const previewAspectRatios = ['16:9', '16:10', '4:3', '1:1', '9:16'] as const
type PreviewAspectRatio = typeof previewAspectRatios[number] | 'custom'

const LEFT_SIDEBAR_MIN = 220
const LEFT_SIDEBAR_MAX = 480
const RIGHT_SIDEBAR_MIN = 320
const RIGHT_SIDEBAR_MAX = 560
const PREVIEW_GUTTER = 32
const PREVIEW_MIN_SIZE = { width: 1, height: 1 }
const TERMINAL_MIN_SIZE = { width: 280, height: 220 }
const DRAFT_LABELS_KEY = 'dsh-webui-studio:draft-labels'
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

function pathName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function storedDraftLabels(): Record<string, string> {
  const stored = localStorage.getItem(DRAFT_LABELS_KEY)
  return stored === null ? {} : JSON.parse(stored) as Record<string, string>
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
}: {
  patches: readonly StudioPatchTrace[]
  currentOwner?: string
  boundaryMatched: boolean
}): JSX.Element {
  const externallyPatched = boundaryMatched && currentOwner !== undefined
    && patches.some(patch => patch.owner !== currentOwner)

  return <section className="patch-provenance" aria-label="Render-path Patch candidates">
    <div className="section-heading">
      <strong>Render-path Patch candidates</strong>
      <Badge tone="warning">candidate</Badge>
    </div>
    {externallyPatched && <Notice tone="warning">
      当前 Draft 边界内的这条渲染路径包含其他插件的候选 Patch 影响；选中节点未必能在 Element source 中直接对应。
    </Notice>}
    {patches.length === 0
      ? <p className="inspection-empty">当前渲染路径未提供 candidate trace；这不表示没有 Patch 参与。</p>
      : <div className="patch-trace-list">{patches.map(patch => <article
          key={`${patch.owner}:${patch.key}:${patch.effect}:${patch.declaration}:${patch.target.package}:${patch.target.file}`}>
          <div><strong>{patch.owner}</strong><code>{patch.key}</code></div>
          <dl>
            <div><dt>Effect</dt><dd>{patch.effect}</dd></div>
            <div><dt>Declaration</dt><dd><code>{patch.declaration}</code></dd></div>
            <div><dt>Target</dt><dd><code>{patch.target.package} · {patch.target.file}</code></dd></div>
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
  const initialViewport = useMemo(deviceViewport, [])
  const [drafts, setDrafts] = useState<StudioDraftView[]>([])
  const [loadingDrafts, setLoadingDrafts] = useState(true)
  const [selectedDraftId, setSelectedDraftId] = useState<string>()
  const [showCreate, setShowCreate] = useState(false)
  const [sourceKind, setSourceKind] = useState<StudioDraftSource['kind']>('new')
  const [packageName, setPackageName] = useState('dsh-webui-draft')
  const [repository, setRepository] = useState('')
  const [repositoryRef, setRepositoryRef] = useState('')
  const [packagePath, setPackagePath] = useState('')
  const [profileMode, setProfileMode] = useState<'main-home' | 'custom'>('main-home')
  const [project, setProject] = useState<StudioProjectState>()
  const [sessionId, setSessionId] = useState<string>()
  const [events, setEvents] = useState<SessionEvent[]>([])
  const [prompt, setPrompt] = useState('')
  const [streaming, setStreaming] = useState('')
  const [running, setRunning] = useState(false)
  const [connected, setConnected] = useState(false)
  const [creating, setCreating] = useState(false)
  const [starting, setStarting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string>()
  const [interaction, setInteraction] = useState<string>()
  const [previewKey, setPreviewKey] = useState(0)
  const [previewMode, setPreviewMode] = useState<'browse' | 'inspect'>('browse')
  const [previewAspectRatio, setPreviewAspectRatio] = useState<PreviewAspectRatio>(
    () => aspectRatioLabel(initialViewport.width, initialViewport.height),
  )
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false)
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false)
  const [leftPanel, setLeftPanel] = useState<LeftPanel>('instance')
  const [instancePanel, setInstancePanel] = useState<InstancePanel>('layers')
  const [draftLabels, setDraftLabels] = useState<Record<string, string>>(storedDraftLabels)
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(260)
  const [rightSidebarWidth, setRightSidebarWidth] = useState(400)
  const [previewStageSize, setPreviewStageSize] = useState({ width: 0, height: 0 })
  const [previewViewport, setPreviewViewport] = useState(initialViewport)
  const [previewScale, setPreviewScale] = useState(1)
  const [previewFit, setPreviewFit] = useState(true)
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
  const [packing, setPacking] = useState(false)
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
  const previewNonce = useRef(crypto.randomUUID())
  const previewModeRef = useRef(previewMode)
  const previewScaleRef = useRef(previewScale)
  const previewUpdateQueue = useRef<Promise<void>>(Promise.resolve())
  const selectionResolve = useRef(0)
  const activeDragCleanupRef = useRef<() => void>()
  const selectedDraft = drafts.find(draft => draft.id === selectedDraftId)
  const draftLabel = (draft: StudioDraftView): string => draftLabels[draft.id] ?? pathName(draft.worktreeDir)
  const terminalOutput = selectedDraft?.runtime.log ?? ''
  const terminalLatestLine = terminalOutput.trimEnd().split(/\r?\n/).at(-1) ?? '[studio] 实例尚未启动。'
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
  const previewRect: LayoutRect = {
    x: previewOrigin.x,
    y: previewOrigin.y,
    width: previewViewport.width * previewScale,
    height: previewViewport.height * previewScale,
  }
  useEffect(() => {
    sessionRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    localStorage.setItem(DRAFT_LABELS_KEY, JSON.stringify(draftLabels))
  }, [draftLabels])

  useEffect(() => {
    setProject(selectedDraft?.project)
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
      const size = { width: stage.clientWidth, height: stage.clientHeight }
      setPreviewStageSize(size)
      if (!previewFit) return
      const bounds = previewBounds(size.width, size.height)
      if (bounds.width < PREVIEW_MIN_SIZE.width || bounds.height < PREVIEW_MIN_SIZE.height) return
      const fitted = fitRect(bounds, previewViewport.width / previewViewport.height)
      setPreviewScale(fitted.width / previewViewport.width)
      setPreviewOrigin({ x: fitted.x, y: fitted.y })
    }
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    update()
    return () => observer.disconnect()
  }, [previewFit, previewViewport.height, previewViewport.width])

  useEffect(() => () => activeDragCleanupRef.current?.(), [])

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
    draftIdRef.current = selectedDraftId
  }, [selectedDraftId])

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

  useEffect(() => {
    previewModeRef.current = previewMode
  }, [previewMode])

  useEffect(() => {
    previewScaleRef.current = previewScale
  }, [previewScale])

  useEffect(() => {
    const changed = (): void => setPreviewFullscreen(document.fullscreenElement === previewSectionRef.current)
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [])

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
    void callStudio<StudioDraftView[]>('studio.drafts.list', {}).then(next => {
      setDrafts(next)
      setSelectedDraftId(current => current ?? next[0]?.id)
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
    if (frame.type === 'approval/requested') setInteraction('Agent 正在等待工具授权；请暂时在官方 WebUI 中处理。')
    if (frame.type === 'question/requested') setInteraction('Agent 正在等待补充信息；请暂时在官方 WebUI 中回答。')
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
      void Promise.all([
        callStudio<StudioProjectState>('studio.project.state', { draftId: currentDraft }),
        callStudio<StudioProjectFile[]>('studio.project.files', { draftId: currentDraft }),
        callStudio<StudioHarmonyInspection>('studio.harmony.inspect', { draftId: currentDraft }),
        callStudio<StudioReadinessReport>('studio.readiness.inspect', { draftId: currentDraft }),
      ]).then(([next, nextFiles, nextInspection, nextReadiness]) => {
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
      setFiles([])
      setFilePath('')
      setSource('')
      setSavedSource('')
      setInspection({ patches: [], targets: [] })
      setReadiness({ findings: [] })
      return
    }
    void Promise.all([
      callStudio<StudioProjectFile[]>('studio.project.files', { draftId: selectedDraftId }),
      callStudio<StudioHarmonyInspection>('studio.harmony.inspect', { draftId: selectedDraftId }),
      callStudio<StudioReadinessReport>('studio.readiness.inspect', { draftId: selectedDraftId }),
    ]).then(([nextFiles, nextInspection, nextReadiness]) => {
      setFiles(nextFiles)
      setInspection(nextInspection)
      setReadiness(nextReadiness)
    }).catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [project?.root, selectedDraftId])

  const updateDraft = (next: StudioDraftView): void => {
    setDrafts(current => current.some(draft => draft.id === next.id)
      ? current.map(draft => draft.id === next.id ? next : draft)
      : [...current, next])
    setSelectedDraftId(next.id)
    setProject(next.project)
  }

  const createDraft = async (): Promise<void> => {
    setCreating(true)
    setError(undefined)
    try {
      const source: StudioDraftSource = sourceKind === 'new'
        ? { kind: 'new', packageName: packageName.trim() }
        : {
            kind: 'existing',
            repository: repository.trim(),
            ...(repositoryRef.trim() === '' ? {} : { ref: repositoryRef.trim() }),
            ...(packagePath.trim() === '' ? {} : { packagePath: packagePath.trim() }),
          }
      updateDraft(await callStudio<StudioDraftView>('studio.drafts.create', { source, profileMode }))
      setShowCreate(false)
    } catch (cause) {
      setError(cause instanceof StudioRpcError ? cause.message : String(cause))
    } finally {
      setCreating(false)
    }
  }

  const startDraft = async (): Promise<void> => {
    if (selectedDraftId === undefined) return
    const id = selectedDraftId
    setStarting(true)
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
      const next = await callStudio<StudioDraftView>('studio.drafts.start', { draftId: id })
      polling = false
      updateDraft(next)
      setPreviewKey(value => value + 1)
    } catch (cause) {
      polling = false
      try {
        const next = await callStudio<StudioDraftView[]>('studio.drafts.list', {})
        const draft = next.find(candidate => candidate.id === id)
        if (draft !== undefined) updateDraft(draft)
      } catch {}
      setError(cause instanceof StudioRpcError ? cause.message : String(cause))
    } finally {
      polling = false
      await progress
      setStarting(false)
    }
  }

  const stopDraft = async (): Promise<void> => {
    if (selectedDraftId === undefined) return
    setStarting(true)
    setError(undefined)
    try {
      updateDraft(await callStudio<StudioDraftView>('studio.drafts.stop', { draftId: selectedDraftId }))
      setSessionId(undefined)
      setEvents([])
      setStreaming('')
      setRunning(false)
      setInteraction(undefined)
      setSelection(undefined)
      setReadiness({ findings: [] })
    } catch (cause) {
      setError(cause instanceof StudioRpcError ? cause.message : String(cause))
    } finally {
      setStarting(false)
    }
  }

  const confirmPreview = async (graphRev: string): Promise<void> => {
    if (selectedDraftId === undefined || (project?.state !== 'staged' && project?.state !== 'preview-pending') || confirming) return
    setConfirming(true)
    setError(undefined)
    try {
      const active = await callStudio<StudioProjectState>('studio.project.activate', { draftId: selectedDraftId, graphRev })
      setProject(active)
    } catch (cause) {
      setError(cause instanceof StudioRpcError ? cause.message : String(cause))
    } finally {
      setConfirming(false)
    }
  }

  const connectPreview = (): void => {
    const target = previewRef.current?.contentWindow
    if (target === undefined || target === null || previewSession === undefined || previewUrl === undefined || selectedDraftId === undefined) return
    const targetOrigin = new URL(previewUrl).origin
    previewPort.current?.close()
    const channel = new MessageChannel()
    previewPort.current = channel.port1
    channel.port1.onmessage = event => {
      const message = event.data as {
        type?: unknown
        sessionId?: unknown
        nonce?: unknown
        graphRev?: unknown
        mode?: unknown
        selection?: unknown
        registry?: unknown
        error?: unknown
        ok?: unknown
        dx?: unknown
        dy?: unknown
      }
      if (message.sessionId !== previewSession || message.nonce !== previewNonce.current) return
      if (message.type === 'preview-ready' && typeof message.graphRev === 'string') {
        channel.port1.postMessage({
          type: 'set-mode', sessionId: previewSession, nonce: previewNonce.current, mode: previewModeRef.current,
        })
        queuePreviewUpdate(selectedDraftId, {
          connected: true,
          graphRev: message.graphRev,
          mode: previewModeRef.current,
        })
        void confirmPreview(message.graphRev)
      }
      if (message.type === 'selection' && typeof message.selection === 'object' && message.selection !== null) {
        const raw = message.selection as StudioDomSelection
        const request = ++selectionResolve.current
        const expectedNonce = previewNonce.current
        const commit = (next: StudioDomSelection): void => {
          if (request !== selectionResolve.current || previewPort.current !== channel.port1
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
      if (message.type === 'preview-pan' && typeof message.dx === 'number' && typeof message.dy === 'number') {
        const scale = previewScaleRef.current
        setPreviewFit(false)
        setPreviewOrigin(current => ({
          x: current.x + (message.dx as number) * scale,
          y: current.y + (message.dy as number) * scale,
        }))
      }
      if (message.type === 'registry' && typeof message.registry === 'object' && message.registry !== null) {
        const nextRegistry = message.registry as StudioRegistrySnapshot
        setRegistry(nextRegistry)
        queuePreviewUpdate(selectedDraftId, {
          connected: true,
          mode: previewModeRef.current,
          registry: nextRegistry,
        })
      }
      if (message.type === 'registry-error' && typeof message.error === 'string') {
        setError(message.error)
      }
      if (message.type === 'selection-error' && typeof message.error === 'string') setError(message.error)
      if (message.type === 'variable-result' && message.ok === false && typeof message.error === 'string') setError(message.error)
      if (message.type === 'mode' && (message.mode === 'browse' || message.mode === 'inspect')) {
        previewModeRef.current = message.mode
        setPreviewMode(message.mode)
      }
    }
    channel.port1.start()
    target.postMessage({
      type: 'dsh-studio-connect',
      sessionId: previewSession,
      nonce: previewNonce.current,
    }, targetOrigin, [channel.port2])
  }

  const openFile = async (path: string): Promise<void> => {
    if (path === '' || selectedDraftId === undefined) return
    setFileBusy(true)
    setError(undefined)
    try {
      const file = await callStudio<{ path: string; content: string }>('studio.project.readFile', { draftId: selectedDraftId, path })
      setFilePath(file.path)
      setSource(file.content)
      setSavedSource(file.content)
    } catch (cause) {
      setError(cause instanceof StudioRpcError ? cause.message : String(cause))
    } finally {
      setFileBusy(false)
    }
  }

  const saveFile = async (): Promise<void> => {
    if (filePath === '' || selectedDraftId === undefined) return
    setFileBusy(true)
    setError(undefined)
    try {
      await callStudio('studio.project.writeFile', { draftId: selectedDraftId, path: filePath, content: source })
      setSavedSource(source)
      void callStudio<StudioReadinessReport>('studio.readiness.inspect', { draftId: selectedDraftId }).then(setReadiness).catch(() => undefined)
    } catch (cause) {
      setError(cause instanceof StudioRpcError ? cause.message : String(cause))
    } finally {
      setFileBusy(false)
    }
  }

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

  const togglePreviewFullscreen = async (): Promise<void> => {
    const section = previewSectionRef.current
    if (section === null) return
    try {
      if (document.fullscreenElement === section) await document.exitFullscreen()
      else await section.requestFullscreen()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const runPack = async (): Promise<void> => {
    if (project === undefined || selectedDraftId === undefined) return
    setPacking(true)
    setError(undefined)
    try {
      setReadiness(await callStudio<StudioReadinessReport>('studio.readiness.pack', { draftId: selectedDraftId }))
    } catch (cause) {
      setError(cause instanceof StudioRpcError ? cause.message : String(cause))
    } finally {
      setPacking(false)
    }
  }

  const createAgent = async (): Promise<void> => {
    if (selectedDraftId === undefined) return
    setCreating(true)
    setError(undefined)
    setInteraction(undefined)
    try {
      const result = await callStudio<StudioCreateAgentResult>('studio.agent.create', { draftId: selectedDraftId })
      setDrafts(current => current.map(draft => draft.id === selectedDraftId ? { ...draft, agent: result } : draft))
      setSessionId(result.sessionId)
      const studioSession = result.sessionId as SessionId
      await studioApi.sessions.rename({ sessionId: studioSession, title: `Studio: ${project?.name ?? 'Draft'}` })
    } catch (cause) {
      setError(cause instanceof StudioRpcError ? cause.message : String(cause))
    } finally {
      setCreating(false)
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

  const selectDraft = (draftId: string): void => {
    setSelectedDraftId(draftId)
    setSelection(undefined)
    setRegistry(EMPTY_REGISTRY)
    setFocusedElementId(undefined)
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
    setPreviewAspectRatio(value)
    setPreviewViewport(current => ({ ...current, height: Math.max(1, Math.round(current.width / aspectRatioValue(value))) }))
    setPreviewFit(true)
  }

  const changePreviewDimension = (dimension: 'width' | 'height', value: number): void => {
    if (!Number.isFinite(value)) return
    setPreviewViewport(current => {
      const next = { ...current, [dimension]: Math.max(1, Math.round(value)) }
      setPreviewAspectRatio(aspectRatioLabel(next.width, next.height))
      return next
    })
  }

  const changePreviewScale = (nextScale: number): void => {
    if (!Number.isFinite(nextScale)) return
    const scale = Math.max(0.01, nextScale)
    setPreviewFit(false)
    setPreviewScale(scale)
    setPreviewOrigin({
      x: (previewStageSize.width - previewViewport.width * scale) / 2,
      y: (previewStageSize.height - previewViewport.height * scale) / 2,
    })
  }

  const beginPreviewResize = (event: ReactPointerEvent<HTMLElement>, direction: ResizeDirection): void => {
    const initial = previewRect
    setPreviewFit(false)
    beginPointerDrag(event, `${direction}-resize`, (dx, dy) => {
      const next = resizeRect(initial, direction, dx, dy, undefined, {
        width: PREVIEW_MIN_SIZE.width * previewScale,
        height: PREVIEW_MIN_SIZE.height * previewScale,
      }, direction.length === 2)
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
    aria-label="Draft Host 终端">
    <div className="host-terminal-bar" data-draggable={terminalExpanded || undefined}
      onPointerDown={terminalExpanded ? beginTerminalMove : undefined}>
      <button type="button" className="terminal-section-toggle"
        aria-expanded={!terminalMinimized} aria-controls="draft-terminal-output" onClick={toggleTerminalMinimized}>
        <DisclosureIcon expanded={!terminalMinimized} /><strong>终端</strong>
        {terminalMinimized && <code className="terminal-latest-line" title={terminalLatestLine}>{terminalLatestLine}</code>}
        {!terminalMinimized && <span className="terminal-runtime-state" aria-live="polite"
          data-state={starting ? 'starting' : selectedDraft.runtime.state}>
          {starting || selectedDraft.runtime.state === 'starting' ? '执行中' : selectedDraft.runtime.state === 'running' ? '运行中'
            : selectedDraft.runtime.state === 'failed' ? '失败' : '待命'}
        </span>}
      </button>
      <div className="host-terminal-actions">
        <IconButton ref={terminalToggleRef} className="terminal-layout-button" size="small" variant="ghost"
          aria-expanded={terminalExpanded} aria-controls="draft-terminal" onClick={toggleTerminal}
          label={terminalExpanded ? '将终端停靠回左侧栏' : '在底部展开终端'}>
          <TerminalLayoutIcon expanded={terminalExpanded} />
        </IconButton>
      </div>
    </div>
    {!terminalMinimized && <pre id="draft-terminal-output" ref={terminalRef} role="log" aria-live="off"
      aria-label="实例终端只读输出" tabIndex={0} onScroll={event => {
      const terminal = event.currentTarget
      terminalPinnedRef.current = terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 24
    }}>{terminalOutput || '[studio] 实例尚未启动。'}</pre>}
    {terminalExpanded && !terminalMinimized && <ResizeHandles kind="terminal" onPointerDown={beginTerminalResize} />}
  </section>

  return <div className="studio-shell studio-ui-root" onPointerDownCapture={event => {
    const target = event.target instanceof Element ? event.target : undefined
    if (previewMode === 'inspect' && target?.closest('.preview-viewport') === null) unlockPreviewSelection()
  }}>
    <header className="studio-header">
      <div className="studio-brand">
        <span className="studio-mark" aria-hidden="true">H</span>
        <div><strong>WebUI Studio</strong><span>Harmony layer workspace</span></div>
      </div>
      <nav className="draft-tabs" aria-label="Draft 工作区">
        {loadingDrafts
          ? <span className="draft-tabs-empty" aria-live="polite">正在载入草稿…</span>
          : drafts.length === 0
            ? <span className="draft-tabs-empty">还没有草稿</span>
            : <Tabs id="draft" label="草稿标签页" value={selectedDraftId ?? ''} onChange={selectDraft}
                options={drafts.map(draft => ({
                  value: draft.id,
                  label: <span className="draft-tab-label" data-state={draft.runtime.state}>
                    <span className="draft-tab-dot" aria-hidden="true" />
                    <span>{draftLabel(draft)}</span>
                  </span>,
                }))} />}
        <IconButton size="small" variant="ghost" aria-pressed={showCreate}
          onClick={() => {
            setLeftSidebarCollapsed(false)
            setShowCreate(value => !value)
          }} label={showCreate ? '收起新建草稿表单' : '新建草稿'}><PlusIcon /></IconButton>
      </nav>
      <div className="studio-header-actions">
        <ThemeSwitcher labels={{ light: '浅色', system: '跟随系统', dark: '深色' }} label="Studio 主题" />
        <Status tone={connected ? 'success' : 'warning'} label={connected ? 'DSH 已连接' : 'DSH 正在重连'}>
          {connected ? 'DSH 已连接' : '正在重连'}
        </Status>
      </div>
    </header>

    <main className="studio-main" data-left-collapsed={leftSidebarCollapsed} data-right-collapsed={rightSidebarCollapsed}
      style={{
        '--studio-left-sidebar': `${leftSidebarCollapsed ? 48 : leftSidebarWidth}px`,
        '--studio-right-sidebar': `${rightSidebarCollapsed ? 56 : rightSidebarWidth}px`,
      } as CSSProperties}>
      <Panel id="dsh-control-sidebar" as="aside" className="studio-project studio-sidebar" data-collapsed={leftSidebarCollapsed}
        aria-label="DSH 控制">
        <div className="sidebar-heading">
          <div className="sidebar-title"><strong>DSH Instance Control</strong><span>插件运行环境与实例状态</span></div>
          <IconButton size="small" variant="ghost" aria-expanded={!leftSidebarCollapsed}
            aria-controls="dsh-control-sidebar" onClick={() => setLeftSidebarCollapsed(value => !value)}
            label={leftSidebarCollapsed ? '展开 DSH 控制栏' : '收起 DSH 控制栏'}>
            <SidebarToggleIcon side="left" collapsed={leftSidebarCollapsed} />
          </IconButton>
        </div>
        <div className="project-body sidebar-content">
        {showCreate && <form className="draft-create" onSubmit={event => { event.preventDefault(); void createDraft() }}>
          <FormField id="draft-source" label="来源">
            <Select value={sourceKind} onChange={event => setSourceKind(event.target.value as StudioDraftSource['kind'])}>
              <option value="new">新插件</option>
              <option value="existing">已有 Git 仓库</option>
            </Select>
          </FormField>
          {sourceKind === 'new'
            ? <FormField id="draft-package-name" label="包名称" required>
                <Input value={packageName} onChange={event => setPackageName(event.target.value)}
                  placeholder="dsh-webui-draft" maxLength={214} />
              </FormField>
            : <>
                <FormField id="draft-repository" label="Git 仓库" required>
                  <Input value={repository} onChange={event => setRepository(event.target.value)}
                    placeholder="本地路径或 Git 地址" maxLength={2048} />
                </FormField>
                <FormField id="draft-repository-ref" label="Git 引用">
                  <Input value={repositoryRef} onChange={event => setRepositoryRef(event.target.value)}
                    placeholder="默认使用 HEAD" maxLength={256} />
                </FormField>
                <FormField id="draft-package-path" label="包路径" description="仅多包仓库需要。">
                  <Input value={packagePath} onChange={event => setPackagePath(event.target.value)}
                    placeholder="packages/my-plugin" maxLength={1024} />
                </FormField>
              </>}
          <FormField id="draft-profile" label="配置"
            description={profileMode === 'custom' ? '自定义配置编辑器尚未实现；请选择主 DSH_HOME 配置继续。' : undefined}>
            <Select value={profileMode} onChange={event => setProfileMode(event.target.value as 'main-home' | 'custom')}>
              <option value="main-home">使用当前主 DSH_HOME 配置</option>
              <option value="custom">自定义配置（占位）</option>
            </Select>
          </FormField>
          {error !== undefined && <Notice tone="danger">{error}</Notice>}
          <Button variant="primary" type="submit" loading={creating} loadingLabel="正在创建…"
            disabled={profileMode === 'custom'}>创建草稿</Button>
        </form>}
        {selectedDraft === undefined
          ? !showCreate && <EmptyState title="选择或创建草稿" description="草稿标签位于顶部工作区栏。" />
          : <>
              <Tabs id="left-sidebar" className="left-sidebar-tabs" label="DSH 控制页面" value={leftPanel}
                onChange={(value: LeftPanel) => setLeftPanel(value)}
                options={[{ value: 'instance', label: '实例状态' }, { value: 'plugins', label: '插件管理' }]} />
              {leftPanel === 'instance' && <section id="left-sidebar-panel-instance" role="tabpanel"
                aria-labelledby="left-sidebar-tab-instance" className="left-sidebar-page instance-control-panel">
                <div className="instance-summary" data-state={starting ? 'starting' : selectedDraft.runtime.state}>
                  <span className="instance-status-dot" aria-hidden="true" />
                  <strong>实例{starting ? '正在执行' : selectedDraft.runtime.state === 'running' ? '运行中'
                    : selectedDraft.runtime.state === 'failed' ? '启动失败' : '已停止'}</strong>
                </div>
                <div className="instance-fields">
                  <label><span>草稿名称</span><Input value={draftLabel(selectedDraft)} maxLength={120}
                    onChange={event => setDraftLabels(current => ({ ...current, [selectedDraft.id]: event.target.value }))} /></label>
                  <label><span>工作树位置</span><code title={selectedDraft.worktreeDir}>{selectedDraft.worktreeDir}</code></label>
                </div>
                <div className="instance-actions">
                  <Button size="small" variant="primary" className="sidebar-action-button"
                    onClick={() => void startDraft()} loading={starting && selectedDraft.runtime.state !== 'running'}
                    loadingLabel="启动中" disabled={selectedDraft.runtime.state === 'running'}>
                    <StartIcon />启动</Button>
                  <Button size="small" className="sidebar-action-button" onClick={() => void stopDraft()}
                    loading={starting && selectedDraft.runtime.state === 'running'} loadingLabel="终止中"
                    disabled={selectedDraft.runtime.state !== 'running'}><StopIcon />终止</Button>
                  <Button size="small" className="sidebar-action-button" onClick={() => setPreviewKey(value => value + 1)}
                    disabled={previewUrl === undefined || starting}><RefreshIcon />刷新</Button>
                </div>
                {selectedDraft.runtime.error !== undefined && <Notice tone="danger">{selectedDraft.runtime.error}</Notice>}
              </section>}

              {leftPanel === 'plugins' && <section id="left-sidebar-panel-plugins" role="tabpanel"
                aria-labelledby="left-sidebar-tab-plugins" className="left-sidebar-page instance-pages">
                  <Tabs id="instance" label="插件管理标签页" value={instancePanel}
                    onChange={(value: InstancePanel) => setInstancePanel(value)}
                    options={[{ value: 'layers', label: '图层' }, { value: 'details', label: '详情' }]} />
                  {instancePanel === 'layers' && <div id="instance-panel-layers" role="tabpanel"
                    aria-labelledby="instance-tab-layers" className="instance-page-content">
                    <div className="layer-stack" aria-label="图层顺序">
                      <div><span className="layer-dot base" />主 DSH_HOME 配置快照</div>
                      <div><span className="layer-dot draft" />{project === undefined
                        ? '草稿预览未运行'
                        : project.state === 'staged' ? '草稿已暂存，等待首次预览确认'
                          : project.state === 'preview-pending' || confirming ? '修改已应用，等待预览确认'
                            : '草稿图层已启用'}</div>
                    </div>
                    <p className="project-note">停止实例会保留工作树和隔离配置；不同草稿可以同时运行。</p>
                  </div>}
                  {instancePanel === 'details' && <dl id="instance-panel-details" role="tabpanel"
                    aria-labelledby="instance-tab-details" className="instance-details">
                    <div><dt>插件包</dt><dd><code>{selectedDraft.name}</code></dd></div>
                    <div><dt>草稿标识</dt><dd><code>{selectedDraft.id}</code></dd></div>
                    <div><dt>运行目录</dt><dd><code>{selectedDraft.runtimeHome}</code></dd></div>
                    <div><dt>图谱版本</dt><dd><code>{project?.graphRev ?? '尚未生成'}</code></dd></div>
                  </dl>}
              </section>}
            </>}
        </div>
        {!terminalExpanded && terminal}
        {!leftSidebarCollapsed && <span className="sidebar-resizer" data-side="left" role="separator" tabIndex={0}
          aria-label="调整 DSH 控制栏宽度" aria-orientation="vertical"
          aria-valuemin={LEFT_SIDEBAR_MIN} aria-valuemax={LEFT_SIDEBAR_MAX} aria-valuenow={leftSidebarWidth}
          onPointerDown={event => beginSidebarResize(event, 'left')}
          onKeyDown={event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            changeSidebarWidthByKeyboard('left', event.key === 'ArrowLeft' ? -12 : 12)
          }} />}
      </Panel>

      <Panel ref={previewSectionRef} className="studio-preview studio-ui-fullscreen-surface" aria-label="WebUI 实时预览">
        {previewFullscreen && <IconButton className="preview-fullscreen-exit" variant="secondary"
          onClick={() => void togglePreviewFullscreen()} label="退出全屏预览">
          <FullscreenIcon active />
        </IconButton>}
        <div ref={previewStageRef} className="preview-stage">
          <div className="preview-artboard" data-empty={previewUrl === undefined || undefined}
            data-mode={previewMode}
            style={{ left: previewRect.x, top: previewRect.y, width: previewRect.width, height: previewRect.height }}>
            <div className="preview-viewport" style={{
              width: previewViewport.width,
              height: previewViewport.height,
              transform: `scale(${previewScale})`,
            }}>
                {previewUrl === undefined
                  ? <EmptyState className="preview-empty" title="选择并启动一个 Draft"
                      description="Preview Host 将使用隔离的 DSH_HOME 和端口。" />
                  : <iframe ref={previewRef} key={`${selectedDraftId}:${previewKey}`} title="DSH WebUI preview"
                      src={previewUrl} onLoad={connectPreview} />}
            </div>
            <ResizeHandles kind="preview" onPointerDown={beginPreviewResize} />
          </div>
        </div>
      </Panel>

      <aside id="draft-control-sidebar" className="studio-inspector-rail studio-sidebar" data-collapsed={rightSidebarCollapsed}
        aria-label="Draft 与 UI 控制">
        {!rightSidebarCollapsed && <span className="sidebar-resizer" data-side="right" role="separator" tabIndex={0}
          aria-label="调整 Draft 控制栏宽度" aria-orientation="vertical"
          aria-valuemin={RIGHT_SIDEBAR_MIN} aria-valuemax={RIGHT_SIDEBAR_MAX} aria-valuenow={rightSidebarWidth}
          onPointerDown={event => beginSidebarResize(event, 'right')}
          onKeyDown={event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            changeSidebarWidthByKeyboard('right', event.key === 'ArrowLeft' ? -12 : 12)
          }} />}
        <Panel className="preview-inspector studio-inspector-block">
          <div className="preview-inspector-heading">
            {!rightSidebarCollapsed && <div className="control-section-heading"><div><strong>实时预览</strong><span>交互与画板</span></div></div>}
          <IconButton size="small" variant="ghost" aria-expanded={!rightSidebarCollapsed}
            aria-controls="draft-control-sidebar" onClick={() => setRightSidebarCollapsed(value => !value)}
            label={rightSidebarCollapsed ? '展开 Draft 控制栏' : '收起 Draft 控制栏'}>
            <SidebarToggleIcon side="right" collapsed={rightSidebarCollapsed} />
          </IconButton>
          </div>

        {!rightSidebarCollapsed && <section className="preview-controls" aria-label="实时预览控制">
          <div className="preview-control-line">
            <FormField id="preview-aspect-ratio" label="画板比例">
              <Select value={previewAspectRatio}
                onChange={event => changePreviewAspectRatio(event.target.value as PreviewAspectRatio)}>
                {previewAspectRatios.map(ratio => <option key={ratio} value={ratio}>{ratio}</option>)}
                {previewAspectRatio === 'custom' && <option value="custom">自定义</option>}
              </Select>
            </FormField>
            <SegmentedControl className="preview-mode-control" label="Preview interaction mode" value={previewMode}
              options={[
                { value: 'browse', label: 'Browse', disabled: previewUrl === undefined },
                { value: 'inspect', label: 'Inspect', disabled: previewUrl === undefined },
              ]} onChange={changePreviewMode} />
          </div>
          <div className="preview-resolution-line">
            <span>WebUI 尺寸</span>
            <label><span>W</span><Input type="number" min={1} value={previewViewport.width}
              aria-label="WebUI viewport 宽度" onChange={event => changePreviewDimension('width', event.target.valueAsNumber)} /></label>
            <span aria-hidden="true">x</span>
            <label><span>H</span><Input type="number" min={1} value={previewViewport.height}
              aria-label="WebUI viewport 高度" onChange={event => changePreviewDimension('height', event.target.valueAsNumber)} /></label>
          </div>
          <div className="preview-zoom-line" aria-label="Studio 预览缩放">
            <Button size="small" className="preview-zoom-step" onClick={() => changePreviewScale(previewScale / 1.25)}
              aria-label="缩小 Studio 预览">-</Button>
            <span>{Math.round(previewScale * 100)}%</span>
            <Button size="small" className="preview-zoom-step" onClick={() => changePreviewScale(previewScale * 1.25)}
              aria-label="放大 Studio 预览">+</Button>
            <Button size="small" className="preview-fit-button" data-active={previewFit || undefined}
              onClick={() => setPreviewFit(true)}>适应画布</Button>
          </div>
          <div className="control-action-row">
            <Button size="small" className="sidebar-action-button" disabled={previewUrl === undefined}
              onClick={() => setPreviewKey(value => value + 1)}><RefreshIcon />重新载入</Button>
            <Button size="small" className="sidebar-action-button preview-fullscreen-button" disabled={previewUrl === undefined}
              onClick={() => void togglePreviewFullscreen()}>
              <FullscreenIcon active={previewFullscreen} />{previewFullscreen ? '退出全屏' : '全屏'}
            </Button>
          </div>
        </section>}
        </Panel>

        <Panel className="studio-inspector studio-inspector-block">
          <div className="inspector-nav">
            <Tabs id="studio" label="Studio 工具" value={panel} onChange={(value: Panel) => setPanel(value)} options={panels.map(item => ({
              value: item,
              label: item === 'elements' ? 'Elements' : item === 'selection' ? 'Select' : item === 'source' ? 'Source' : item === 'readiness' ? 'Ready' : 'Agent',
            }))} />
          </div>

        {error !== undefined && <Notice className="panel-error" tone="danger">{error}</Notice>}

        {panel === 'elements' && <PanelBody id="studio-panel-elements" aria-labelledby="studio-tab-elements" className="panel-content elements-panel" role="tabpanel">
          <div className="panel-heading">
            <div><h2>Draft Elements</h2><p>只展示当前 Draft 显式注册的子树与变量。</p></div>
            <Badge tone="info">{draftElements.length}</Badge>
          </div>
          {draftElements.length === 0 && draftVariables.length === 0
            ? <EmptyState title="当前 Draft 尚未注册 Elements"
                description="使用 dsh-harmony-react/studio 注册边界、源码入口和实时变量。" />
            : <>
                {draftElements.length > 0 && <div className="element-list" aria-label="Registered Draft Elements">
                  {draftElements.map(item => <button key={item.element.id} type="button"
                    data-active={focusedElement?.element.id === item.element.id}
                    data-matched={matchedElement?.element.id === item.element.id}
                    onClick={() => setFocusedElementId(item.element.id)}>
                    <span><strong>{item.element.label}</strong><code>{item.element.id}</code></span>
                    {matchedElement?.element.id === item.element.id && <small>Preview selection</small>}
                  </button>)}
                </div>}

                {focusedElement !== undefined && <section className="element-detail" aria-label={`${focusedElement.element.label} controls`}>
                  <div className="element-source-row">
                    <div><strong>{focusedElement.element.label}</strong><code>{focusedElement.element.source.file}</code></div>
                    <Button className="source-link" variant="ghost" size="small" disabled={!files.some(file => file.path === focusedElement.element.source.file)}
                      onClick={() => {
                        setPanel('source')
                        void openFile(focusedElement.element.source.file)
                      }}>打开 Element source</Button>
                  </div>
                  {matchedElement?.element.id === focusedElement.element.id
                    ? <p className="element-match" data-state="matched">选中节点位于这个 Element 的边界内。</p>
                    : selection !== undefined && <p className="element-match">当前选中节点不在这个 Element 的已注册边界内。</p>}
                  {matchedElement?.element.id === focusedElement.element.id && selection?.react !== undefined
                    && <PatchProvenance patches={selection.react.patches} currentOwner={selectedDraft?.name} boundaryMatched />}
                  {(focusedElement.element.variables ?? []).length === 0
                    ? <p className="inspection-empty">这个 Element 没有注册实时变量。</p>
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
                  <div className="section-heading"><strong>Plugin Variables</strong><span>{group.variables.length}</span></div>
                  <div className="element-variables">{group.variables.map(definition => <VariableControl
                    key={definition.id}
                    definition={definition}
                    value={group.values[definition.id]!}
                    onChange={value => setVariable({ scope: 'global', owner: group.owner, variableId: definition.id, value })}
                  />)}</div>
                </section>)}
                <p className="variable-note">这些控件只修改当前 Preview 的插件状态；重新载入前请通过源码或 Agent 固化。</p>
              </>}
        </PanelBody>}

        {panel === 'selection' && <PanelBody id="studio-panel-selection" aria-labelledby="studio-tab-selection" className="panel-content selection-panel" role="tabpanel">
          <div className="panel-heading">
            <div><h2>元素与 Patch</h2><p>上游快照只读；所有修改写入当前 Draft 图层。</p></div>
          </div>
          {selection === undefined
            ? <EmptyState title="在 Preview 中选择一个元素"
                description="切换到 Inspect，再点击页面元素。按 Escape 可立即回到 Browse。" />
            : <section className="selection-result" aria-label="已选元素">
                <div className="selection-title">
                  <code>{selection.tag}{selection.id === undefined ? '' : `#${selection.id}`}
                    {selection.classes.map(name => `.${name}`).join('')}</code>
                  <Badge tone={selection.confidence === 'mapped' ? 'success' : selection.confidence === 'component-only' ? 'info' : 'neutral'}>
                    {selection.confidence === 'mapped' ? 'Source mapped'
                      : selection.confidence === 'component-only' ? 'React mapped' : 'DOM only'}
                  </Badge>
                </div>
                {selection.text !== '' && <p className="selection-text">{selection.text}</p>}
                <dl className="selection-meta">
                  <div><dt>位置</dt><dd>{Math.round(selection.rect.x)}, {Math.round(selection.rect.y)} · {Math.round(selection.rect.width)} × {Math.round(selection.rect.height)}</dd></div>
                  {selection.react?.component !== undefined && <div><dt>组件</dt><dd>{selection.react.component}</dd></div>}
                  {selection.react !== undefined && selection.react.owners.length > 0
                    && <div><dt>Owners</dt><dd>{selection.react.owners.join(' → ')}</dd></div>}
                  {selection.react?.source !== undefined && <div><dt>Source</dt><dd>
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
                    }}>打开 Selected node source</Button>}
                  </dd></div>}
                </dl>
                {selection.react !== undefined && <PatchProvenance patches={selection.react.patches}
                  currentOwner={selectedDraft?.name} boundaryMatched={matchedElement !== undefined} />}
                {selection.react !== undefined && Object.keys(selection.react.props).length > 0 && <details>
                  <summary>安全 Props</summary>
                  <pre className="selection-code">{JSON.stringify(selection.react.props, null, 2)}</pre>
                </details>}
                <details>
                  <summary>Sanitized outerHTML</summary>
                  <pre className="selection-code">{selection.outerHTML}</pre>
                </details>
              </section>}

          <section className="harmony-inspection" aria-label="Harmony Patch 目标">
            <div className="section-heading"><strong>已物化的 Harmony targets</strong><span>{inspection.targets.length}</span></div>
            {inspection.targets.length === 0
              ? <p className="inspection-empty">当前 runtime 尚无已物化的 target inspection。先让 Preview 加载相关 bundle。</p>
              : inspection.targets.map(target => <details className="harmony-target" key={`${target.package}:${target.file}`}>
                  <summary><span>{target.package}</span><code>{target.file}</code></summary>
                  <div className="harmony-target-body">
                    <p>{target.steps.length} 个有序 Patch step · 上游只读</p>
                    {target.steps.map(step => <details key={`${step.owner}:${step.key}`}>
                      <summary>{step.owner} / {step.key} · {step.matches} matches</summary>
                      <pre className="selection-code">{step.source}</pre>
                    </details>)}
                    <details><summary>Original</summary><pre className="selection-code">{target.original}</pre></details>
                    <details><summary>Final</summary><pre className="selection-code">{target.final}</pre></details>
                  </div>
                </details>)}
          </section>
        </PanelBody>}

        {panel === 'source' && <PanelBody id="studio-panel-source" aria-labelledby="studio-tab-source" className="panel-content source-panel" role="tabpanel">
          <div className="panel-heading">
            <div><h2>Draft Source</h2><p>只编辑 linked Draft 根目录内的 UTF-8 文件。</p></div>
          </div>
          <div className="source-toolbar">
            <FormField id="source-file" label="Project file">
              <Select value={filePath} onChange={event => void openFile(event.target.value)}
                disabled={project === undefined || fileBusy}>
                <option value="">{files.length === 0 ? '没有可编辑文件' : '选择文件…'}</option>
                {files.map(file => <option key={file.path} value={file.path}>{file.path}</option>)}
              </Select>
            </FormField>
          </div>
          {filePath === ''
            ? <EmptyState className="source-empty" title={project === undefined ? '先打开 linked Draft' : '选择一个 Draft 文件'}
                description="编辑器不会写入 DSH 或其他已安装插件的源码。" />
            : <>
                <CodeEditor key={filePath} path={filePath} value={source} onChange={setSource} />
                <div className="source-actions">
                  <span>{source === savedSource ? '已保存' : '有未保存修改'}</span>
                  <Button variant="primary" onClick={() => void saveFile()} loading={fileBusy}
                    loadingLabel="正在保存…" disabled={source === savedSource}>保存到 Draft</Button>
                </div>
              </>}
        </PanelBody>}

        {panel === 'readiness' && <PanelBody id="studio-panel-readiness" aria-labelledby="studio-tab-readiness"
          className="panel-content readiness-panel" role="tabpanel">
          <div className="panel-heading readiness-heading">
            <div><h2>发布就绪检查</h2><p>验证当前 Draft 与真实 Preview；不承诺其他 profile 的 ambient providers。</p></div>
            <Button size="small" onClick={() => void runPack()} loading={packing} loadingLabel="检查中…"
              disabled={project === undefined}>npm pack dry-run</Button>
          </div>
          {project === undefined
            ? <EmptyState title="先打开 Draft" description="Readiness 只检查当前叠加图层，不修改上游包。" />
            : <>
                <div className="readiness-summary" aria-label="Readiness summary">
                  {(['error', 'warning', 'info'] as StudioReadinessLevel[]).map(level => <div key={level} data-level={level}>
                    <strong>{readiness.findings.filter(item => item.level === level).length}</strong><span>{level}</span>
                  </div>)}
                </div>
                {readiness.findings.length === 0
                  ? <p className="readiness-clear">静态检查与当前 Preview 未发现问题。仍建议在发布前运行 package dry-run。</p>
                  : <div className="readiness-findings">{readiness.findings.map((item, index) => <article
                      key={`${item.code}:${item.patch ?? item.file ?? index}`} data-level={item.level}>
                      <div><span>{item.level}</span><code>{item.code}</code></div>
                      <p>{item.message}</p>
                      {(item.file !== undefined || item.patch !== undefined) && <small>{[item.patch, item.file].filter(Boolean).join(' · ')}</small>}
                    </article>)}</div>}
                {readiness.pack !== undefined && <section className="pack-result" data-ok={readiness.pack.ok} aria-label="npm pack dry-run result">
                  <div><strong>{readiness.pack.ok ? 'Package dry-run 通过' : 'Package dry-run 失败'}</strong>
                    <span>{readiness.pack.files.length} files</span></div>
                  {readiness.pack.files.length > 0 && <details><summary>查看打包文件</summary>
                    <pre className="selection-code">{readiness.pack.files.join('\n')}</pre></details>}
                  {(readiness.pack.stdout !== '' || readiness.pack.stderr !== '') && <details><summary>查看 npm 输出</summary>
                    <pre className="selection-code">{[readiness.pack.stdout, readiness.pack.stderr].filter(Boolean).join('\n')}</pre></details>}
                </section>}
              </>}
        </PanelBody>}

        {panel === 'agent' && <PanelBody id="studio-panel-agent" aria-labelledby="studio-tab-agent" className="agent-panel" role="tabpanel">
          <div className="panel-heading agent-heading">
            <div><h2>辅助 Agent</h2><p>{running ? '正在处理草稿' : sessionId === undefined ? '等待启动' : '可以继续提出修改'}</p></div>
            {running && <Button variant="danger" size="small" onClick={() => void cancel()}>停止</Button>}
          </div>
          <p className="agent-scope">真实 DSH session，仅开放 Selection、Harmony inspection、Draft 文件和构建预览工具。</p>
          <div className="conversation" aria-live="polite">
            {messages.length === 0 && streaming === '' && <EmptyState className="agent-empty"
              title={project?.state === 'active' ? '让 Agent 从当前 Draft 开始' : '先打开并激活 linked Draft'}
              description="Agent 使用 DSH 自身的模型与 session；Draft 生命周期不依赖 Agent。"
              action={project?.state === 'active' && sessionId === undefined
                ? <Button variant="primary" loading={creating} loadingLabel="正在创建…"
                    onClick={() => void createAgent()}>启动 Studio Agent</Button>
                : undefined} />}
            {messages.map(message => <article key={message.id} className={`message ${message.role}`}>
              <span>{message.role === 'user' ? '你' : 'Agent'}</span><p>{message.text}</p>
            </article>)}
            {streaming !== '' && <article className="message assistant streaming"><span>Agent</span><p>{streaming}</p></article>}
          </div>
          {interaction !== undefined && <Notice className="interaction-notice" tone="warning">{interaction}</Notice>}
          <form className="composer" onSubmit={event => void sendPrompt(event)}>
            <Textarea aria-label="给 Studio Agent 的消息" value={prompt} onChange={event => setPrompt(event.target.value)}
              placeholder={sessionId === undefined ? '先启动 Studio Agent' : '描述你希望叠加到 WebUI 的修改…'}
              disabled={sessionId === undefined || sending} rows={3} />
            <Button variant="primary" type="submit" loading={sending} loadingLabel="发送中…"
              disabled={sessionId === undefined || prompt.trim() === ''}>发送</Button>
          </form>
        </PanelBody>}
      </Panel>
      </aside>
    </main>
    {terminalExpanded && terminal !== null && createPortal(terminal, document.body)}
  </div>
}
