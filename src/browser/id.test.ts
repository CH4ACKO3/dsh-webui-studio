import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextBrowserId } from './id.js'

afterEach(() => vi.restoreAllMocks())

describe('browser identifiers', () => {
  it('creates distinct identifiers without Web Crypto', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_234)

    const first = nextBrowserId()
    const second = nextBrowserId()

    expect(first).toMatch(/^ya-[0-9a-z]+$/)
    expect(second).toMatch(/^ya-[0-9a-z]+$/)
    expect(second).not.toBe(first)
  })
})
