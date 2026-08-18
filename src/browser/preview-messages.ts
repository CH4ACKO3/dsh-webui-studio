import type {
  StudioVariableDefinition,
  StudioVariableNode,
  StudioVariableValue,
} from 'dsh-harmony-react/studio'
import type {
  StudioDomSelection,
  StudioPatchTrace,
  StudioRegistrySnapshot,
  StudioSourceCandidate,
  StudioSourceLocation,
} from '../contracts'

const MAX_COLLECTION = 500
const MAX_NESTED_COLLECTION = 100
const MAX_STRING = 16_000
const MAX_VARIABLE_TREE_DEPTH = 8

type UnknownRecord = Record<string, unknown>

function record(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function string(value: unknown, max = MAX_STRING): value is string {
  return typeof value === 'string' && value.length <= max
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0
}

function stringArray(value: unknown, max = MAX_NESTED_COLLECTION): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every(item => string(item, 2_000))
}

function stringRecord(value: unknown, max = MAX_NESTED_COLLECTION): value is Record<string, string> {
  return record(value) && Object.keys(value).length <= max
    && Object.entries(value).every(([key, item]) => string(key, 500) && string(item, 2_000))
}

function sourceLocation(value: unknown): value is StudioSourceLocation {
  return record(value) && string(value.file, 2_000) && value.file !== ''
    && (value.line === undefined || positiveInteger(value.line))
    && (value.column === undefined || positiveInteger(value.column))
}

function sourceCandidate(value: unknown): value is StudioSourceCandidate {
  if (!record(value) || !sourceLocation(value)) return false
  const candidate = value as UnknownRecord
  return (candidate.package === undefined || string(candidate.package, 500))
    && ['draft', 'dependency', 'generated', 'unknown'].includes(candidate.kind as string)
    && (candidate.confidence === 'exact' || candidate.confidence === 'candidate')
}

function patchTrace(value: unknown): value is StudioPatchTrace {
  if (!record(value) || !record(value.target)) return false
  return string(value.key, 1_000) && string(value.owner, 1_000) && string(value.declaration)
    && [
      'replace-element',
      'wrap-element',
      'insert-before',
      'insert-after',
      'transform-props',
      'decorate-component',
      'replace-component',
    ].includes(value.effect as string)
    && string(value.target.package, 500) && string(value.target.file, 2_000)
    && value.confidence === 'candidate'
}

function domSelection(value: unknown): value is StudioDomSelection {
  if (!record(value) || !record(value.rect) || !record(value.style)) return false
  const react = value.react
  return string(value.tag, 100) && value.tag !== ''
    && (value.id === undefined || string(value.id, 1_000))
    && stringArray(value.classes)
    && stringRecord(value.attributes)
    && string(value.text, 2_000) && string(value.outerHTML)
    && finite(value.rect.x) && finite(value.rect.y) && finite(value.rect.width) && finite(value.rect.height)
    && stringRecord(value.style)
    && (value.selector === undefined || string(value.selector, 2_000))
    && Array.isArray(value.boundaries) && value.boundaries.length <= MAX_NESTED_COLLECTION
    && value.boundaries.every(boundary => record(boundary) && string(boundary.surfaceId, 1_000)
      && stringArray(boundary.path))
    && ['mapped', 'component-only', 'dom-only'].includes(value.confidence as string)
    && (react === undefined || (record(react)
      && (react.component === undefined || string(react.component, 1_000))
      && stringArray(react.owners)
      && record(react.props) && Object.keys(react.props).length <= 40
      && Object.entries(react.props).every(([key, item]) => string(key, 500)
        && (item === null || typeof item === 'boolean' || finite(item) || string(item, 500)))
      && (react.source === undefined || (record(react.source) && sourceLocation(react.source)
        && (react.source.resolved === undefined || sourceCandidate(react.source.resolved))))
      && Array.isArray(react.patches) && react.patches.length <= MAX_NESTED_COLLECTION
      && react.patches.every(patchTrace)))
}

const controls = new Set(['color', 'length', 'number', 'boolean', 'enum', 'string'])

function variableDefinition(value: unknown): value is StudioVariableDefinition {
  if (!record(value) || value.kind !== 'variable' || !string(value.id, 500) || value.id === '' || !string(value.label, 1_000)
    || !controls.has(value.control as string)) return false
  if (value.options !== undefined && !stringArray(value.options)) return false
  if (value.defaultSource !== undefined) {
    if (!record(value.defaultSource) || !sourceLocation(value.defaultSource)
      || !string(value.defaultSource.before, 4_000) || value.defaultSource.before === ''
      || !string(value.defaultSource.after, 4_000) || value.defaultSource.after === '') return false
  }
  if (value.constraints === undefined) return true
  if (!record(value.constraints)) return false
  const constraints = value.constraints as UnknownRecord
  return ['min', 'max', 'step'].every(key => {
    const constraint = constraints[key]
    return constraint === undefined || finite(constraint)
  })
}

function variableTree(value: unknown): value is readonly StudioVariableNode[] {
  if (!Array.isArray(value) || value.length > MAX_NESTED_COLLECTION) return false
  const state = { nodes: 0 }
  const visit = (items: unknown[], depth: number): boolean => {
    if (depth > MAX_VARIABLE_TREE_DEPTH) return false
    return items.every(item => {
      state.nodes += 1
      if (state.nodes > MAX_COLLECTION || !record(item)) return false
      if (item.kind === 'variable') return variableDefinition(item)
      return item.kind === 'group' && string(item.id, 500) && item.id !== ''
        && string(item.label, 1_000) && item.label !== ''
        && Array.isArray(item.children) && item.children.length > 0
        && item.children.length <= MAX_NESTED_COLLECTION && visit(item.children, depth + 1)
    })
  }
  return visit(value, 1)
}

function variableValues(value: unknown): value is Readonly<Record<string, StudioVariableValue>> {
  return record(value) && Object.keys(value).length <= MAX_COLLECTION
    && Object.entries(value).every(([key, item]) => string(key, 500)
      && (typeof item === 'boolean' || finite(item) || string(item, 2_000)))
}

export function isStudioRegistrySnapshot(value: unknown): value is StudioRegistrySnapshot {
  if (!record(value) || !Array.isArray(value.elements) || value.elements.length > MAX_COLLECTION
    || !Array.isArray(value.variables) || value.variables.length > MAX_COLLECTION) return false
  return value.elements.every(item => record(item) && string(item.owner, 1_000) && record(item.element)
      && string(item.element.id, 500) && string(item.element.label, 1_000)
      && record(item.element.boundary) && string(item.element.boundary.surfaceId, 1_000)
      && stringArray(item.element.boundary.path)
      && sourceLocation(item.element.source)
      && (item.element.variables === undefined || variableTree(item.element.variables))
      && variableValues(item.values))
    && value.variables.every(item => record(item) && string(item.owner, 1_000)
      && variableTree(item.variables) && variableValues(item.values))
}

export function isStudioDomSelection(value: unknown): value is StudioDomSelection {
  return domSelection(value)
}

export function isFinitePreviewPan(value: UnknownRecord): value is UnknownRecord & { dx: number; dy: number } {
  return finite(value.dx) && finite(value.dy) && Math.abs(value.dx) <= 100_000 && Math.abs(value.dy) <= 100_000
}

export function isFinitePreviewZoom(value: UnknownRecord): value is UnknownRecord & { deltaY: number; deltaMode: number } {
  return finite(value.deltaY) && Math.abs(value.deltaY) <= 100_000
    && Number.isInteger(value.deltaMode) && (value.deltaMode as number) >= 0 && (value.deltaMode as number) <= 2
}

export function boundedBridgeText(value: unknown): value is string {
  return string(value, 2_000)
}

export function isBridgeEnvelope(value: unknown, sessionId: string, nonce: string): value is UnknownRecord {
  return record(value) && value.sessionId === sessionId && value.nonce === nonce && string(value.type, 100)
}

export function isBridgeOffer(value: unknown, sessionId: string): boolean {
  return record(value) && value.type === 'dsh-studio-bridge' && value.sessionId === sessionId
}
