import { createHash } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tsquery } from '@phenomnomnominal/tsquery'
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

function jsxProps(node: ts.Node): ts.Expression | undefined {
  if (!ts.isCallExpression(node) || node.arguments.length < 2) return undefined
  let expression: ts.Expression = node.expression
  while (ts.isParenthesizedExpression(expression)) expression = expression.expression
  if (!ts.isBinaryExpression(expression) || expression.operatorToken.kind !== ts.SyntaxKind.CommaToken
    || !ts.isPropertyAccessExpression(expression.right)
    || (expression.right.name.text !== 'jsx' && expression.right.name.text !== 'jsxs')) return undefined
  return node.arguments[1]
}

function cssReactProperty(property: string): string {
  if (property.startsWith('--')) return property
  return property.replace(/^-([a-z])/, (_, letter: string) => letter.toUpperCase()).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
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
  if (request.select.trim() === '') throw new Error('automatic CSS Patch selector must not be empty')
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
    let nodes: readonly ts.Node[]
    try {
      nodes = tsquery(sourceFile, request.select)
    } catch (error) {
      throw new Error(`automatic CSS Patch selector is invalid: ${error instanceof Error ? error.message : String(error)}`)
    }
    matches = nodes.map(node => match(sourceFile, target.source, node, jsxProps(node) !== undefined,
      jsxProps(node) === undefined ? 'selector match is not a compiled React jsx/jsxs call' : undefined))
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
  providerFile: string,
  owner: string,
): string {
  const variables = request.variables
  const definitions = variables.map(variable => `{
          kind: 'variable', id: ${JSON.stringify(variable.id)}, label: ${JSON.stringify(variable.label)}, control: ${JSON.stringify(variable.control)},
          ${variable.options === undefined ? '' : `options: ${JSON.stringify(variable.options)},`}
          ${variable.constraints === undefined ? '' : `constraints: ${JSON.stringify(variable.constraints)},`}
          defaultSource: { file: ${JSON.stringify(providerFile)}, before: ${JSON.stringify(`        ${JSON.stringify(variable.id)}: /* dsh-studio-default:${id}:${variable.id} */ `)}, after: ',\n' },
        }`).join(',\n')
  const config = JSON.stringify(variables.map(variable => ({
    id: variable.id,
    property: variable.property,
    reactProperty: cssReactProperty(variable.property),
  })))
  const registration = `(() => {
        const __props = (${`SOURCE_PROPS`}) || {};
        const __runtime = globalThis.__DSH_HARMONY_STUDIO_RUNTIME__;
        const __key = Symbol.for(${JSON.stringify(`dsh-studio:auto:${id}`)});
        const __signature = ${JSON.stringify(digest({ id, variables }))};
        const __defaults = DEFAULT_VALUES;
        const __config = ${config}.map(item => ({ ...item, value: __defaults[item.id] }));
        let __state = globalThis[__key];
        if (!__state || __state.signature !== __signature) {
          __state?.dispose?.();
          const __values = Object.fromEntries(__config.map(item => [item.id, item.value]));
          const __apply = () => {
            if (typeof document === 'undefined') return;
            for (const element of document.querySelectorAll('[data-dsh-studio-auto=${id}]')) {
              for (const item of __config) element.style.setProperty(item.property, String(__values[item.id]));
            }
          };
          const __bindings = Object.fromEntries(__config.map(item => [item.id, {
            get: () => __values[item.id],
            set: value => { __values[item.id] = value; __apply(); },
          }]));
          const __registration = __runtime?.registerElement({
            owner: ${JSON.stringify(owner)},
            element: {
              id: ${JSON.stringify(`${request.elementId}-${identifier(target.package)}-${digest(target.file, 6)}`)},
              label: ${JSON.stringify(`${request.elementLabel} · ${target.package}`)},
              boundary: { surfaceId: 'dsh-studio-auto', path: [${JSON.stringify(request.elementId)}] },
              source: { file: ${JSON.stringify(providerFile)} },
              variables: [{ kind: 'group', id: 'css', label: 'CSS', children: [${definitions}] }],
            },
            bindings: __bindings,
          });
          __state = { signature: __signature, values: __values, apply: __apply, dispose: __registration };
          globalThis[__key] = __state;
        }
        const __style = { ...(typeof __props.style === 'object' && __props.style !== null ? __props.style : {}) };
        for (const item of __config) __style[item.reactProperty] = __state.values[item.id];
        return { ...__props, 'data-dsh-studio-auto': ${JSON.stringify(id)}, style: __style };
      })()`
  return `  {
    id: ${JSON.stringify(id)},
    target: { package: ${JSON.stringify(target.package)}, version: ${JSON.stringify(target.version)}, files: [${JSON.stringify(target.file)}] },
    select: ${JSON.stringify(request.select)},
    expect: ${target.matches.length},
    apply(context) {
      const node = context.node;
      if (!context.ts.isCallExpression(node) || node.arguments.length < 2) throw new Error('automatic CSS Patch matched a non-element node');
      let expression = node.expression;
      while (context.ts.isParenthesizedExpression(expression)) expression = expression.expression;
      if (!context.ts.isBinaryExpression(expression) || expression.operatorToken.kind !== context.ts.SyntaxKind.CommaToken || !context.ts.isPropertyAccessExpression(expression.right) || (expression.right.name.text !== 'jsx' && expression.right.name.text !== 'jsxs')) throw new Error('automatic CSS Patch matched a non-compiled React element');
      const props = node.arguments[1];
      const __defaults = {
${variables.map(variable => `        ${JSON.stringify(variable.id)}: /* dsh-studio-default:${id}:${variable.id} */ ${JSON.stringify(variable.value)},`).join('\n')}
      };
      const replacement = ${JSON.stringify(registration)}
        .replace('SOURCE_PROPS', context.source.slice(props.getStart(context.sourceFile), props.getEnd()))
        .replace('DEFAULT_VALUES', JSON.stringify(__defaults));
      context.edit.overwrite(props.getStart(context.sourceFile), props.getEnd(), replacement);
    },
  }`
}

function providerSource(request: StudioAutomaticPatchRequest, targets: StudioAutomaticPatchTargetAnalysis[], owner: string, providerFile: string): { source: string; patchIds: string[] } {
  const applicable = targets.filter(target => target.matches.length > 0 && target.matches.every(item => item.applicable))
  const patchIds = applicable.map(target => patchId(request, target))
  const declarations = applicable.map((target, index) => request.kind === 'replace-string'
    ? stringPatch(request, target, patchIds[index]!)
    : cssPatch(request, target, patchIds[index]!, providerFile, owner)).join(',\n')
  return { patchIds, source: `'use strict'\n\nmodule.exports = [\n${declarations}\n]\n` }
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
  const generated = providerSource(request, targets, owner, file)
  return { request, targets, canApply: generated.patchIds.length > 0, provider: { file, source: generated.source, patchIds: generated.patchIds } }
}

interface DraftManifest {
  dsh?: { harmony?: { patches?: unknown }; [key: string]: unknown }
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
  const nextManifest: DraftManifest = { ...manifest, dsh: { ...manifest.dsh, harmony: { ...manifest.dsh?.harmony, patches: [...current, declaration] } } }
  await writeProjectFile(root, plan.provider.file, plan.provider.source)
  try {
    await writeProjectFile(root, 'package.json', `${JSON.stringify(nextManifest, null, 2)}\n`)
  } catch (error) {
    try { await unlink(join(root, plan.provider.file)) } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'automatic Patch manifest update failed and provider rollback failed')
    }
    throw error
  }
  return { ...plan, files: [plan.provider.file, 'package.json'] }
}
