import { describe, expect, it } from 'vitest'
import { constrainRect, fitRect, moveRect, resizeRect, type LayoutRect } from './layout'

const bounds: LayoutRect = { x: 10, y: 10, width: 800, height: 500 }

describe('studio layout geometry', () => {
  it('fits an aspect ratio inside the available stage', () => {
    expect(fitRect(bounds, 16 / 9)).toEqual({ x: 10, y: 35, width: 800, height: 450 })
  })

  it('constrains moved panels to their bounds', () => {
    expect(moveRect({ x: 20, y: 20, width: 300, height: 200 }, -100, 600, bounds))
      .toEqual({ x: 10, y: 310, width: 300, height: 200 })
  })

  it('resizes an edge freely while retaining the opposite edge', () => {
    expect(resizeRect({ x: 100, y: 100, width: 400, height: 225 }, 'w', 80, 0, bounds,
      { width: 320, height: 180 }, false))
      .toEqual({ x: 180, y: 100, width: 320, height: 225 })
  })

  it('locks the current ratio while resizing a corner', () => {
    expect(resizeRect({ x: 100, y: 100, width: 400, height: 200 }, 'se', 100, 10, bounds,
      { width: 320, height: 180 }, true))
      .toEqual({ x: 100, y: 100, width: 500, height: 250 })
  })

  it('allows an unbounded preview to reach a one-pixel viewport', () => {
    expect(resizeRect({ x: 100, y: 100, width: 400, height: 225 }, 'w', 500, 0, undefined,
      { width: 1, height: 1 }, false))
      .toEqual({ x: 499, y: 100, width: 1, height: 225 })
  })

  it('shrinks oversized rectangles into new bounds', () => {
    expect(constrainRect({ x: 0, y: 0, width: 900, height: 600 }, bounds)).toEqual(bounds)
  })
})
