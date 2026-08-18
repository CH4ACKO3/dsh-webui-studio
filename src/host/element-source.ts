import type {
  StudioElementSnapshot,
  StudioVariableDefinition,
  StudioVariableValue,
} from 'dsh-harmony-react/studio'
import { readProjectFile, writeProjectFile } from './project-files.js'

interface Replacement {
  start: number
  end: number
  value: string
  id: string
}

function count(source: string, needle: string): number {
  let matches = 0
  let offset = source.indexOf(needle)
  while (offset !== -1) {
    matches += 1
    offset = source.indexOf(needle, offset + needle.length)
  }
  return matches
}

function quoteString(value: string, current: string, id: string): string {
  const quote = current[0]
  if (quote !== "'" && quote !== '"') {
    throw new Error(`Element variable ${id} default is not a quoted string literal`)
  }
  const stringLiteral = quote === "'" ? /^'(?:\\.|[^'\\\r\n])*'$/ : /^"(?:\\.|[^"\\\r\n])*"$/
  if (!stringLiteral.test(current)) throw new Error(`Element variable ${id} default is not a complete string literal`)
  if (quote === '"') return JSON.stringify(value)
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
}

function serializeDefault(definition: StudioVariableDefinition, value: StudioVariableValue, current: string): string {
  const expression = current.trim()
  if (definition.control === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Element variable ${definition.id} must be a finite number`)
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(expression)) {
      throw new Error(`Element variable ${definition.id} default is not a number literal`)
    }
    return String(value)
  }
  if (definition.control === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`Element variable ${definition.id} must be boolean`)
    if (expression !== 'true' && expression !== 'false') {
      throw new Error(`Element variable ${definition.id} default is not a boolean literal`)
    }
    return String(value)
  }
  if (typeof value !== 'string') throw new Error(`Element variable ${definition.id} must be a string`)
  return quoteString(value, expression, definition.id)
}

function replacementsForFile(
  source: string,
  definitions: readonly StudioVariableDefinition[],
  values: Readonly<Record<string, StudioVariableValue>>,
): Replacement[] {
  const replacements: Replacement[] = []
  for (const definition of definitions) {
    const anchor = definition.defaultSource
    if (anchor === undefined) continue
    const start = source.indexOf(anchor.before)
    if (start === -1 || count(source, anchor.before) !== 1) {
      throw new Error(`Element variable ${definition.id} default source prefix is not unique`)
    }
    const valueStart = start + anchor.before.length
    const end = source.indexOf(anchor.after, valueStart)
    if (end === -1) throw new Error(`Element variable ${definition.id} default source suffix was not found`)
    const between = source.slice(valueStart, end)
    const leading = between.match(/^\s*/)?.[0].length ?? 0
    const trailing = between.match(/\s*$/)?.[0].length ?? 0
    const literalStart = valueStart + leading
    const literalEnd = end - trailing
    const current = source.slice(literalStart, literalEnd)
    if (current === '') throw new Error(`Element variable ${definition.id} default source value is empty`)
    replacements.push({
      start: literalStart,
      end: literalEnd,
      value: serializeDefault(definition, values[definition.id]!, current),
      id: definition.id,
    })
  }
  replacements.sort((left, right) => left.start - right.start)
  for (let index = 1; index < replacements.length; index += 1) {
    if (replacements[index - 1]!.end > replacements[index]!.start) {
      throw new Error(`Element variable default source anchors overlap (${replacements[index - 1]!.id}, ${replacements[index]!.id})`)
    }
  }
  return replacements
}

export async function saveElementDefaults(
  root: string,
  element: StudioElementSnapshot,
): Promise<{ files: string[] }> {
  const definitions = element.element.variables ?? []
  const grouped = new Map<string, StudioVariableDefinition[]>()
  for (const definition of definitions) {
    if (definition.defaultSource === undefined) continue
    const list = grouped.get(definition.defaultSource.file)
    if (list === undefined) grouped.set(definition.defaultSource.file, [definition])
    else list.push(definition)
  }
  if (grouped.size === 0) throw new Error('This Element has no source-backed defaults')

  const updates: Array<{ file: string; original: string; content: string }> = []
  for (const [file, fileDefinitions] of grouped) {
    const source = await readProjectFile(root, file)
    const replacements = replacementsForFile(source, fileDefinitions, element.values)
    let content = source
    for (const replacement of [...replacements].reverse()) {
      content = `${content.slice(0, replacement.start)}${replacement.value}${content.slice(replacement.end)}`
    }
    updates.push({ file, original: source, content })
  }
  const written: typeof updates = []
  try {
    for (const update of updates) {
      await writeProjectFile(root, update.file, update.content)
      written.push(update)
    }
  } catch (error) {
    const rollbackErrors: unknown[] = []
    for (const update of written.reverse()) {
      try {
        await writeProjectFile(root, update.file, update.original)
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    if (rollbackErrors.length > 0) throw new AggregateError([error, ...rollbackErrors], 'Element default save rollback failed')
    throw error
  }
  return { files: updates.map(update => update.file) }
}
