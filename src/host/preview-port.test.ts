import { expect, it } from 'vitest'
import { StudioPreviewPortPool } from './preview-port.js'

it('keeps the default dynamic-port behavior without a configured range', () => {
  expect(new StudioPreviewPortPool().claim()).toBeUndefined()
})

it('claims, exhausts, and reuses ports from a configured range', () => {
  const pool = new StudioPreviewPortPool('13100-13101')
  expect(pool.claim()).toBe(13100)
  expect(pool.claim()).toBe(13101)
  expect(() => pool.claim()).toThrow('No free Studio Preview port')
  pool.release(13100)
  expect(pool.claim()).toBe(13100)
})

it.each(['13100', 'x-y', '0-2', '2-1', '65000-66000'])(
  'rejects invalid configured range %s',
  range => expect(() => new StudioPreviewPortPool(range)).toThrow('DSH_STUDIO_PREVIEW_PORT_RANGE'),
)
