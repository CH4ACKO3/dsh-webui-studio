import { describe, expect, it } from 'vitest'
import type { StudioHarmonyInspection } from '../contracts.js'
import { insertPatches, reconcilePatchView } from './HarmonyPatchOrder.js'

type Patch = StudioHarmonyInspection['patches'][number]

function patch(key: string, owner: string): Patch {
  return {
    key, owner, id: key.slice(owner.length + 1), index: 0, targets: [], kind: 'source', state: 'bound',
    matches: 1, generation: 1, declaration: `${owner}/harmony.patch.yml`,
  }
}

describe('Harmony Patch card stacks', () => {
  const patches = new Map([
    ['alpha/one', patch('alpha/one', 'alpha')],
    ['alpha/two', patch('alpha/two', 'alpha')],
    ['beta/one', patch('beta/one', 'beta')],
  ])

  it('moves either one Patch or a complete stack into an insertion gap', () => {
    expect(insertPatches([...patches.keys()], ['beta/one'], 0)).toEqual(['beta/one', 'alpha/one', 'alpha/two'])
    expect(insertPatches([...patches.keys()], ['alpha/one', 'alpha/two'], 1)).toEqual(['beta/one', 'alpha/one', 'alpha/two'])
  })

  it('collapses adjacent owner runs and expands the selected stack', () => {
    expect(reconcilePatchView([...patches.keys()], patches, new Set(), new Set(), null)).toMatchObject([
      { type: 'stack', owner: 'alpha', keys: ['alpha/one', 'alpha/two'], start: 0, end: 2, expanded: false },
      { type: 'patch', owner: 'beta', key: 'beta/one', index: 2 },
    ])
    expect(reconcilePatchView([...patches.keys()], patches, new Set(['alpha/one']), new Set(), null)[0])
      .toMatchObject({ type: 'stack', expanded: true })
  })

  it('projects a drag as one insertion placeholder without keeping the dragged card in place', () => {
    expect(reconcilePatchView([...patches.keys()], patches, new Set(), new Set(), {
      keys: ['beta/one'], target: 0, visible: true,
    })).toMatchObject([
      { type: 'placeholder', index: 0 },
      { type: 'stack', keys: ['alpha/one', 'alpha/two'] },
    ])
  })
})
