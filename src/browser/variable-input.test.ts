import { describe, expect, it, vi } from 'vitest'
import type { StudioVariableDefinition } from 'dsh-harmony-react/studio'
import { parseVariableInput } from './variable-input.js'

function definition(control: StudioVariableDefinition['control'], constraints?: StudioVariableDefinition['constraints']): StudioVariableDefinition {
  return { kind: 'variable', id: 'value', label: 'Value', control, constraints }
}

describe('parseVariableInput', () => {
  it('keeps incomplete CSS lengths out of Preview', () => {
    const supportsLength = vi.fn((value: string) => value === '34px')
    expect(parseVariableInput(definition('length'), '3', supportsLength)).toBeUndefined()
    expect(parseVariableInput(definition('length'), '34p', supportsLength)).toBeUndefined()
    expect(parseVariableInput(definition('length'), '34px', supportsLength)).toBe('34px')
  })

  it('accepts only finite numbers inside declared bounds', () => {
    const input = definition('number', { min: 1, max: 10 })
    expect(parseVariableInput(input, '')).toBeUndefined()
    expect(parseVariableInput(input, '0')).toBeUndefined()
    expect(parseVariableInput(input, '5.5')).toBe(5.5)
    expect(parseVariableInput(input, '11')).toBeUndefined()
  })

  it('preserves complete strings including an empty string', () => {
    expect(parseVariableInput(definition('string'), '')).toBe('')
    expect(parseVariableInput(definition('string'), 'Draft title')).toBe('Draft title')
  })
})
