import type { StudioPatchTrace } from '../contracts'

export interface FiberSnapshot {
  memoizedProps?: Record<string, unknown>
  return?: FiberSnapshot | null
  type?: unknown
}

function traceType(value: unknown): boolean {
  return (typeof value === 'function' || typeof value === 'object') && value !== null
    && (value as { __dshHarmonyPatchTrace?: unknown }).__dshHarmonyPatchTrace === true
}

function patchTrace(value: unknown): StudioPatchTrace | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const trace = value as Partial<StudioPatchTrace>
  const target = trace.target as Partial<StudioPatchTrace['target']> | undefined
  const effects = new Set([
    'replace-element',
    'wrap-element',
    'insert-before',
    'insert-after',
    'transform-props',
    'decorate-component',
    'replace-component',
  ])
  if (typeof trace.key !== 'string' || typeof trace.owner !== 'string' || typeof trace.declaration !== 'string'
    || typeof trace.effect !== 'string' || !effects.has(trace.effect)
    || target === undefined || typeof target.package !== 'string' || typeof target.file !== 'string') return undefined
  return {
    key: trace.key.slice(0, 500),
    owner: trace.owner.slice(0, 500),
    effect: trace.effect as StudioPatchTrace['effect'],
    declaration: trace.declaration.slice(0, 1_000),
    target: { package: target.package.slice(0, 500), file: target.file.slice(0, 1_000) },
    confidence: 'candidate',
  }
}

export function patchTraces(fiber: FiberSnapshot | null): StudioPatchTrace[] {
  const traces: StudioPatchTrace[] = []
  const identities = new Set<string>()
  const seen = new Set<FiberSnapshot>()
  let current = fiber
  while (current !== null && !seen.has(current) && seen.size < 100) {
    seen.add(current)
    if (traceType(current.type)) {
      const candidates = current.memoizedProps?.traces
      if (Array.isArray(candidates)) {
        for (const candidate of candidates) {
          const trace = patchTrace(candidate)
          if (trace !== undefined) {
            const identity = `${trace.key}\0${trace.target.package}\0${trace.target.file}\0${trace.effect}`
            if (!identities.has(identity)) {
              identities.add(identity)
              traces.push(trace)
            }
          }
          if (traces.length === 20) return traces
        }
      }
    }
    current = current.return ?? null
  }
  return traces
}
