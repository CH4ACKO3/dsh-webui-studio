import { describe, expect, it } from 'vitest'
import { suggestCssProperties } from './css-property-suggestions'

const properties = ['align-items', 'align-self', 'background', 'background-color', 'grid-template-columns']

describe('suggestCssProperties', () => {
  it('offers complete CSS property names by prefix', () => {
    expect(suggestCssProperties(properties, 'align')).toEqual([
      { label: 'align-items', value: 'align-items' },
      { label: 'align-self', value: 'align-self' },
    ])
    expect(suggestCssProperties(properties, 'background')).toEqual([
      { label: 'background-color', value: 'background-color' },
    ])
  })

  it('supports hyphenated prefixes and leaves custom properties unrestricted', () => {
    expect(suggestCssProperties(properties, 'background-c')).toEqual([
      { label: 'background-color', value: 'background-color' },
    ])
    expect(suggestCssProperties(properties, '--brand')).toEqual([])
  })
})
