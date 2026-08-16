import { STUDIO_RUNTIME_KEY, type StudioBrowserRuntime } from 'dsh-harmony-react/studio'
import {
  getElementAtPoint,
  getElementBounds,
  getElementContext,
  isElementGrabbable,
  type ReactGrabElementContext,
} from 'react-grab/primitives'
import {
  STUDIO_PREVIEW_FRAGMENT,
  type StudioDomSelection,
  type StudioReactSnapshot,
  type StudioSurfaceBoundary,
} from '../contracts'
import { StudioPreviewRegistry, type StudioVariableTarget } from './registry'
import { patchTraces, type FiberSnapshot } from './provenance'

const MAX_TEXT = 2_000
const MAX_HTML = 16_000
const SENSITIVE_ATTRIBUTE = /(?:value|password|passwd|secret|token|auth|cookie|session|credential)/i

interface BridgeMessage {
  type?: unknown
  sessionId?: unknown
  nonce?: unknown
  mode?: unknown
  target?: unknown
  requestId?: unknown
}

declare global {
  interface Window {
    __DSH_STUDIO_PREVIEW__?: { parentOrigin: string; capability: string }
  }
}

const previewCapability = new URLSearchParams(location.hash.slice(1)).get(STUDIO_PREVIEW_FRAGMENT)
const previewConfig = window.__DSH_STUDIO_PREVIEW__
const previewEnabled = previewConfig !== undefined && previewCapability === previewConfig.capability
let port: MessagePort | undefined
let sessionId = ''
let nonce = ''

function post(message: Record<string, unknown>): void {
  port?.postMessage({ ...message, sessionId, nonce })
}

const registry = new StudioPreviewRegistry(() => {
  try {
    post({ type: 'registry', registry: registry.snapshot() })
  } catch (error) {
    post({ type: 'registry-error', error: error instanceof Error ? error.message : String(error) })
  }
})
const studioGlobal = globalThis as typeof globalThis & { [STUDIO_RUNTIME_KEY]?: StudioBrowserRuntime }
if (previewEnabled) studioGlobal[STUDIO_RUNTIME_KEY] = registry

function safeProps(props: Record<string, unknown> | undefined): Record<string, string | number | boolean | null> {
  const output: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(props ?? {}).slice(0, 40)) {
    if (SENSITIVE_ATTRIBUTE.test(key) || key === 'children') continue
    if (typeof value === 'string') output[key] = value.slice(0, 200)
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) output[key] = value
    else if (Array.isArray(value)) output[key] = `[array:${value.length}]`
    else output[key] = `[${typeof value}]`
  }
  return output
}

function reactSnapshot(context: ReactGrabElementContext): StudioReactSnapshot | undefined {
  const fiber = context.fiber as FiberSnapshot | null
  if (fiber === null && context.componentName === null && context.filePath === null) return undefined
  const owners = context.stack.flatMap(frame => typeof frame.functionName === 'string' && frame.functionName !== context.componentName
    ? [frame.functionName]
    : []).filter((name, index, all) => all.indexOf(name) === index)
  const source = context.filePath === null ? undefined : {
    file: context.filePath.slice(0, 1_000),
    ...(context.lineNumber === null ? {} : { line: context.lineNumber }),
    ...(context.columnNumber === null ? {} : { column: context.columnNumber }),
  }
  return {
    ...(context.componentName === null ? {} : { component: context.componentName }),
    owners: owners.slice(0, 20),
    props: safeProps(fiber?.memoizedProps),
    patches: patchTraces(fiber),
    ...(source === undefined ? {} : { source }),
  }
}

function formControl(element: Element): boolean {
  return element.matches('input, textarea, select')
}

function safeAttribute(name: string, value: string): string {
  const sanitized = /^(?:href|src|action|formaction|poster|cite)$/i.test(name) ? value.replace(/[?#].*$/, '') : value
  return sanitized.length > 500 ? `${sanitized.slice(0, 500)}…` : sanitized
}

function sanitizedHtml(element: Element): string {
  const clone = element.cloneNode(true) as Element
  const nodes = [clone, ...clone.querySelectorAll('*')]
  for (const node of nodes) {
    for (const attribute of [...node.attributes]) {
      if (SENSITIVE_ATTRIBUTE.test(attribute.name)) node.removeAttribute(attribute.name)
      else node.setAttribute(attribute.name, safeAttribute(attribute.name, attribute.value))
    }
    if (formControl(node)) {
      node.removeAttribute('value')
      node.textContent = ''
    }
  }
  return clone.outerHTML.slice(0, MAX_HTML)
}

function parentElement(element: Element): Element | undefined {
  if (element.assignedSlot !== null) return element.assignedSlot
  if (element.parentElement !== null) return element.parentElement
  const root = element.getRootNode()
  if (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE && 'host' in root) return (root as ShadowRoot).host
  try {
    return element.ownerDocument.defaultView?.frameElement ?? undefined
  } catch {
    return undefined
  }
}

function boundaryLineage(element: Element): StudioSurfaceBoundary[] {
  const boundaries: StudioSurfaceBoundary[] = []
  const visited = new Set<Element>()
  let current: Element | undefined = element
  while (current !== undefined && !visited.has(current)) {
    visited.add(current)
    const surfaceId = current.getAttribute('data-ui-surface')
    const encodedPath = current.getAttribute('data-ui-surface-path')
    if (surfaceId !== null && encodedPath !== null) {
      try {
        const path = JSON.parse(encodedPath) as unknown
        if (Array.isArray(path) && path.length > 0 && path.every(segment => typeof segment === 'string')) {
          boundaries.push({ surfaceId, path })
        }
      } catch {}
    }
    current = parentElement(current)
  }
  return boundaries
}

async function snapshot(element: Element): Promise<StudioDomSelection> {
  const attributes: Record<string, string> = {}
  for (const attribute of [...element.attributes]) {
    if (!SENSITIVE_ATTRIBUTE.test(attribute.name)) attributes[attribute.name] = safeAttribute(attribute.name, attribute.value)
  }
  const rect = getElementBounds(element)
  const computed = element.ownerDocument.defaultView?.getComputedStyle(element)
  let context: ReactGrabElementContext | undefined
  try {
    context = await getElementContext(element)
  } catch {}
  const react = context === undefined ? undefined : reactSnapshot(context)
  const selector = context?.selector == null || SENSITIVE_ATTRIBUTE.test(context.selector)
    ? undefined
    : context.selector.slice(0, 2_000)
  return {
    tag: element.tagName.toLowerCase(),
    ...(element.id === '' ? {} : { id: element.id }),
    classes: [...element.classList].slice(0, 30),
    attributes,
    text: formControl(element) ? '' : (element.textContent ?? '').trim().slice(0, MAX_TEXT),
    outerHTML: sanitizedHtml(element),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    style: {
      display: computed?.display ?? '',
      position: computed?.position ?? '',
      color: computed?.color ?? '',
      backgroundColor: computed?.backgroundColor ?? '',
      fontFamily: computed?.fontFamily ?? '',
      fontSize: computed?.fontSize ?? '',
    },
    boundaries: boundaryLineage(element),
    ...(selector === undefined ? {} : { selector }),
    ...(react === undefined ? {} : { react }),
    confidence: react === undefined ? 'dom-only' : react.source === undefined ? 'component-only' : 'mapped',
  }
}

let mode: 'browse' | 'inspect' = 'browse'
let candidate: Element | undefined
let overlay: HTMLDivElement | undefined
let shield: HTMLDivElement | undefined
let locked = false
let selectionRequest = 0
let panPointer: number | undefined
let panScreenX = 0
let panScreenY = 0

function showOverlay(element?: Element): void {
  candidate = element
  if (element === undefined) {
    overlay?.remove()
    overlay = undefined
    return
  }
  overlay ??= Object.assign(document.createElement('div'), { ariaHidden: 'true' })
  if (!overlay.isConnected) document.documentElement.append(overlay)
  const rect = getElementBounds(element)
  Object.assign(overlay.style, {
    position: 'fixed', pointerEvents: 'none', zIndex: '2147483647',
    left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    border: '2px solid #235be6', background: 'rgba(35,91,230,.08)', boxSizing: 'border-box',
  })
}

function pointer(event: PointerEvent): void {
  if (locked) return
  const eventTarget = event.target !== null && (event.target as Node).nodeType === Node.ELEMENT_NODE
    ? event.target as Element
    : undefined
  const element = eventTarget !== undefined && eventTarget.ownerDocument !== document
    ? (isElementGrabbable(eventTarget) ? eventTarget : null)
    : getElementAtPoint(event.clientX, event.clientY, {
        filter: candidate => candidate !== overlay && candidate !== shield && isElementGrabbable(candidate),
      })
  showOverlay(element ?? undefined)
}

async function click(event: MouseEvent): Promise<void> {
  event.preventDefault()
  event.stopImmediatePropagation()
  if (candidate === undefined) return
  locked = true
  const request = ++selectionRequest
  const selected = candidate
  try {
    const selection = await snapshot(selected)
    if (mode === 'inspect' && request === selectionRequest) post({ type: 'selection', selection })
  } catch (error) {
    if (mode === 'inspect' && request === selectionRequest) {
      post({ type: 'selection-error', error: error instanceof Error ? error.message : String(error) })
    }
  }
}

function pointerleave(): void {
  if (!locked) showOverlay()
}

function suppress(event: Event): void {
  event.preventDefault()
  event.stopImmediatePropagation()
}

function refreshOverlay(): void {
  if (candidate?.isConnected === true) showOverlay(candidate)
  else if (candidate !== undefined) unlockSelection()
}

function unlockSelection(): void {
  locked = false
  selectionRequest += 1
  showOverlay()
}

function beginPan(event: PointerEvent): void {
  if (event.button !== 1) return
  event.preventDefault()
  event.stopImmediatePropagation()
  panPointer = event.pointerId
  panScreenX = event.screenX
  panScreenY = event.screenY
  if (event.target instanceof Element) event.target.setPointerCapture(event.pointerId)
}

function movePan(event: PointerEvent): void {
  if (event.pointerId !== panPointer) return
  event.preventDefault()
  event.stopImmediatePropagation()
  const dx = event.screenX - panScreenX
  const dy = event.screenY - panScreenY
  panScreenX = event.screenX
  panScreenY = event.screenY
  if (dx !== 0 || dy !== 0) post({ type: 'preview-pan', dx, dy })
}

function endPan(event: PointerEvent): void {
  if (event.pointerId !== panPointer) return
  event.preventDefault()
  event.stopImmediatePropagation()
  panPointer = undefined
}

function suppressMiddleMouse(event: MouseEvent): void {
  if (event.button !== 1) return
  event.preventDefault()
  event.stopImmediatePropagation()
}

function keydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  setMode('browse')
  port?.postMessage({ type: 'mode', sessionId, nonce, mode })
}

function setMode(next: 'browse' | 'inspect'): void {
  if (mode === next) return
  unlockSelection()
  shield?.removeEventListener('pointermove', pointer)
  shield?.removeEventListener('pointerleave', pointerleave)
  shield?.removeEventListener('click', click)
  shield?.removeEventListener('wheel', suppress)
  shield?.removeEventListener('contextmenu', suppress)
  shield?.remove()
  shield = undefined
  document.removeEventListener('keydown', keydown, true)
  window.removeEventListener('resize', refreshOverlay)
  document.removeEventListener('scroll', refreshOverlay, true)
  mode = next
  if (mode === 'inspect') {
    shield = Object.assign(document.createElement('div'), { ariaHidden: 'true' })
    Object.assign(shield.style, {
      position: 'fixed', inset: '0', zIndex: '2147483646', cursor: 'crosshair', touchAction: 'none',
    })
    document.documentElement.append(shield)
    shield.addEventListener('pointermove', pointer)
    shield.addEventListener('pointerleave', pointerleave)
    shield.addEventListener('click', click)
    shield.addEventListener('wheel', suppress, { passive: false })
    shield.addEventListener('contextmenu', suppress)
    document.addEventListener('keydown', keydown, true)
    window.addEventListener('resize', refreshOverlay)
    document.addEventListener('scroll', refreshOverlay, true)
  }
}

window.addEventListener('message', event => {
  const message = event.data as BridgeMessage
  if (!previewEnabled || event.source !== parent || event.origin !== previewConfig?.parentOrigin
    || message.type !== 'dsh-studio-connect' || message.sessionId !== previewCapability
    || typeof message.nonce !== 'string' || event.ports.length !== 1) return
  port?.close()
  port = event.ports[0]
  sessionId = previewCapability
  nonce = message.nonce
  port.onmessage = portEvent => {
    const command = portEvent.data as BridgeMessage
    if (command.sessionId !== sessionId || command.nonce !== nonce) return
    if (command.type === 'set-mode' && (command.mode === 'browse' || command.mode === 'inspect')) setMode(command.mode)
    if (command.type === 'unlock-selection') unlockSelection()
    if (command.type === 'refresh-overlay') requestAnimationFrame(refreshOverlay)
    if (command.type === 'set-variable' && typeof command.requestId === 'string'
      && typeof command.target === 'object' && command.target !== null) {
      void registry.set(command.target as StudioVariableTarget).then(() => {
        post({ type: 'variable-result', requestId: command.requestId, ok: true })
      }).catch(error => {
        post({ type: 'variable-result', requestId: command.requestId, ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    }
  }
  port.start()
  const boot = (globalThis as typeof globalThis & { __DSH_BOOT__?: { rev?: unknown } }).__DSH_BOOT__
  port.postMessage({
    type: 'preview-ready', sessionId, nonce, mode,
    graphRev: typeof boot?.rev === 'string' ? boot.rev : undefined,
    react: 'react-grab',
  })
  post({ type: 'registry', registry: registry.snapshot() })
})

if (previewEnabled) {
  window.addEventListener('pointerdown', beginPan, true)
  window.addEventListener('pointermove', movePan, true)
  window.addEventListener('pointerup', endPan, true)
  window.addEventListener('pointercancel', endPan, true)
  window.addEventListener('mousedown', suppressMiddleMouse, true)
  window.addEventListener('auxclick', suppressMiddleMouse, true)
}

window.addEventListener('beforeunload', () => {
  setMode('browse')
  window.removeEventListener('pointerdown', beginPan, true)
  window.removeEventListener('pointermove', movePan, true)
  window.removeEventListener('pointerup', endPan, true)
  window.removeEventListener('pointercancel', endPan, true)
  window.removeEventListener('mousedown', suppressMiddleMouse, true)
  window.removeEventListener('auxclick', suppressMiddleMouse, true)
  port?.close()
  registry.dispose()
  if (studioGlobal[STUDIO_RUNTIME_KEY] === registry) delete studioGlobal[STUDIO_RUNTIME_KEY]
})
