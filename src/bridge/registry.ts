import type {
  StudioBrowserRuntime,
  StudioElementRegistration,
  StudioElementSnapshot,
  StudioRegistrySnapshot,
  StudioVariableBinding,
  StudioVariableDefinition,
  StudioVariableNode,
  StudioVariablesRegistration,
  StudioVariablesSnapshot,
  StudioVariableValue,
} from 'dsh-harmony-react/studio'
import { flattenVariableTree } from '../variable-tree.js'

export type StudioVariableTarget =
  | { scope: 'element'; owner: string; elementId: string; variableId: string; value: StudioVariableValue }
  | { scope: 'global'; owner: string; variableId: string; value: StudioVariableValue }

interface RegistrationRecord<T> {
  registration: T
  subscriptions: Array<() => void>
}

function text(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} must not be empty`)
}

const CONTROLS = new Set(['color', 'length', 'number', 'boolean', 'enum', 'string'])
const MAX_VARIABLE_TREE_DEPTH = 8
const MAX_VARIABLE_TREE_NODES = 500

function sourceLocation(file: string, line?: number, column?: number): void {
  text(file, 'Studio element source file')
  if (file.startsWith('/') || file.startsWith('\\') || file.includes('\\')
    || file.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('Studio element source file must be a normalized Draft-relative POSIX path')
  }
  if (line !== undefined && (!Number.isInteger(line) || line < 1)) throw new Error('Studio source line must be a positive integer')
  if (column !== undefined && (!Number.isInteger(column) || column < 1)) throw new Error('Studio source column must be a positive integer')
}

function variableValue(definition: StudioVariableDefinition, value: StudioVariableValue): void {
  const validType = definition.control === 'number'
    ? typeof value === 'number' && Number.isFinite(value)
    : definition.control === 'boolean'
      ? typeof value === 'boolean'
      : typeof value === 'string'
  if (!validType) throw new Error(`Studio variable ${definition.id} has an invalid ${definition.control} value`)
  if (definition.control === 'color' && (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value))) {
    throw new Error(`Studio color variable ${definition.id} must use #RRGGBB`)
  }
  if (definition.control === 'enum' && (typeof value !== 'string' || !definition.options?.includes(value))) {
    throw new Error(`Studio variable ${definition.id} value is not one of its options`)
  }
  if (typeof value === 'number') {
    if (definition.constraints?.min !== undefined && value < definition.constraints.min) {
      throw new Error(`Studio variable ${definition.id} is below its minimum`)
    }
    if (definition.constraints?.max !== undefined && value > definition.constraints.max) {
      throw new Error(`Studio variable ${definition.id} is above its maximum`)
    }
  }
}

function variables(
  nodes: readonly StudioVariableNode[],
  bindings: Readonly<Record<string, StudioVariableBinding>>,
): void {
  const ids = new Set<string>()
  const variableIds = new Set<string>()
  let nodeCount = 0
  const definitions: StudioVariableDefinition[] = []
  const visit = (items: readonly StudioVariableNode[], depth: number): void => {
    if (depth > MAX_VARIABLE_TREE_DEPTH) throw new Error('Studio variable tree exceeds its maximum depth')
    for (const item of items) {
      nodeCount += 1
      if (nodeCount > MAX_VARIABLE_TREE_NODES) throw new Error('Studio variable tree has too many nodes')
      text(item.id, 'Studio variable node id')
      text(item.label, 'Studio variable node label')
      if (ids.has(item.id)) throw new Error(`Duplicate Studio variable node id ${item.id}`)
      ids.add(item.id)
      if (item.kind === 'group') {
        if (item.children.length === 0) throw new Error(`Studio variable group ${item.id} must not be empty`)
        visit(item.children, depth + 1)
      } else if (item.kind === 'variable') {
        definitions.push(item)
        variableIds.add(item.id)
      } else {
        throw new Error('Studio variable node has an invalid kind')
      }
    }
  }
  visit(nodes, 1)
  for (const definition of definitions) {
    if (!CONTROLS.has(definition.control)) throw new Error(`Studio variable ${definition.id} has an invalid control`)
    const binding = bindings[definition.id]
    if (binding === undefined) throw new Error(`Studio variable ${definition.id} has no binding`)
    if (definition.control === 'enum' && (definition.options === undefined || definition.options.length === 0)) {
      throw new Error(`Studio enum variable ${definition.id} has no options`)
    }
    if (definition.options !== undefined && new Set(definition.options).size !== definition.options.length) {
      throw new Error(`Studio variable ${definition.id} has duplicate options`)
    }
    if (definition.defaultSource !== undefined) {
      sourceLocation(definition.defaultSource.file)
      text(definition.defaultSource.before, `Studio variable ${definition.id} default source prefix`)
      text(definition.defaultSource.after, `Studio variable ${definition.id} default source suffix`)
    }
    const constraints = definition.constraints
    if (constraints !== undefined) {
      for (const value of [constraints.min, constraints.max, constraints.step]) {
        if (value !== undefined && !Number.isFinite(value)) throw new Error(`Studio variable ${definition.id} has invalid constraints`)
      }
      if (constraints.min !== undefined && constraints.max !== undefined && constraints.min > constraints.max) {
        throw new Error(`Studio variable ${definition.id} minimum exceeds its maximum`)
      }
      if (constraints.step !== undefined && constraints.step <= 0) throw new Error(`Studio variable ${definition.id} step must be positive`)
    }
    variableValue(definition, binding.get())
  }
  for (const id of Object.keys(bindings)) {
    if (!variableIds.has(id)) throw new Error(`Studio variable binding ${id} has no definition`)
  }
}

function values(
  nodes: readonly StudioVariableNode[],
  bindings: Readonly<Record<string, StudioVariableBinding>>,
): Record<string, StudioVariableValue> {
  const definitions = flattenVariableTree(nodes)
  return Object.fromEntries(definitions.map(definition => {
    const value = bindings[definition.id]!.get()
    variableValue(definition, value)
    return [definition.id, value]
  }))
}

function subscribe(
  bindings: Readonly<Record<string, StudioVariableBinding>>,
  listener: () => void,
): Array<() => void> {
  const subscriptions: Array<() => void> = []
  try {
    for (const binding of Object.values(bindings)) {
      if (binding.subscribe === undefined) continue
      const stop = binding.subscribe(listener)
      if (typeof stop !== 'function') throw new Error('Studio variable subscribe must return a disposer')
      subscriptions.push(stop)
    }
    return subscriptions
  } catch (error) {
    for (const stop of subscriptions.reverse()) stop()
    throw error
  }
}

export class StudioPreviewRegistry implements StudioBrowserRuntime {
  readonly #elements = new Map<string, RegistrationRecord<StudioElementRegistration>>()
  readonly #boundaries = new Map<string, string>()
  readonly #globals = new Map<string, RegistrationRecord<StudioVariablesRegistration>>()
  readonly #sets = new Map<string, Promise<void>>()

  constructor(private readonly changed: () => void) {}

  registerElement(input: StudioElementRegistration): () => void {
    text(input.owner, 'Studio element owner')
    text(input.element.id, 'Studio element id')
    text(input.element.label, 'Studio element label')
    text(input.element.boundary.surfaceId, 'Studio surface id')
    sourceLocation(input.element.source.file, input.element.source.line, input.element.source.column)
    if (input.element.boundary.path.length === 0) throw new Error('Studio surface path must not be empty')
    for (const segment of input.element.boundary.path) text(segment, 'Studio surface path segment')
    variables(input.element.variables ?? [], input.bindings)
    const key = `${input.owner}\0${input.element.id}`
    if (this.#elements.has(key)) throw new Error(`Studio element already registered: ${input.owner}/${input.element.id}`)
    const boundaryKey = `${input.element.boundary.surfaceId}\0${JSON.stringify(input.element.boundary.path)}`
    const boundaryOwner = this.#boundaries.get(boundaryKey)
    if (boundaryOwner !== undefined) throw new Error(`Studio boundary already registered by ${boundaryOwner}`)
    const registration = structuredClone({ owner: input.owner, element: input.element }) as Omit<StudioElementRegistration, 'bindings'>
    const record: RegistrationRecord<StudioElementRegistration> = {
      registration: { ...registration, bindings: input.bindings },
      subscriptions: subscribe(input.bindings, this.changed),
    }
    this.#elements.set(key, record)
    this.#boundaries.set(boundaryKey, `${input.owner}/${input.element.id}`)
    this.changed()
    return () => {
      if (this.#elements.get(key) !== record) return
      this.#elements.delete(key)
      this.#boundaries.delete(boundaryKey)
      for (const stop of record.subscriptions) stop()
      this.changed()
    }
  }

  registerVariables(input: StudioVariablesRegistration): () => void {
    text(input.owner, 'Studio variable owner')
    variables(input.variables, input.bindings)
    if (this.#globals.has(input.owner)) throw new Error(`Studio variables already registered: ${input.owner}`)
    const registration = structuredClone({ owner: input.owner, variables: input.variables }) as Omit<StudioVariablesRegistration, 'bindings'>
    const record: RegistrationRecord<StudioVariablesRegistration> = {
      registration: { ...registration, bindings: input.bindings },
      subscriptions: subscribe(input.bindings, this.changed),
    }
    this.#globals.set(input.owner, record)
    this.changed()
    return () => {
      if (this.#globals.get(input.owner) !== record) return
      this.#globals.delete(input.owner)
      for (const stop of record.subscriptions) stop()
      this.changed()
    }
  }

  snapshot(): StudioRegistrySnapshot {
    const elements: StudioElementSnapshot[] = [...this.#elements.values()].map(({ registration }) => ({
      owner: registration.owner,
      element: registration.element,
      values: values(registration.element.variables ?? [], registration.bindings),
    }))
    const globals: StudioVariablesSnapshot[] = [...this.#globals.values()].map(({ registration }) => ({
      owner: registration.owner,
      variables: registration.variables,
      values: values(registration.variables, registration.bindings),
    }))
    return { elements, variables: globals }
  }

  async set(target: StudioVariableTarget): Promise<void> {
    const record = target.scope === 'element'
      ? this.#elements.get(`${target.owner}\0${target.elementId}`)
      : this.#globals.get(target.owner)
    if (record === undefined) throw new Error('Studio variable registration is no longer active')
    const key = target.scope === 'element'
      ? `element\0${target.owner}\0${target.elementId}\0${target.variableId}`
      : `global\0${target.owner}\0${target.variableId}`
    const previous = this.#sets.get(key) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(() => this.#applySet(target, record))
    this.#sets.set(key, next)
    try {
      await next
    } finally {
      if (this.#sets.get(key) === next) this.#sets.delete(key)
    }
  }

  async #applySet(
    target: StudioVariableTarget,
    record: RegistrationRecord<StudioElementRegistration> | RegistrationRecord<StudioVariablesRegistration>,
  ): Promise<void> {
    const current = target.scope === 'element'
      ? this.#elements.get(`${target.owner}\0${target.elementId}`)
      : this.#globals.get(target.owner)
    if (current !== record) throw new Error('Studio variable registration is no longer active')
    const nodes = target.scope === 'element'
      ? (record.registration as StudioElementRegistration).element.variables ?? []
      : (record.registration as StudioVariablesRegistration).variables
    const bindings = record.registration.bindings
    const definition = flattenVariableTree(nodes).find(item => item.id === target.variableId)
    if (definition === undefined) throw new Error(`Unknown Studio variable ${target.variableId}`)
    variableValue(definition, target.value)
    await bindings[target.variableId]!.set(target.value)
    variableValue(definition, bindings[target.variableId]!.get())
    this.changed()
  }

  dispose(): void {
    for (const record of [...this.#elements.values(), ...this.#globals.values()]) {
      for (const stop of record.subscriptions) stop()
    }
    this.#elements.clear()
    this.#boundaries.clear()
    this.#globals.clear()
  }
}
