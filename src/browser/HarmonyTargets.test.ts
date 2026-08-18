import { describe, expect, it } from 'vitest'
import { groupHarmonyTargets } from './HarmonyTargets'

describe('groupHarmonyTargets', () => {
  it('groups target files by package and records each source plugin once', () => {
    const groups = groupHarmonyTargets([
      {
        package: 'target-a', file: 'client.js', original: 'a', final: 'b',
        steps: [
          { owner: 'source-a', key: 'first', matches: 1, source: 'step 1' },
          { owner: 'source-a', key: 'second', matches: 1, source: 'step 2' },
          { owner: 'source-b', key: 'third', matches: 2, source: 'step 3' },
        ],
      },
      {
        package: 'target-a', file: 'other.js', original: 'c', final: 'd',
        steps: [{ owner: 'source-b', key: 'fourth', matches: 1, source: 'step 4' }],
      },
      {
        package: 'target-b', file: 'index.js', original: 'e', final: 'f',
        steps: [{ owner: 'source-c', key: 'fifth', matches: 1, source: 'step 5' }],
      },
    ])

    expect(groups.map(group => ({
      package: group.package,
      files: group.targets.map(target => target.file),
      owners: group.sourceOwners,
    }))).toEqual([
      { package: 'target-a', files: ['client.js', 'other.js'], owners: ['source-a', 'source-b'] },
      { package: 'target-b', files: ['index.js'], owners: ['source-c'] },
    ])
  })
})
