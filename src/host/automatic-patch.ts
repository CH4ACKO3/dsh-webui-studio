import { createHash } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { basename, dirname, extname, join, posix } from 'node:path'
import ts from 'typescript'
import type {
  StudioAutomaticCssVariable,
  StudioAutomaticPatchMatch,
  StudioAutomaticPatchPlan,
  StudioAutomaticPatchRequest,
  StudioAutomaticPatchTargetAnalysis,
  StudioAutomaticPatchWriteResult,
} from '../contracts.js'
import { readProjectFile, writeProjectFile } from './project-files.js'
import { compileElementStyleSelector } from '../bridge/element-style-selector.js'

export interface AutomaticPatchSource {
  package: string
  file: string
  version: string
  source: string
}

function digest(value: unknown, length = 12): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, length)
}

function identifier(value: string): string {
  const result = value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  return result === '' ? 'target' : result.slice(0, 32)
}

function excerpt(source: string, start: number, end: number): string {
  const lineStart = source.lastIndexOf('\n', start - 1) + 1
  const nextLine = source.indexOf('\n', end)
  const lineEnd = nextLine === -1 ? source.length : nextLine
  const value = source.slice(lineStart, lineEnd).trim()
  return value.length <= 240 ? value : `${value.slice(0, 237)}...`
}

function match(sourceFile: ts.SourceFile, source: string, node: ts.Node, applicable: boolean, reason?: string): StudioAutomaticPatchMatch {
  const start = node.getStart(sourceFile)
  const location = sourceFile.getLineAndCharacterOfPosition(start)
  return {
    line: location.line + 1,
    column: location.character + 1,
    excerpt: excerpt(source, start, node.getEnd()),
    applicable,
    ...(reason === undefined ? {} : { reason }),
  }
}

function cssVariable(value: unknown): value is StudioAutomaticCssVariable {
  if (typeof value !== 'object' || value === null) return false
  const variable = value as Partial<StudioAutomaticCssVariable>
  return typeof variable.id === 'string' && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(variable.id)
    && typeof variable.label === 'string' && variable.label !== ''
    && typeof variable.property === 'string' && /^(?:--)?[a-zA-Z][a-zA-Z0-9-]*$/.test(variable.property)
    && ['color', 'length', 'number', 'enum', 'string'].includes(variable.control ?? '')
    && (typeof variable.value === 'string' || (typeof variable.value === 'number' && Number.isFinite(variable.value)))
    && (variable.options === undefined || (Array.isArray(variable.options) && variable.options.length > 0 && variable.options.every(item => typeof item === 'string')))
    && (variable.constraints === undefined || Object.values(variable.constraints).every(item => typeof item === 'number' && Number.isFinite(item)))
}

function validateCssRequest(request: Extract<StudioAutomaticPatchRequest, { kind: 'css-style' }>): void {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(request.component)) throw new Error('automatic CSS Patch component name is invalid')
  if (!/\.(?:[cm]?[jt]sx?)$/.test(request.clientFile)) throw new Error('automatic CSS Patch client source must be a JavaScript or TypeScript file')
  compileElementStyleSelector(request.selector, '[data-dsh-studio-root]')
  if (request.boundary.surfaceId === '' || request.boundary.path.length === 0 || request.boundary.path.some(item => item === '')) {
    throw new Error('automatic CSS Patch boundary is invalid')
  }
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(request.elementId)) throw new Error('automatic CSS Patch element id is invalid')
  if (request.elementLabel.trim() === '') throw new Error('automatic CSS Patch element label must not be empty')
  if (request.variables.length === 0) throw new Error('automatic CSS Patch requires at least one variable')
  const ids = new Set<string>()
  const properties = new Set<string>()
  for (const variable of request.variables) {
    if (!cssVariable(variable as unknown)) throw new Error(`automatic CSS Patch variable ${JSON.stringify(variable.id)} is invalid`)
    if (ids.has(variable.id)) throw new Error(`automatic CSS Patch variable ${JSON.stringify(variable.id)} is duplicated`)
    if (properties.has(variable.property)) throw new Error(`automatic CSS Patch property ${JSON.stringify(variable.property)} is duplicated`)
    ids.add(variable.id)
    properties.add(variable.property)
  }
}

function analyzeTarget(
  request: StudioAutomaticPatchRequest,
  target: AutomaticPatchSource,
): StudioAutomaticPatchTargetAnalysis {
  const sourceFile = ts.createSourceFile(target.file, target.source, ts.ScriptTarget.Latest, true)
  let matches: StudioAutomaticPatchMatch[]
  if (request.kind === 'replace-string') {
    matches = []
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteral(node) && node.text === request.text) matches.push(match(sourceFile, target.source, node, true))
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  } else {
    matches = []
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === request.component) {
        matches.push(match(sourceFile, target.source, node, node.initializer !== undefined,
          node.initializer === undefined ? 'component variable declaration has no initializer' : undefined))
      } else if (ts.isFunctionDeclaration(node) && node.name?.text === request.component) {
        matches.push(match(sourceFile, target.source, node, node.body !== undefined,
          node.body === undefined ? 'component function declaration has no body' : undefined))
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return { package: target.package, file: target.file, version: target.version, matches }
}

function patchId(request: StudioAutomaticPatchRequest, target: StudioAutomaticPatchTargetAnalysis): string {
  return `auto-${request.kind === 'css-style' ? 'css' : 'replace'}-${identifier(target.package)}-${digest({ request, target: { package: target.package, file: target.file, version: target.version } })}`
}

function stringPatch(request: Extract<StudioAutomaticPatchRequest, { kind: 'replace-string' }>, target: StudioAutomaticPatchTargetAnalysis, id: string): string {
  return `  {
    id: ${JSON.stringify(id)},
    target: { package: ${JSON.stringify(target.package)}, version: ${JSON.stringify(target.version)}, files: [${JSON.stringify(target.file)}] },
    select: ${JSON.stringify(`StringLiteral[text=${JSON.stringify(request.text)}]`)},
    expect: ${target.matches.length},
    apply({ node, sourceFile, edit }) {
      edit.overwrite(node.getStart(sourceFile), node.getEnd(), ${JSON.stringify(request.replacement)})
    },
  }`
}

function cssPatch(
  request: Extract<StudioAutomaticPatchRequest, { kind: 'css-style' }>,
  target: StudioAutomaticPatchTargetAnalysis,
  id: string,
  owner: string,
): string {
  return `  component({
    id: ${JSON.stringify(id)},
    target: { package: ${JSON.stringify(target.package)}, version: ${JSON.stringify(target.version)}, files: [${JSON.stringify(target.file)}] },
    select: { name: ${JSON.stringify(request.component)} },
    expect: ${target.matches.length},
    operation: { kind: 'decorate', with: { module: ${JSON.stringify(owner)}, export: AUTO_EXPORT } },
  })`
}

function clientSource(request: Extract<StudioAutomaticPatchRequest, { kind: 'css-style' }>, owner: string, id: string, file: string, exportName: string): string {
  const definitions = request.variables.map(variable => `{
      kind: 'variable', id: ${JSON.stringify(variable.id)}, label: ${JSON.stringify(variable.label)}, control: ${JSON.stringify(variable.control)},
      ${variable.options === undefined ? '' : `options: ${JSON.stringify(variable.options)},`}
      ${variable.constraints === undefined ? '' : `constraints: ${JSON.stringify(variable.constraints)},`}
      defaultSource: { file: ${JSON.stringify(file)}, before: ${JSON.stringify(`  ${JSON.stringify(variable.id)}: /* dsh-studio-default:${id}:${variable.id} */ `)}, after: ${JSON.stringify(',\n')} },
    }`).join(',\n')
  const defaults = request.variables.map(variable => `  ${JSON.stringify(variable.id)}: /* dsh-studio-default:${id}:${variable.id} */ ${JSON.stringify(variable.value)},`).join('\n')
  const properties = JSON.stringify(request.variables.map(item => ({ id: item.id, property: item.property })))
  const root = `[data-ui-surface=${JSON.stringify(request.boundary.surfaceId)}][data-ui-surface-path=${JSON.stringify(JSON.stringify(request.boundary.path))}]`
  const selector = compileElementStyleSelector(request.selector, root)
  return `import * as React from 'react'
import { registerStudioElement } from 'dsh-harmony-react/studio'

const values = {
${defaults}
}
const declarations = ${properties}
let mounts = 0
let disposeRegistration
let styleElement

function applyStyles() {
  if (typeof document === 'undefined') return
  if (styleElement === undefined) {
    styleElement = document.createElement('style')
    styleElement.dataset.plugin = ${JSON.stringify(owner)}
    document.head.append(styleElement)
  }
  styleElement.textContent = ''
  const sheet = styleElement.sheet
  if (sheet === null) return
  const index = sheet.insertRule(${JSON.stringify(`${selector} {}`)}, 0)
  const rule = sheet.cssRules[index]
  if (!(rule instanceof CSSStyleRule)) return
  for (const declaration of declarations) rule.style.setProperty(declaration.property, String(values[declaration.id]))
}

const bindings = Object.fromEntries(declarations.map(declaration => [declaration.id, {
  get: () => values[declaration.id],
  set: value => { values[declaration.id] = value; applyStyles() },
}]))

function acquire() {
  mounts += 1
  if (mounts === 1) {
    disposeRegistration = registerStudioElement({
      owner: ${JSON.stringify(owner)},
      element: {
        id: ${JSON.stringify(request.elementId)}, label: ${JSON.stringify(request.elementLabel)},
        boundary: ${JSON.stringify(request.boundary)}, source: { file: ${JSON.stringify(file)} },
        variables: [{ kind: 'group', id: 'css', label: 'CSS', children: [
${definitions}
        ] }],
      },
      bindings,
    })
    applyStyles()
  }
  return () => {
    mounts -= 1
    if (mounts !== 0) return
    disposeRegistration?.()
    disposeRegistration = undefined
    styleElement?.remove()
    styleElement = undefined
  }
}

export function ${exportName}(Original) {
  function StudioDecoratedComponent(props) {
    React.useEffect(acquire, [])
    return React.createElement(Original, props)
  }
  StudioDecoratedComponent.displayName = \`Studio(${request.component})\`
  return StudioDecoratedComponent
}
`
}

function providerSource(request: StudioAutomaticPatchRequest, targets: StudioAutomaticPatchTargetAnalysis[], owner: string): { source: string; patchIds: string[] } {
  const applicable = targets.filter(target => target.matches.length > 0 && target.matches.every(item => item.applicable))
  const patchIds = applicable.map(target => patchId(request, target))
  const declarations = applicable.map((target, index) => request.kind === 'replace-string'
    ? stringPatch(request, target, patchIds[index]!)
    : cssPatch(request, target, patchIds[index]!, owner)).join(',\n')
  const prefix = request.kind === 'css-style'
    ? `'use strict'\n\nconst { component } = require('dsh-harmony-react')\nconst AUTO_EXPORT = ${JSON.stringify(`DshStudioAuto${digest(request, 10)}`)}\n\n`
    : `'use strict'\n\n`
  return { patchIds, source: `${prefix}module.exports = [\n${declarations}\n]\n` }
}

export function analyzeAutomaticPatch(
  request: StudioAutomaticPatchRequest,
  sources: AutomaticPatchSource[],
  owner: string,
): StudioAutomaticPatchPlan {
  if (request.kind === 'replace-string' && request.text === '') throw new Error('automatic string Patch text must not be empty')
  if (request.targets.length === 0) throw new Error('automatic Patch requires at least one target')
  if (request.targets.length !== sources.length) throw new Error('automatic Patch target sources are incomplete')
  if (request.kind === 'css-style') validateCssRequest(request)
  const identities = request.targets.map(target => `${target.package}\0${target.file}`)
  if (new Set(identities).size !== identities.length) throw new Error('automatic Patch targets must be unique')
  for (let index = 0; index < sources.length; index += 1) {
    const target = request.targets[index]!
    const source = sources[index]!
    if (source.package !== target.package || source.file !== target.file) throw new Error('automatic Patch source does not match its requested target')
  }
  const targets = sources.map(source => analyzeTarget(request, source))
  const file = `patch.auto-${digest({ request, owner, versions: targets.map(target => target.version) })}.cjs`
  const generated = providerSource(request, targets, owner)
  if (request.kind === 'replace-string') {
    return { request, targets, canApply: generated.patchIds.length > 0, provider: { file, source: generated.source, patchIds: generated.patchIds } }
  }
  const extension = extname(request.clientFile)
  const stem = basename(request.clientFile, extension)
  const suffix = digest({ request, owner }, 10)
  const generatedFile = posix.join(dirname(request.clientFile).split('\\').join('/'), `${stem}.dsh-studio-auto-${suffix}.js`)
  const exportName = `DshStudioAuto${digest(request, 10)}`
  return {
    request,
    targets,
    canApply: generated.patchIds.length > 0,
    provider: { file, source: generated.source, patchIds: generated.patchIds },
    client: {
      file: generatedFile,
      source: clientSource(request, owner, `auto-css-${suffix}`, generatedFile, exportName),
      export: exportName,
      entryFile: request.clientFile,
    },
  }
}

interface DraftManifest {
  dependencies?: Record<string, string>
  dsh?: { client?: Record<string, unknown>; harmony?: { patches?: unknown }; [key: string]: unknown }
  [key: string]: unknown
}

export async function writeAutomaticPatch(root: string, plan: StudioAutomaticPatchPlan): Promise<StudioAutomaticPatchWriteResult> {
  if (!plan.canApply || plan.provider.patchIds.length === 0) throw new Error('automatic Patch has no matches to apply')
  try {
    await readProjectFile(root, plan.provider.file)
    throw new Error(`automatic Patch provider ${JSON.stringify(plan.provider.file)} already exists`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const manifestSource = await readProjectFile(root, 'package.json')
  const manifest = JSON.parse(manifestSource) as DraftManifest
  const current = manifest.dsh?.harmony?.patches
  if (!Array.isArray(current) || current.some(value => typeof value !== 'string')) throw new Error('Draft package.json must declare dsh.harmony.patches as an array of file paths')
  const declaration = `./${plan.provider.file}`
  if (current.includes(declaration)) throw new Error('automatic Patch provider is already declared')
  let clientEntrySource: string | undefined
  let clientEntryNext: string | undefined
  if (plan.client !== undefined) {
    clientEntrySource = await readProjectFile(root, plan.client.entryFile)
    if (clientEntrySource.includes('__ModuleLoader__.load')) {
      throw new Error('automatic Component Patch requires the Draft client source before it is bundled')
    }
    const relative = posix.relative(posix.dirname(plan.client.entryFile), plan.client.file)
    const specifier = relative.startsWith('.') ? relative : `./${relative}`
    const reexport = `export { ${plan.client.export} } from ${JSON.stringify(specifier)}`
    if (clientEntrySource.includes(reexport)) throw new Error('automatic Patch client export is already declared')
    clientEntryNext = `${clientEntrySource.trimEnd()}\n\n${reexport}\n`
  }
  const nextManifest: DraftManifest = {
    ...manifest,
    dependencies: plan.client === undefined ? manifest.dependencies : { ...manifest.dependencies, 'dsh-harmony-react': '^0.2.1' },
    dsh: {
      ...manifest.dsh,
      ...(plan.client === undefined ? {} : { client: { ...manifest.dsh?.client, immediately: true } }),
      harmony: { ...manifest.dsh?.harmony, patches: [...current, declaration] },
    },
  }
  const writes = [
    { file: plan.provider.file, content: plan.provider.source, created: true },
    ...(plan.client === undefined ? [] : [
      { file: plan.client.file, content: plan.client.source, created: true },
      { file: plan.client.entryFile, content: clientEntryNext!, original: clientEntrySource, created: false },
    ]),
    { file: 'package.json', content: `${JSON.stringify(nextManifest, null, 2)}\n`, original: manifestSource, created: false },
  ]
  const written: typeof writes = []
  try {
    for (const write of writes) {
      if (write.created) {
        try {
          await readProjectFile(root, write.file)
          throw new Error(`automatic Patch file ${JSON.stringify(write.file)} already exists`)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      await writeProjectFile(root, write.file, write.content)
      written.push(write)
    }
  } catch (error) {
    const rollbackErrors: unknown[] = []
    for (const write of written.reverse()) {
      try {
        if (write.created) await unlink(join(root, write.file))
        else await writeProjectFile(root, write.file, write.original!)
      } catch (rollbackError) { rollbackErrors.push(rollbackError) }
    }
    if (rollbackErrors.length > 0) throw new AggregateError([error, ...rollbackErrors], 'automatic Patch write rollback failed')
    throw error
  }
  return { ...plan, files: writes.map(item => item.file) }
}
