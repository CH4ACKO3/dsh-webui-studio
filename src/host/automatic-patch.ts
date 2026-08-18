import { createHash } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import ts from 'typescript'
import type {
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

function identifier(packageName: string): string {
  const value = packageName.split('/').at(-1)!.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  return value === '' ? 'target' : value.slice(0, 32)
}

function excerpt(source: string, start: number, end: number): string {
  const lineStart = source.lastIndexOf('\n', start - 1) + 1
  const nextLine = source.indexOf('\n', end)
  const lineEnd = nextLine === -1 ? source.length : nextLine
  const value = source.slice(lineStart, lineEnd).trim()
  return value.length <= 240 ? value : `${value.slice(0, 237)}...`
}

function analyzeTarget(
  request: StudioAutomaticPatchRequest,
  target: AutomaticPatchSource,
): StudioAutomaticPatchTargetAnalysis {
  const sourceFile = ts.createSourceFile(target.file, target.source, ts.ScriptTarget.Latest, true)
  const matches: StudioAutomaticPatchTargetAnalysis['matches'] = []
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) && node.text === request.text) {
      const start = node.getStart(sourceFile)
      const location = sourceFile.getLineAndCharacterOfPosition(start)
      matches.push({
        line: location.line + 1,
        column: location.character + 1,
        excerpt: excerpt(target.source, start, node.getEnd()),
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return { package: target.package, file: target.file, version: target.version, matches }
}

function providerSource(request: StudioAutomaticPatchRequest, targets: StudioAutomaticPatchTargetAnalysis[]): {
  source: string
  patchIds: string[]
} {
  const patches = targets.flatMap(target => {
    if (target.matches.length === 0) return []
    const id = `auto-replace-${identifier(target.package)}-${digest({ target, text: request.text, replacement: request.replacement })}`
    return [{ id, target }]
  })
  const declarations = patches.map(({ id, target }) => `  {
    id: ${JSON.stringify(id)},
    target: {
      package: ${JSON.stringify(target.package)},
      version: ${JSON.stringify(target.version)},
      files: [${JSON.stringify(target.file)}],
    },
    select: ${JSON.stringify(`StringLiteral[text=${JSON.stringify(request.text)}]`)},
    expect: ${target.matches.length},
    apply({ node, sourceFile, edit }) {
      edit.overwrite(node.getStart(sourceFile), node.getEnd(), JSON.stringify(${JSON.stringify(request.replacement)}))
    },
  }`).join(',\n')
  return {
    patchIds: patches.map(patch => patch.id),
    source: `'use strict'\n\nmodule.exports = [\n${declarations}\n]\n`,
  }
}

export function analyzeAutomaticPatch(
  request: StudioAutomaticPatchRequest,
  sources: AutomaticPatchSource[],
): StudioAutomaticPatchPlan {
  if (request.kind !== 'replace-string') throw new Error('automatic Patch kind is not supported')
  if (request.text === '') throw new Error('automatic string Patch text must not be empty')
  if (request.targets.length === 0) throw new Error('automatic Patch requires at least one target')
  if (request.targets.length !== sources.length) throw new Error('automatic Patch target sources are incomplete')
  const requested = request.targets.map(target => `${target.package}\0${target.file}`)
  if (new Set(requested).size !== requested.length) throw new Error('automatic Patch targets must be unique')
  for (let index = 0; index < sources.length; index += 1) {
    const target = request.targets[index]!
    const source = sources[index]!
    if (source.package !== target.package || source.file !== target.file) {
      throw new Error('automatic Patch source does not match its requested target')
    }
  }
  const targets = sources.map(source => analyzeTarget(request, source))
  const generated = providerSource(request, targets)
  const file = `patch.auto-${digest({ request, versions: targets.map(target => target.version) })}.cjs`
  return {
    request,
    targets,
    canApply: generated.patchIds.length > 0,
    provider: { file, source: generated.source, patchIds: generated.patchIds },
  }
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
  if (!Array.isArray(current) || current.some(value => typeof value !== 'string')) {
    throw new Error('Draft package.json must declare dsh.harmony.patches as an array of file paths')
  }
  const declaration = `./${plan.provider.file}`
  if (current.includes(declaration)) throw new Error('automatic Patch provider is already declared')
  const nextManifest: DraftManifest = {
    ...manifest,
    dsh: {
      ...manifest.dsh,
      harmony: { ...manifest.dsh?.harmony, patches: [...current, declaration] },
    },
  }
  await writeProjectFile(root, plan.provider.file, plan.provider.source)
  try {
    await writeProjectFile(root, 'package.json', `${JSON.stringify(nextManifest, null, 2)}\n`)
  } catch (error) {
    try {
      await unlink(join(root, plan.provider.file))
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'automatic Patch manifest update failed and provider rollback failed')
    }
    throw error
  }
  return { ...plan, files: [plan.provider.file, 'package.json'] }
}
