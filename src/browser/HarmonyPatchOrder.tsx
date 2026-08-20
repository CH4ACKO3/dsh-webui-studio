import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { StudioHarmonyInspection, StudioHarmonyProfile } from '../contracts'
import { useStudioLocale } from './i18n'
import { isProfilePatchEnabled, sameStringList, setProfilePatchEnabled, setProfilePluginEnabled } from './profile-order'
import { Badge, Button, Notice } from './ui'

type PatchStatus = StudioHarmonyInspection['patches'][number]
type PatchCardStatus = 'normal' | 'disabled' | 'warning' | 'error'
type Selection = { kind: 'plugin' | 'patch'; key: string }
type PatchViewNode =
  | { type: 'patch'; key: string; owner: string; index: number }
  | { type: 'stack'; id: string; owner: string; keys: string[]; start: number; end: number; expanded: boolean }
  | { type: 'placeholder'; index: number }
type PatchStackNode = Extract<PatchViewNode, { type: 'stack' }>

interface PatchDragProjection {
  keys: string[]
  target: number
  visible: boolean
}

interface PatchDragPreview {
  keys: string[]
  owner: string
  kind: 'patch' | 'stack'
  x: number
  y: number
  width: number
  height: number
  offsetX: number
  offsetY: number
}

interface ActivePatchDrag extends PatchDragPreview {
  pointerId: number
  originX: number
  originY: number
  lastX: number
  lastY: number
  moved: boolean
  target: number
  markerVisible: boolean
}

interface PointerCoordinates {
  pointerId: number
  clientX: number
  clientY: number
  type: string
}

const stackMinGap = 2
const stackLogGapScale = 12
const stackBottomInset = 12
const dragStartDistance = 8
const stackStatusWeight: Record<PatchCardStatus, number> = { normal: 1, disabled: 0.5, warning: 1.5, error: 1.5 }
const displayName = (name: string): string => name.replace(/^@[^/]+\//, '')
const stackId = (owner: string, keys: string[]): string => `${owner}:${keys.join('|')}`
const stackBoundary = (left: string, right: string): string => `${left}\0${right}`

export function insertPatches(order: string[], keys: string[], target: number): string[] {
  const moving = new Set(keys)
  const remaining = order.filter(item => !moving.has(item))
  remaining.splice(Math.max(0, Math.min(target, remaining.length)), 0, ...keys)
  return remaining
}

function stackGeometry(statuses: PatchCardStatus[]): { positions: number[]; height: number } {
  const base = Math.log(Math.max(1, statuses.length)) * stackLogGapScale / Math.max(1, statuses.length)
  const gaps = statuses.map(status => Math.max(base * stackStatusWeight[status], stackMinGap))
  const positions = [0]
  for (const gap of gaps) positions.push(positions.at(-1)! + gap)
  return { positions, height: positions.at(-1)! }
}

function stackLayer(statuses: PatchCardStatus[], depth: number): { bottom: number; left: number; right: number } {
  const { positions, height } = stackGeometry(statuses)
  const bottom = positions[depth + 1]!
  const inset = bottom / height * stackBottomInset
  return { bottom, left: inset, right: inset }
}

function patchOwner(key: string, patches: ReadonlyMap<string, PatchStatus>): string {
  return patches.get(key)?.owner ?? key.slice(0, Math.max(0, key.lastIndexOf('/')))
}

export function reconcilePatchView(
  order: string[],
  patches: ReadonlyMap<string, PatchStatus>,
  expandedKeys: ReadonlySet<string>,
  stackBreaks: ReadonlySet<string>,
  dragProjection: PatchDragProjection | null,
): PatchViewNode[] {
  const entries: Array<string | null> = dragProjection === null ? [...order] : (() => {
    const moving = new Set(dragProjection.keys)
    const remaining: Array<string | null> = order.filter(key => !moving.has(key))
    if (dragProjection.visible) remaining.splice(Math.max(0, Math.min(dragProjection.target, remaining.length)), 0, null)
    return remaining
  })()
  const nodes: PatchViewNode[] = []
  let run: { owner: string; keys: string[]; start: number; end: number } | null = null
  const flush = (): void => {
    if (run === null) return
    if (run.keys.length === 1) nodes.push({ type: 'patch', key: run.keys[0]!, owner: run.owner, index: run.start })
    else nodes.push({
      type: 'stack', id: stackId(run.owner, run.keys), owner: run.owner, keys: run.keys,
      start: run.start, end: run.end, expanded: run.keys.some(key => expandedKeys.has(key)),
    })
    run = null
  }
  let patchIndex = 0
  for (const entry of entries) {
    if (entry === null) {
      flush()
      nodes.push({ type: 'placeholder', index: patchIndex })
      continue
    }
    const owner = patchOwner(entry, patches)
    const previous = run?.keys.at(-1)
    if (run !== null && run.owner === owner && previous !== undefined && !stackBreaks.has(stackBoundary(previous, entry))) {
      run.keys.push(entry)
      run.end = patchIndex + 1
    } else {
      flush()
      run = { owner, keys: [entry], start: patchIndex, end: patchIndex + 1 }
    }
    patchIndex += 1
  }
  flush()
  return nodes
}

export function HarmonyPatchOrder({ profile, inspection, order, disabled, saving, onOrderChange, onDisabledChange, onApply, onUndo }: {
  profile: StudioHarmonyProfile
  inspection: StudioHarmonyInspection
  order: string[]
  disabled: string[]
  saving: boolean
  onOrderChange(order: string[]): void
  onDisabledChange(disabled: string[]): void
  onApply(): void
  onUndo(): void
}): JSX.Element {
  const { t } = useStudioLocale()
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  const [stackBreaks, setStackBreaks] = useState<Set<string>>(new Set())
  const [draggingKeys, setDraggingKeys] = useState<string[]>([])
  const [dragProjection, setDragProjection] = useState<PatchDragProjection | null>(null)
  const [dragPreview, setDragPreview] = useState<PatchDragPreview | null>(null)
  const [selected, setSelected] = useState<Selection | null>(() => {
    const owner = inspection.patches[0]?.owner
    return owner === undefined ? null : { kind: 'plugin', key: owner }
  })
  const listRef = useRef<HTMLDivElement | null>(null)
  const patchRefs = useRef(new Map<string, HTMLButtonElement>())
  const coverRefs = useRef(new Map<string, HTMLDivElement>())
  const drag = useRef<ActivePatchDrag | null>(null)
  const pendingLayout = useRef<{ positions: Map<string, DOMRect>; duration: number } | null>(null)
  const orderRef = useRef(order)
  const stackBreaksRef = useRef(stackBreaks)
  const viewNodesRef = useRef<PatchViewNode[]>([])
  const suppressCardClick = useRef(false)
  orderRef.current = order
  stackBreaksRef.current = stackBreaks

  const plugins = useMemo(() => new Map(profile.plugins.map(plugin => [plugin.name, plugin])), [profile.plugins])
  const patchMap = useMemo(() => new Map(inspection.patches.map(patch => [patch.key, patch])), [inspection.patches])
  const warningPatchKeys = useMemo(() => new Set(profile.patchOrderViolations.flatMap(item => [item.before, item.after])), [profile.patchOrderViolations])
  const cardStatus = (key: string): PatchCardStatus => {
    const patch = patchMap.get(key)
    if (!isProfilePatchEnabled(disabled, patch?.owner ?? patchOwner(key, patchMap), key) || patch?.state === 'disabled') return 'disabled'
    if (patch?.state === 'failed') return 'error'
    if (patch?.state === 'pending' || warningPatchKeys.has(key)) return 'warning'
    return 'normal'
  }
  const stackStatuses = (keys: string[]): PatchCardStatus[] => keys.map(cardStatus)
  const stackHealthColor = (keys: string[]): string => {
    const statuses = stackStatuses(keys).filter(status => status !== 'disabled')
    if (statuses.length === 0) return 'var(--dsw-alias-label-tertiary)'
    const warning = statuses.filter(status => status === 'warning').length / statuses.length
    const error = statuses.filter(status => status === 'error').length / statuses.length
    const nonError = 1 - error
    const warningWithinNonError = nonError === 0 ? 0 : warning / nonError
    const whiteOrange = `color-mix(in srgb,#fff ${Math.round((1 - warningWithinNonError) * 100)}%,#f59e0b)`
    return error === 0 ? whiteOrange
      : `color-mix(in srgb,${whiteOrange} ${Math.round(nonError * 100)}%,var(--dsw-alias-state-error-primary))`
  }
  const stackCoverColor = (keys: string[]): string => stackStatuses(keys).every(status => status === 'disabled')
    ? 'color-mix(in srgb,var(--dsw-alias-label-tertiary) 10%,var(--dsw-alias-bg-layer-2))'
    : `color-mix(in srgb,${stackHealthColor(keys)} 10%,var(--dsw-alias-bg-layer-2))`
  const stackHealthTitle = (keys: string[]): string => {
    const statuses = stackStatuses(keys)
    if (statuses.every(status => status === 'disabled')) return t('profilePatchStatusDisabled')
    const warnings = statuses.filter(status => status === 'warning').length
    const errors = statuses.filter(status => status === 'error').length
    return warnings + errors === 0 ? t('profilePatchStatusNormal')
      : [warnings > 0 ? `${warnings} ${t('profilePatchStatusWarning')}` : '', errors > 0 ? `${errors} ${t('profilePatchStatusError')}` : ''].filter(Boolean).join(' · ')
  }
  const viewNodes = useMemo(
    () => reconcilePatchView(order, patchMap, expandedKeys, stackBreaks, dragProjection),
    [order, patchMap, expandedKeys, stackBreaks, dragProjection],
  )
  viewNodesRef.current = viewNodes

  useLayoutEffect(() => {
    const pending = pendingLayout.current
    pendingLayout.current = null
    if (pending === null) return
    for (const [token, previous] of pending.positions) {
      const element = token.startsWith('patch:') ? patchRefs.current.get(token.slice(6)) : coverRefs.current.get(token.slice(6))
      if (element === undefined) continue
      const current = element.getBoundingClientRect()
      const x = previous.left - current.left
      const y = previous.top - current.top
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) continue
      element.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }], {
        duration: pending.duration, easing: 'cubic-bezier(.16,1,.3,1)',
      })
    }
  }, [viewNodes])

  useEffect(() => {
    const finish = (event: PointerEvent): void => finishDrag(event)
    window.addEventListener('pointerup', finish, true)
    window.addEventListener('pointercancel', finish, true)
    return () => {
      window.removeEventListener('pointerup', finish, true)
      window.removeEventListener('pointercancel', finish, true)
    }
  })

  const captureLayout = (duration: number, overrides?: ReadonlyMap<string, DOMRect>): void => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const positions = new Map([
      ...[...patchRefs.current].map(([key, element]) => [`patch:${key}`, element.getBoundingClientRect()] as const),
      ...[...coverRefs.current].map(([id, element]) => [`cover:${id}`, element.getBoundingClientRect()] as const),
    ])
    for (const [key, bounds] of overrides ?? []) positions.set(`patch:${key}`, bounds)
    pendingLayout.current = { positions, duration }
  }

  const applyOrder = (next: string[], overrides?: ReadonlyMap<string, DOMRect>): void => {
    const breaks = new Set([...stackBreaksRef.current].filter(boundary => {
      const [left, right] = boundary.split('\0')
      const index = next.indexOf(left!)
      return index >= 0 && next[index + 1] === right
    }))
    captureLayout(320, overrides)
    setStackBreaks(breaks)
    stackBreaksRef.current = breaks
    if (next.every((key, index) => key === orderRef.current[index])) return
    orderRef.current = next
    onOrderChange(next)
  }

  const patchBounds = (key: string): DOMRect | undefined => {
    const element = patchRefs.current.get(key)
    return (element?.parentElement ?? element)?.getBoundingClientRect()
  }
  const nodeKeys = (node: Exclude<PatchViewNode, { type: 'placeholder' }>): string[] => node.type === 'patch' ? [node.key] : node.keys
  const nodeBounds = (node: Exclude<PatchViewNode, { type: 'placeholder' }>): DOMRect | undefined => {
    if (node.type === 'patch') return patchBounds(node.key)
    if (!node.expanded) return coverRefs.current.get(node.id)?.getBoundingClientRect()
    const bounds = node.keys.map(patchBounds).filter((value): value is DOMRect => value !== undefined)
    if (bounds.length === 0) return undefined
    const left = Math.min(...bounds.map(value => value.left))
    const top = Math.min(...bounds.map(value => value.top))
    const right = Math.max(...bounds.map(value => value.right))
    const bottom = Math.max(...bounds.map(value => value.bottom))
    return new DOMRect(left, top, right - left, bottom - top)
  }
  const reconcileMerges = (clientY: number): void => {
    const remove: string[] = []
    const runs: Array<Array<Exclude<PatchViewNode, { type: 'placeholder' }>>> = []
    for (const node of viewNodesRef.current) {
      if (node.type === 'placeholder') continue
      const active = runs.at(-1)
      if (active?.[0]?.owner === node.owner) active.push(node)
      else runs.push([node])
    }
    for (const run of runs) {
      if (run.length < 2) continue
      const boundaries = run.slice(1).map((right, index) => stackBoundary(nodeKeys(run[index]!).at(-1)!, nodeKeys(right)[0]!))
        .filter(boundary => stackBreaksRef.current.has(boundary))
      const bounds = run.map(nodeBounds).filter((value): value is DOMRect => value !== undefined)
      if (boundaries.length === 0 || bounds.length !== run.length) continue
      const top = Math.min(...bounds.map(value => value.top))
      const bottom = Math.max(...bounds.map(value => value.bottom))
      if (clientY < top || clientY > bottom) remove.push(...boundaries)
    }
    if (remove.length === 0) return
    captureLayout(320)
    const next = new Set(stackBreaksRef.current)
    for (const boundary of remove) next.delete(boundary)
    stackBreaksRef.current = next
    setStackBreaks(next)
  }

  const visibleDropCards = (): Array<{ start: number; end: number; bounds: DOMRect }> => {
    const moving = new Set(drag.current?.keys ?? [])
    const cards: Array<{ start: number; end: number; bounds: DOMRect }> = []
    let position = 0
    for (const node of viewNodesRef.current) {
      if (node.type === 'placeholder') continue
      if (node.type === 'patch') {
        if (moving.has(node.key)) continue
        const element = patchRefs.current.get(node.key)
        if (element !== undefined) cards.push({ start: position, end: position + 1, bounds: element.getBoundingClientRect() })
        position += 1
        continue
      }
      const keys = node.keys.filter(key => !moving.has(key))
      if (keys.length === 0) continue
      if (!node.expanded) {
        const element = coverRefs.current.get(node.id)
        if (element !== undefined) cards.push({ start: position, end: position + keys.length, bounds: element.getBoundingClientRect() })
        position += keys.length
        continue
      }
      for (const key of keys) {
        const element = patchRefs.current.get(key)
        if (element !== undefined) cards.push({ start: position, end: position + 1, bounds: element.getBoundingClientRect() })
        position += 1
      }
    }
    return cards.sort((left, right) => left.bounds.top - right.bounds.top)
  }

  const dropProjectionAt = (clientX: number, clientY: number): { target: number; visible: boolean } => {
    const cards = visibleDropCards()
    if (cards.length === 0) return { target: 0, visible: true }
    const over = cards.find(({ bounds }) => clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom)
    if (over !== undefined) return { target: clientY < over.bounds.top + over.bounds.height / 2 ? over.start : over.end, visible: false }
    const gaps = [
      { target: cards[0]!.start, y: cards[0]!.bounds.top },
      ...cards.slice(1).map((card, index) => ({ target: card.start, y: (cards[index]!.bounds.bottom + card.bounds.top) / 2 })),
      { target: cards.at(-1)!.end, y: cards.at(-1)!.bounds.bottom },
    ]
    const nearest = gaps.reduce((current, gap) => Math.abs(clientY - gap.y) < Math.abs(clientY - current.y) ? gap : current, gaps[0]!)
    return { target: nearest.target, visible: true }
  }

  const beginDrag = (event: ReactPointerEvent<HTMLElement>, keys: string[], owner: string, kind: 'patch' | 'stack', element: HTMLElement): void => {
    if (event.button !== 0 || saving) return
    listRef.current?.setPointerCapture(event.pointerId)
    const bounds = element.getBoundingClientRect()
    const index = Math.min(...keys.map(key => orderRef.current.indexOf(key)).filter(value => value >= 0))
    drag.current = {
      keys: [...keys], owner, kind, pointerId: event.pointerId,
      originX: event.clientX, originY: event.clientY, lastX: event.clientX, lastY: event.clientY,
      moved: false, target: Math.max(0, index), markerVisible: false,
      x: event.clientX, y: event.clientY, width: bounds.width, height: bounds.height,
      offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top,
    }
  }

  const moveFromPointer = (event: ReactPointerEvent<HTMLDivElement>): void => {
    reconcileMerges(event.clientY)
    const active = drag.current
    if (active?.pointerId !== event.pointerId || saving) return
    active.lastX = event.clientX
    active.lastY = event.clientY
    if (!active.moved && Math.hypot(event.clientX - active.originX, event.clientY - active.originY) < dragStartDistance) return
    if (!active.moved) {
      active.moved = true
      setDraggingKeys(active.keys)
      setSelected(active.kind === 'patch' ? { kind: 'patch', key: active.keys[0]! } : { kind: 'plugin', key: active.owner })
      setDragPreview({ ...active })
      captureLayout(180)
      setDragProjection({ keys: active.keys, target: active.target, visible: false })
    }
    const bounds = event.currentTarget.getBoundingClientRect()
    if (event.clientY < bounds.top + 32) event.currentTarget.scrollTop -= 10
    else if (event.clientY > bounds.bottom - 32) event.currentTarget.scrollTop += 10
    setDragPreview({ ...active, x: event.clientX, y: event.clientY })
    const projection = dropProjectionAt(event.clientX, event.clientY)
    if (active.target === projection.target && active.markerVisible === projection.visible) return
    active.target = projection.target
    active.markerVisible = projection.visible
    captureLayout(180)
    setDragProjection({ keys: active.keys, target: projection.target, visible: projection.visible })
  }

  function finishDrag(event: PointerCoordinates): void {
    const active = drag.current
    if (active?.pointerId !== event.pointerId) return
    const target = active.moved ? dropProjectionAt(event.clientX, event.clientY).target : active.target
    drag.current = null
    if (!active.moved && event.type === 'pointerup') {
      suppressCardClick.current = true
      window.setTimeout(() => { suppressCardClick.current = false }, 0)
      if (active.kind === 'stack') {
        setSelected({ kind: 'plugin', key: active.owner })
        setExpandedKeys(current => new Set([...current, ...active.keys]))
      } else setSelected({ kind: 'patch', key: active.keys[0]! })
      return
    }
    if (!active.moved) return
    setDraggingKeys([])
    setDragProjection(null)
    setDragPreview(null)
    setExpandedKeys(current => {
      const next = new Set(current)
      for (const key of active.keys) next.delete(key)
      return next
    })
    const nextOrder = insertPatches(orderRef.current, active.keys, target)
    const firstIndex = nextOrder.indexOf(active.keys[0]!)
    const lastIndex = firstIndex + active.keys.length - 1
    const nextBreaks = new Set([...stackBreaksRef.current].filter(boundary => {
      const [left, right] = boundary.split('\0')
      const index = nextOrder.indexOf(left!)
      return index >= 0 && nextOrder[index + 1] === right
    }))
    const previous = nextOrder[firstIndex - 1]
    const next = nextOrder[lastIndex + 1]
    if (previous !== undefined && patchOwner(previous, patchMap) === active.owner) nextBreaks.add(stackBoundary(previous, active.keys[0]!))
    if (next !== undefined && patchOwner(next, patchMap) === active.owner) nextBreaks.add(stackBoundary(active.keys.at(-1)!, next))
    stackBreaksRef.current = nextBreaks
    setStackBreaks(nextBreaks)
    const left = active.lastX - active.offsetX
    const top = active.lastY - active.offsetY
    const statuses = stackStatuses(active.keys)
    const previewBounds = new Map(active.keys.map((key, depth) => {
      const layer = active.kind === 'stack' ? stackLayer(statuses, depth) : { bottom: 0, left: 0, right: 0 }
      const height = patchRefs.current.get(key)?.getBoundingClientRect().height ?? active.height
      const y = active.kind === 'stack' ? top + active.height + layer.bottom - height : top
      return [key, new DOMRect(left + layer.left, y, active.width - layer.left - layer.right, height)] as const
    }))
    applyOrder(nextOrder, previewBounds)
    requestAnimationFrame(() => reconcileMerges(event.clientY))
  }

  const moveByKeyboard = (key: string, offset: -1 | 1): void => {
    if (saving) return
    const index = orderRef.current.indexOf(key)
    if (index < 0) return
    const target = offset < 0 ? Math.max(0, index - 1) : Math.min(orderRef.current.length - 1, index + 1)
    applyOrder(insertPatches(orderRef.current, [key], target))
    requestAnimationFrame(() => patchRefs.current.get(key)?.focus())
  }

  const selectedPatch = selected?.kind === 'patch' ? patchMap.get(selected.key) : undefined
  const selectedOwner = selectedPatch?.owner ?? (selected?.kind === 'plugin' ? selected.key : undefined)
  const selectedPlugin = selectedOwner === undefined ? undefined : plugins.get(selectedOwner)
  const ownerKeys = selectedOwner === undefined ? [] : order.filter(key => patchOwner(key, patchMap) === selectedOwner)
  const ownerEnabled = selectedOwner === undefined || !disabled.includes(`${selectedOwner}/*`)
  const dirty = !sameStringList(order, profile.patchOrder) || !sameStringList(disabled, profile.disabled)

  const renderPatch = (key: string, stack?: PatchStackNode, depth = 0): JSX.Element => {
    const patch = patchMap.get(key)
    const index = order.indexOf(key)
    const owner = patch?.owner ?? patchOwner(key, patchMap)
    const stacked = stack !== undefined && !stack.expanded
    const status = cardStatus(key)
    const geometry = stack === undefined ? null : stackGeometry(stackStatuses(stack.keys))
    const layer = stack === undefined ? { bottom: 0, left: 0, right: 0 } : stackLayer(stackStatuses(stack.keys), depth)
    return <div className="dshHarmonyPatchItem" key={key} role="listitem" style={stacked ? {
      bottom: `${geometry!.height - layer.bottom}px`, right: `${layer.right}px`, left: `${layer.left}px`, zIndex: stack.keys.length - depth,
    } : undefined}>
      <button ref={element => { if (element === null) patchRefs.current.delete(key); else patchRefs.current.set(key, element) }}
        type="button" className="dshHarmonyPatchCard" data-patch-key={key} data-status={status}
        data-selected={selected?.kind === 'patch' && selected.key === key || undefined}
        data-owner-selected={selectedOwner === owner || undefined} data-dragging={draggingKeys.includes(key) || undefined}
        aria-hidden={stacked || undefined} aria-label={key} tabIndex={stacked ? -1 : undefined}
        onClick={() => {
          if (suppressCardClick.current) { suppressCardClick.current = false; return }
          setSelected({ kind: 'patch', key })
        }}
        onPointerDown={event => beginDrag(event, [key], owner, 'patch', event.currentTarget)}
        onKeyDown={event => {
          if (event.key === 'Escape' && stack?.expanded) {
            event.preventDefault()
            setExpandedKeys(current => { const next = new Set(current); for (const item of stack.keys) next.delete(item); return next })
            return
          }
          if (!event.altKey || event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          event.preventDefault()
          moveByKeyboard(key, event.key === 'ArrowUp' ? -1 : 1)
        }}>
        <span className="dshHarmonyPatchGrip" aria-hidden="true" />
        <span className="dshHarmonyIndex">{String(index + 1).padStart(2, '0')}</span>
        <span className="dshHarmonyPatchText"><span className="dshHarmonyPatchName" title={key}>{patch?.id ?? key.slice(owner.length + 1)}</span>
          <span className="dshHarmonyPatchOwner">{displayName(owner)}</span></span>
        <span className="dshHarmonyOrderState" data-state={patch?.state} title={status} />
      </button>
    </div>
  }

  return <div className="dshHarmonyPage" onWheel={event => {
    const active = drag.current
    const list = listRef.current
    if (!active?.moved || list === null) return
    const bounds = list.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
      event.preventDefault()
      list.scrollTop += event.deltaY
    }
  }}>
    {profile.patchOrderViolations.length > 0 && <Notice tone="warning">{t('profilePatchOrderWarning', { count: profile.patchOrderViolations.length })}</Notice>}
    <div className="dshHarmonyWorkspace">
      {order.length === 0 ? <p className="dshHarmonyStatus">{t('patchManagementEmpty')}</p>
        : <div ref={listRef} className="dshHarmonyList" role="list" aria-label={t('profilePatchOrder')}
            data-has-selection={selectedOwner === undefined ? undefined : 'true'} onPointerMove={moveFromPointer}
            onPointerUp={finishDrag} onPointerCancel={finishDrag}>
            {viewNodes.map(node => {
              if (node.type === 'patch') return renderPatch(node.key)
              if (node.type === 'placeholder') return <div className="dshHarmonyPatchItem" key="drag-placeholder" role="listitem">
                <div className="dshHarmonyDropSlot" role="status" aria-label={t('profilePatchDropAt', { index: node.index + 1 })} />
              </div>
              return <div key={node.id} className="dshHarmonyStack" role="presentation"
                data-collapsed={!node.expanded || undefined} data-expanded={node.expanded || undefined}
                data-selected={selected?.kind === 'plugin' && selected.key === node.owner || undefined}
                data-owner-selected={selectedOwner === node.owner || undefined}
                data-dragging={node.keys.every(key => draggingKeys.includes(key)) || undefined}
                style={node.expanded ? undefined : { paddingBottom: `${stackGeometry(stackStatuses(node.keys)).height}px` }}
                onPointerDown={event => {
                  if (node.expanded) return
                  beginDrag(event, node.keys, node.owner, 'stack', coverRefs.current.get(node.id) ?? event.currentTarget)
                }} onClick={() => {
                  if (node.expanded) return
                  if (suppressCardClick.current) { suppressCardClick.current = false; return }
                  setSelected({ kind: 'plugin', key: node.owner })
                  captureLayout(380)
                  setExpandedKeys(current => new Set([...current, ...node.keys]))
                }}>
                <div ref={element => { if (element === null) coverRefs.current.delete(node.id); else coverRefs.current.set(node.id, element) }}
                  className="dshHarmonyStackCover" role={node.expanded ? undefined : 'listitem'} aria-hidden={node.expanded || undefined}
                  style={{ background: stackCoverColor(node.keys) }}>
                  <button className="dshHarmonyStackSummary" type="button" aria-expanded={node.expanded}
                    aria-label={`${t(node.expanded ? 'profileCollapseStack' : 'profileExpandStack')}: ${node.owner}`} tabIndex={node.expanded ? -1 : undefined}>
                    <span className="dshHarmonyStackGlyph" aria-hidden="true">{displayName(node.owner).charAt(0).toUpperCase()}</span>
                    <span className="dshHarmonyStackText"><span className="dshHarmonyName" title={node.owner}>{displayName(node.owner)}</span>
                      <span className="dshHarmonyStackMeta">{t('profilePatchStackMeta', { count: node.keys.length, start: node.start + 1, end: node.end })}</span></span>
                    <span className="dshHarmonyOrderState dshHarmonyStackState" style={{ background: stackHealthColor(node.keys) }}
                      title={stackHealthTitle(node.keys)} aria-label={stackHealthTitle(node.keys)} />
                  </button>
                </div>
                <div className="dshHarmonyStackPatches">{node.keys.map((key, depth) => renderPatch(key, node, depth))}</div>
              </div>
            })}
          </div>}

      {selectedPatch !== undefined ? <section className="dshHarmonyDetail" aria-live="polite">
        <div className="dshHarmonyIdentity"><div className="dshHarmonyMeta"><h3 className="dshHarmonyTitle">{selectedPatch.id}</h3>
          <Badge tone={cardStatus(selectedPatch.key) === 'error' ? 'danger' : cardStatus(selectedPatch.key) === 'warning' ? 'warning'
            : cardStatus(selectedPatch.key) === 'normal' ? 'success' : 'neutral'}>{t(cardStatus(selectedPatch.key) === 'error' ? 'profilePatchStatusError'
              : cardStatus(selectedPatch.key) === 'warning' ? 'profilePatchStatusWarning' : cardStatus(selectedPatch.key) === 'normal'
                ? 'profilePatchStatusNormal' : 'profilePatchStatusDisabled')}</Badge></div>
          <p className="dshHarmonyScope">{selectedPatch.key}</p></div>
        <p className="dshHarmonyDescription">{selectedPatch.kind}{selectedPatch.operation ? ` / ${selectedPatch.operation}` : selectedPatch.loader ? ` / ${selectedPatch.loader}` : ''}</p>
        <div className="dshHarmonyFacts"><span>{t('profilePatchProvider')}: {displayName(selectedPatch.owner)}</span>
          <span>{t('profilePatchTarget')}: {selectedPatch.targets.map(target => `${target.package}/${target.file}`).join(', ')}</span>
          <span>{t('profilePatchMatches')}: {selectedPatch.matches}</span><span>{t('profilePatchGeneration')}: {selectedPatch.generation}</span></div>
        <div className="dshHarmonyPatchActions">
          <Button size="small" onClick={() => onDisabledChange(setProfilePluginEnabled(disabled, selectedPatch.owner, !ownerEnabled))}>
            {t(ownerEnabled ? 'profileDisablePlugin' : 'profileEnablePlugin')}</Button>
          <Button size="small" disabled={!ownerEnabled} onClick={() => onDisabledChange(setProfilePatchEnabled(
            disabled, selectedPatch.owner, selectedPatch.key,
            !isProfilePatchEnabled(disabled, selectedPatch.owner, selectedPatch.key), ownerKeys,
          ))}>{t(isProfilePatchEnabled(disabled, selectedPatch.owner, selectedPatch.key) ? 'patchManagementDisablePatch' : 'patchManagementEnablePatch')}</Button>
        </div>
        {selectedPatch.error && <p className="dshHarmonyConstraint dshHarmonyError" role="alert">{selectedPatch.error}</p>}
      </section> : selectedPlugin === undefined ? <p className="dshHarmonyStatus">{t('profileProviderNoDescription')}</p>
        : <section className="dshHarmonyDetail" aria-live="polite">
          <div className="dshHarmonyPreview"><div className="dshHarmonyPreviewMark" aria-hidden="true">{displayName(selectedPlugin.name).charAt(0).toUpperCase()}</div>
            <span className="dshHarmonyPreviewLabel">{t('patchManagementPreview')}</span></div>
          <div className="dshHarmonyIdentity"><div className="dshHarmonyMeta"><h3 className="dshHarmonyTitle">{displayName(selectedPlugin.name)}</h3>
            {selectedPlugin.version && <span className="dshHarmonyVersion">v{selectedPlugin.version}</span>}</div></div>
          <p className="dshHarmonyDescription">{selectedPlugin.description || t('profileProviderNoDescription')}</p>
          <div className="dshHarmonyFacts"><span>{t('profilePatchCount', { count: ownerKeys.length })}</span>
            {selectedPlugin.license && <span>{selectedPlugin.license}</span>}</div>
          <Button size="small" onClick={() => onDisabledChange(setProfilePluginEnabled(disabled, selectedPlugin.name, !ownerEnabled))}>
            {t(ownerEnabled ? 'profileDisablePlugin' : 'profileEnablePlugin')}</Button>
        </section>}
    </div>

    {dragPreview !== null && <div className="dshHarmonyDragPreview" aria-hidden="true" style={{
      left: `${dragPreview.x - dragPreview.offsetX}px`, top: `${dragPreview.y - dragPreview.offsetY}px`, width: `${dragPreview.width}px`,
    }}>{dragPreview.kind === 'patch' ? <div className="dshHarmonyDragPatch" data-status={cardStatus(dragPreview.keys[0]!)}>
      <span className="dshHarmonyPatchGrip" /><span className="dshHarmonyDragTitle">{patchMap.get(dragPreview.keys[0]!)?.id ?? dragPreview.keys[0]}</span>
      <span className="dshHarmonyDragMeta">{displayName(dragPreview.owner)}</span></div>
      : <div className="dshHarmonyDragStack" style={{ height: `${dragPreview.height + stackGeometry(stackStatuses(dragPreview.keys)).height}px` }}>
        {dragPreview.keys.map((key, depth) => {
          const geometry = stackGeometry(stackStatuses(dragPreview.keys))
          const layer = stackLayer(stackStatuses(dragPreview.keys), depth)
          return <div className="dshHarmonyDragLayer" key={key} data-status={cardStatus(key)} style={{
            bottom: `${geometry.height - layer.bottom}px`, right: `${layer.right}px`, left: `${layer.left}px`, zIndex: dragPreview.keys.length - depth,
          }} />
        })}
        <div className="dshHarmonyDragCover" style={{ height: `${dragPreview.height}px`, background: stackCoverColor(dragPreview.keys) }}>
          <span className="dshHarmonyStackGlyph">{displayName(dragPreview.owner).charAt(0).toUpperCase()}</span>
          <span className="dshHarmonyDragTitle">{displayName(dragPreview.owner)}</span>
          <span className="dshHarmonyDragMeta">{t('profilePatchCount', { count: dragPreview.keys.length })}</span>
          <span className="dshHarmonyOrderState dshHarmonyStackState" style={{ background: stackHealthColor(dragPreview.keys) }} />
        </div>
      </div>}
    </div>}
    <footer className="dshHarmonyFooter"><p className="dshHarmonyHint">{t('profilePatchDragHint')}</p>
      <div className="dshHarmonyFooterActions"><Button size="small" disabled={saving || !dirty}
        onClick={onUndo}>{t('profileUndo')}</Button><Button size="small" variant="primary" loading={saving} loadingLabel={t('profileApplying')}
        disabled={saving || !dirty}
        onClick={onApply}>{t('profileApply')}</Button></div></footer>
  </div>
}
