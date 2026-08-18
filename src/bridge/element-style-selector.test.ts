import { describe, expect, it } from 'vitest'
import { compileElementStyleSelector } from './element-style-selector'

describe('compileElementStyleSelector', () => {
  const scope = '[data-dsh-studio-scope~="s1"]'

  it('anchors current-element states and descendant selectors', () => {
    expect(compileElementStyleSelector('&:hover', scope)).toBe(`${scope}:hover`)
    expect(compileElementStyleSelector('& > .title', scope)).toBe(`${scope} > .title`)
    expect(compileElementStyleSelector('& .card + .card', scope)).toBe(`${scope} .card + .card`)
  })

  it('rejects selectors that can leave the registered subtree', () => {
    expect(() => compileElementStyleSelector('& + .sibling', scope)).toThrow(/stay within/)
    expect(() => compileElementStyleSelector('&:hover ~ .sibling', scope)).toThrow(/stay within/)
    expect(() => compileElementStyleSelector('body .title', scope)).toThrow(/stay within/)
    expect(() => compileElementStyleSelector('& .title, body', scope)).toThrow(/stay within/)
  })
})
