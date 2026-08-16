import { describe, expect, it } from 'vitest'
import { nextCompositeIndex } from './composite'

describe('composite keyboard navigation', () => {
  it('wraps arrow navigation and handles boundaries', () => {
    expect(nextCompositeIndex(0, 3, 'ArrowLeft')).toBe(2)
    expect(nextCompositeIndex(2, 3, 'ArrowRight')).toBe(0)
    expect(nextCompositeIndex(1, 3, 'Home')).toBe(0)
    expect(nextCompositeIndex(1, 3, 'End')).toBe(2)
  })

  it('skips disabled items in either direction', () => {
    const disabled = new Set([1, 2])
    expect(nextCompositeIndex(0, 4, 'ArrowRight', disabled)).toBe(3)
    expect(nextCompositeIndex(3, 4, 'ArrowLeft', disabled)).toBe(0)
  })

  it('leaves the current item unchanged when nothing is selectable', () => {
    expect(nextCompositeIndex(1, 2, 'ArrowRight', new Set([0, 1]))).toBe(1)
    expect(nextCompositeIndex(0, 0, 'Home')).toBe(0)
  })
})
