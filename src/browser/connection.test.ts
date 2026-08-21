import { afterEach, describe, expect, it, vi } from 'vitest'
import { studioFetch } from './connection'

describe('Studio browser connection', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('invokes the browser fetch function with its global receiver', async () => {
    const response = {} as Response
    const fetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation')
      return Promise.resolve(response)
    })
    vi.stubGlobal('fetch', fetch)

    await expect(Reflect.apply(studioFetch, {}, ['http://studio.test'])).resolves.toBe(response)
    expect(fetch).toHaveBeenCalledOnce()
  })
})
