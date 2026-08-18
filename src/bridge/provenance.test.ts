import { describe, expect, it } from 'vitest'
import { patchTraces, type FiberSnapshot } from './provenance'

function traceType(): (() => void) & { __dshHarmonyPatchTrace: true } {
  const marker = (): void => undefined
  return Object.assign(marker, { __dshHarmonyPatchTrace: true as const })
}

describe('Patch provenance', () => {
  it('collects valid candidate traces from the selected Fiber ancestry', () => {
    const parent: FiberSnapshot = {
      type: traceType(),
      memoizedProps: {
        traces: [{
          key: 'draft/change',
          owner: 'draft',
          effect: 'transform-props',
          declaration: 'patch.cjs',
          target: { package: 'target', file: 'lib/client.js' },
        }],
      },
    }
    const fiber: FiberSnapshot = { type: 'button', return: parent }

    expect(patchTraces(fiber)).toEqual([{
      key: 'draft/change',
      owner: 'draft',
      effect: 'transform-props',
      declaration: 'patch.cjs',
      target: { package: 'target', file: 'lib/client.js' },
      confidence: 'candidate',
    }])
  })

  it('collects Component decorate and replace traces', () => {
    const traces = ['decorate-component', 'replace-component'].map(effect => ({
      key: `draft/${effect}`,
      owner: 'draft',
      effect,
      declaration: 'patch.cjs',
      target: { package: 'target', file: 'lib/client.js' },
    }))
    const fiber: FiberSnapshot = { type: traceType(), memoizedProps: { traces } }

    expect(patchTraces(fiber).map(trace => trace.effect)).toEqual([
      'decorate-component',
      'replace-component',
    ])
  })

  it('keeps distinct targets and effects while removing exact duplicates and invalid evidence', () => {
    const duplicate = {
      key: 'draft/change', owner: 'draft', effect: 'wrap-element', declaration: 'patch.cjs',
      target: { package: 'target', file: 'lib/a.js' },
    }
    const fiber: FiberSnapshot = {
      type: traceType(),
      memoizedProps: { traces: [duplicate, duplicate, { ...duplicate, target: { package: 'target', file: 'lib/b.js' } }, { key: 1 }] },
    }

    expect(patchTraces(fiber).map(trace => trace.target.file)).toEqual(['lib/a.js', 'lib/b.js'])
  })

  it('bounds cyclic and oversized untrusted Fiber evidence', () => {
    const long = 'x'.repeat(1_200)
    const traces = Array.from({ length: 21 }, (_, index) => ({
      key: `${index}-${long}`,
      owner: long,
      effect: 'insert-after',
      declaration: long,
      target: { package: long, file: long },
    }))
    const fiber: FiberSnapshot = { type: traceType(), memoizedProps: { traces } }
    fiber.return = fiber

    const result = patchTraces(fiber)
    expect(result).toHaveLength(20)
    expect(result[0]).toMatchObject({
      key: expect.stringMatching(/^0-x{498}$/),
      owner: expect.stringMatching(/^x{500}$/),
      declaration: expect.stringMatching(/^x{1000}$/),
      target: { package: expect.stringMatching(/^x{500}$/), file: expect.stringMatching(/^x{1000}$/) },
    })
  })
})
