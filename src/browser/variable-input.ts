import type { StudioVariableDefinition, StudioVariableValue } from 'dsh-harmony-react/studio'

export function parseVariableInput(
  definition: StudioVariableDefinition,
  input: string,
  supportsLength = (value: string): boolean => globalThis.CSS?.supports('width', value) === true,
): StudioVariableValue | undefined {
  if (definition.control === 'number') {
    if (input.trim() === '') return undefined
    const value = Number(input)
    if (!Number.isFinite(value)) return undefined
    if (definition.constraints?.min !== undefined && value < definition.constraints.min) return undefined
    if (definition.constraints?.max !== undefined && value > definition.constraints.max) return undefined
    return value
  }
  if (definition.control === 'length') {
    const value = input.trim()
    return value !== '' && supportsLength(value) ? value : undefined
  }
  return input
}
