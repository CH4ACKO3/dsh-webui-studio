import type { StudioVariableDefinition, StudioVariableNode } from 'dsh-harmony-react/studio'

export function flattenVariableTree(nodes: readonly StudioVariableNode[]): StudioVariableDefinition[] {
  const definitions: StudioVariableDefinition[] = []
  const visit = (items: readonly StudioVariableNode[]): void => {
    for (const item of items) {
      if (item.kind === 'group') visit(item.children)
      else definitions.push(item)
    }
  }
  visit(nodes)
  return definitions
}
