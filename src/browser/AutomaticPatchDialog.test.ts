import { describe, expect, it } from 'vitest'
import type { StudioDomSelection } from '../contracts'
import { automaticPatchScope } from './AutomaticPatchDialog'

function selection(overrides: Partial<StudioDomSelection> = {}): StudioDomSelection {
  return {
    tag: 'div', classes: [], attributes: {}, text: '', outerHTML: '<div></div>',
    rect: { x: 0, y: 0, width: 100, height: 40 }, style: {}, boundaries: [], confidence: 'mapped',
    ...overrides,
  }
}

describe('automaticPatchScope', () => {
  it('uses an existing Surface boundary without synthesizing a selector', () => {
    const boundary = { surfaceId: 'hero', path: ['headline'] }
    expect(automaticPatchScope(selection({ boundaries: [boundary] }))).toEqual({ boundary })
  })

  it('creates a component-owned boundary from an element class', () => {
    expect(automaticPatchScope(selection({ tag: 'span', classes: ['headline', 'large'] }))).toEqual({
      boundary: { surfaceId: 'dsh-studio-auto', path: ['span[class~="headline"]'] },
      targetSelector: 'span[class~="headline"]',
    })
  })

  it('prefers a stable element id over a class', () => {
    expect(automaticPatchScope(selection({ id: 'composer', classes: ['input'] }))).toEqual({
      boundary: { surfaceId: 'dsh-studio-auto', path: ['[id="composer"]'] },
      targetSelector: '[id="composer"]',
    })
  })
})
