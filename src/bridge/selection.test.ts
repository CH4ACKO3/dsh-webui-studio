import { describe, expect, it } from 'vitest'
import { pointInsideSelection } from './selection'

describe('pointInsideSelection', () => {
  it('includes the selection boundary and its interior', () => {
    const rect = { x: 10, y: 20, width: 30, height: 40 }
    expect(pointInsideSelection(rect, 10, 20)).toBe(true)
    expect(pointInsideSelection(rect, 40, 60)).toBe(true)
    expect(pointInsideSelection(rect, 25, 35)).toBe(true)
  })

  it('rejects points outside the selection geometry', () => {
    const rect = { x: 10, y: 20, width: 30, height: 40 }
    expect(pointInsideSelection(rect, 9, 35)).toBe(false)
    expect(pointInsideSelection(rect, 41, 35)).toBe(false)
    expect(pointInsideSelection(rect, 25, 61)).toBe(false)
  })
})
