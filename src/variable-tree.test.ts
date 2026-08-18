import { describe, expect, it } from 'vitest'
import type { StudioVariableNode } from 'dsh-harmony-react/studio'
import { flattenVariableTree } from './variable-tree.js'

describe('flattenVariableTree', () => {
  it('preserves leaf order across nested groups', () => {
    const nodes: StudioVariableNode[] = [
      { kind: 'variable', id: 'title', label: 'Title', control: 'string' },
      { kind: 'group', id: 'appearance', label: 'Appearance', children: [
        { kind: 'variable', id: 'color', label: 'Color', control: 'color' },
        { kind: 'group', id: 'typography', label: 'Typography', children: [
          { kind: 'variable', id: 'size', label: 'Size', control: 'length' },
        ] },
      ] },
    ]

    expect(flattenVariableTree(nodes).map(variable => variable.id)).toEqual(['title', 'color', 'size'])
  })
})
