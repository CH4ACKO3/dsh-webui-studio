import type {
  StudioVariableDefinition,
  StudioVariableValue,
} from 'dsh-harmony-react/studio'
import { createHash } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { basename, dirname, extname, join, posix } from 'node:path'
import ts from 'typescript'
import type { StudioElementSnapshot } from '../contracts.js'
import type { StudioElementStyleRule, StudioElementStyleSource } from '../contracts.js'
import { readProjectFile, writeProjectFile } from './project-files.js'
import { flattenVariableTree } from '../variable-tree.js'
import { compileElementStyleSelector } from '../bridge/element-style-selector.js'

interface Replacement {
  start: number
  end: number
  value: string
  id: string
}

interface SourceBackedVariable {
  definition: StudioVariableDefinition
  value: StudioVariableValue
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
  variables: readonly SourceBackedVariable[],
): Replacement[] {
  const replacements: Replacement[] = []
  for (const { definition, value } of variables) {
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
      value: serializeDefault(definition, value, current),
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

export async function saveElementsDefaults(
  root: string,
  elements: readonly StudioElementSnapshot[],
): Promise<{ files: string[] }> {
  const grouped = new Map<string, SourceBackedVariable[]>()
  for (const element of elements) {
    for (const definition of flattenVariableTree(element.element.variables ?? [])) {
      if (definition.defaultSource === undefined) continue
      const variable = { definition, value: element.values[definition.id]! }
      const list = grouped.get(definition.defaultSource.file)
      if (list === undefined) grouped.set(definition.defaultSource.file, [variable])
      else list.push(variable)
    }
  }
  if (grouped.size === 0) throw new Error('This Draft has no source-backed Element defaults')

  const updates: Array<{ file: string; original: string; content: string }> = []
  for (const [file, fileVariables] of grouped) {
    const source = await readProjectFile(root, file)
    const replacements = replacementsForFile(source, fileVariables)
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

const STYLE_HEADER = '/* dsh-webui-studio:element-styles '

function styleFile(sourceFile: string, owner: string, elementId: string): string {
  const extension = extname(sourceFile)
  const stem = basename(sourceFile, extension)
  const hash = createHash('sha256').update(`${owner}\0${elementId}`).digest('hex').slice(0, 10)
  return posix.join(dirname(sourceFile).split('\\').join('/'), `${stem}.dsh-studio-${hash}.css`)
}

function cssString(value: string): string {
  return JSON.stringify(value).replaceAll('</', '<\\/')
}

function validateRules(rules: readonly StudioElementStyleRule[]): void {
  const selectors = new Set<string>()
  for (const rule of rules) {
    compileElementStyleSelector(rule.selector, '[data-dsh-studio-root]')
    if (selectors.has(rule.selector)) throw new Error(`Element CSS selector ${JSON.stringify(rule.selector)} is duplicated`)
    selectors.add(rule.selector)
    const properties = new Set<string>()
    for (const declaration of rule.declarations) {
      if (!/^(?:--)?[a-zA-Z][a-zA-Z0-9-]*$/.test(declaration.property) || declaration.value.trim() === ''
        || /[{}]/.test(declaration.value)) {
        throw new Error(`Element CSS declaration ${JSON.stringify(declaration.property)} is invalid`)
      }
      if (properties.has(declaration.property)) throw new Error(`Element CSS property ${JSON.stringify(declaration.property)} is duplicated`)
      properties.add(declaration.property)
    }
  }
}

function serializedStyles(element: StudioElementSnapshot, rules: readonly StudioElementStyleRule[]): string {
  validateRules(rules)
  const metadata = Buffer.from(JSON.stringify(rules), 'utf8').toString('base64url')
  const boundary = element.element.boundary
  const root = `[data-ui-surface=${cssString(boundary.surfaceId)}][data-ui-surface-path=${cssString(JSON.stringify(boundary.path))}]`
  const blocks = rules.flatMap(rule => rule.declarations.length === 0 ? [] : [
    `${compileElementStyleSelector(rule.selector, root)} {\n${rule.declarations.map(item => `  ${item.property}: ${item.value};`).join('\n')}\n}`,
  ])
  return `${STYLE_HEADER}${metadata} */\n${blocks.join('\n\n')}${blocks.length === 0 ? '' : '\n'}`
}

function styleImport(sourceFile: string, generatedFile: string): string {
  let relative = posix.relative(posix.dirname(sourceFile), generatedFile)
  if (!relative.startsWith('.')) relative = `./${relative}`
  return `import ${JSON.stringify(relative)}`
}

function insertStyleImport(source: string, declaration: string, file: string): string {
  if (source.split(/\r?\n/).some(line => line.trim().replace(/;$/, '') === declaration)) return source
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  let offset = 0
  for (const statement of sourceFile.statements) {
    const directive = ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)
    if (!directive && !ts.isImportDeclaration(statement) && !ts.isImportEqualsDeclaration(statement)) break
    offset = statement.end
  }
  if (offset === 0) return `${declaration}\n${source}`
  return `${source.slice(0, offset)}\n${declaration}${source.slice(offset)}`
}

async function readOptionalProjectFile(root: string, file: string): Promise<string | undefined> {
  try {
    return await readProjectFile(root, file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export async function readElementsStyles(
  root: string,
  elements: readonly StudioElementSnapshot[],
): Promise<StudioElementStyleSource[]> {
  return Promise.all(elements.map(async element => {
    const file = styleFile(element.element.source.file, element.owner, element.element.id)
    const source = await readOptionalProjectFile(root, file)
    if (source === undefined || !source.startsWith(STYLE_HEADER)) return { elementId: element.element.id, rules: [] }
    const end = source.indexOf(' */', STYLE_HEADER.length)
    if (end === -1) throw new Error(`Element style metadata in ${file} is incomplete`)
    try {
      const parsed = JSON.parse(Buffer.from(source.slice(STYLE_HEADER.length, end), 'base64url').toString('utf8')) as StudioElementStyleRule[]
      validateRules(parsed)
      return { elementId: element.element.id, rules: parsed }
    } catch (error) {
      throw new Error(`Element style metadata in ${file} is invalid: ${error instanceof Error ? error.message : String(error)}`)
    }
  }))
}

export async function saveElementsSource(
  root: string,
  elements: readonly StudioElementSnapshot[],
  styles: readonly StudioElementStyleSource[],
): Promise<{ files: string[] }> {
  const styleByElement = new Map(styles.map(item => [item.elementId, item.rules]))
  if (styleByElement.size !== styles.length) throw new Error('Element style sources contain duplicate element ids')
  const known = new Set(elements.map(item => item.element.id))
  for (const id of styleByElement.keys()) if (!known.has(id)) throw new Error(`Element ${JSON.stringify(id)} is not registered by this Draft`)

  const updates = new Map<string, { original?: string; content: string }>()
  const defaultGroups = new Map<string, SourceBackedVariable[]>()
  for (const element of elements) {
    for (const definition of flattenVariableTree(element.element.variables ?? [])) {
      if (definition.defaultSource === undefined) continue
      const list = defaultGroups.get(definition.defaultSource.file) ?? []
      list.push({ definition, value: element.values[definition.id]! })
      defaultGroups.set(definition.defaultSource.file, list)
    }
  }
  for (const [file, variables] of defaultGroups) {
    const original = await readProjectFile(root, file)
    let content = original
    for (const replacement of [...replacementsForFile(original, variables)].reverse()) {
      content = `${content.slice(0, replacement.start)}${replacement.value}${content.slice(replacement.end)}`
    }
    updates.set(file, { original, content })
  }
  for (const element of elements) {
    const rules = styleByElement.get(element.element.id)
    if (rules === undefined) continue
    const generatedFile = styleFile(element.element.source.file, element.owner, element.element.id)
    const generatedOriginal = await readOptionalProjectFile(root, generatedFile)
    updates.set(generatedFile, { ...(generatedOriginal === undefined ? {} : { original: generatedOriginal }), content: serializedStyles(element, rules) })
    const sourceFile = element.element.source.file
    const existing = updates.get(sourceFile)
    const original = existing?.original ?? await readProjectFile(root, sourceFile)
    let content = existing?.content ?? original
    const declaration = styleImport(sourceFile, generatedFile)
    content = insertStyleImport(content, declaration, sourceFile)
    updates.set(sourceFile, { original, content })
  }
  if (updates.size === 0) throw new Error('This Draft has no source-backed Element changes')
  const written: Array<[string, { original?: string; content: string }]> = []
  try {
    for (const entry of updates) {
      await writeProjectFile(root, entry[0], entry[1].content)
      written.push(entry)
    }
  } catch (error) {
    const rollbackErrors: unknown[] = []
    for (const [file, update] of written.reverse()) {
      try {
        if (update.original === undefined) await unlink(join(root, file))
        else await writeProjectFile(root, file, update.original)
      } catch (rollbackError) { rollbackErrors.push(rollbackError) }
    }
    if (rollbackErrors.length > 0) throw new AggregateError([error, ...rollbackErrors], 'Element source save rollback failed')
    throw error
  }
  return { files: [...updates.keys()] }
}
