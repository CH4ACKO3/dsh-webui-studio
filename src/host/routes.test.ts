import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { describe, expect, it, vi } from 'vitest'
import { STUDIO_API_PATH, STUDIO_PATH } from '../contracts.js'
import type { StudioBackend } from './backend.js'
import { createStudioRoutes, isTrustedStudioRequest } from './routes.js'

function request(remoteAddress: string, fetchSite?: string): IncomingMessage {
  return {
    socket: { remoteAddress },
    headers: fetchSite === undefined ? {} : { 'sec-fetch-site': fetchSite },
  } as IncomingMessage
}

describe('isTrustedStudioRequest', () => {
  it('accepts local same-origin requests', () => {
    expect(isTrustedStudioRequest(request('127.0.0.1', 'same-origin'))).toBe(true)
    expect(isTrustedStudioRequest(request('::1'))).toBe(true)
    expect(isTrustedStudioRequest(request('::ffff:127.0.0.1', 'none'))).toBe(true)
  })

  it('rejects remote and cross-site requests', () => {
    expect(isTrustedStudioRequest(request('192.168.1.8', 'same-origin'))).toBe(false)
    expect(isTrustedStudioRequest(request('127.0.0.1', 'cross-site'))).toBe(false)
  })
})

describe('Studio routes', () => {
  const security = { token: 'secret-token', host: '127.0.0.1:3081', origin: 'http://127.0.0.1:3081' }

  function routes(backend = { call: vi.fn(async message => ({
    type: 'server-response', rpcId: message.rpcId, result: { ok: true, value: { connected: true } },
  })) } as unknown as StudioBackend): WebRoute[] {
    return createStudioRoutes(
      backend,
      { script: Buffer.from('studio-script'), style: Buffer.from('studio-style'), bridge: Buffer.from('studio-bridge') },
      security,
    )
  }

  async function invoke(route: WebRoute, input: {
    method?: string
    url?: string
    headers?: Record<string, string>
    body?: string
    remoteAddress?: string
  } = {}): Promise<{ status: number; headers: Record<string, string | number>; body: string }> {
    const stream = Readable.from(input.body === undefined ? [] : [input.body])
    const req = Object.assign(stream, {
      method: input.method ?? 'GET',
      url: input.url ?? route.path,
      headers: input.headers ?? {},
      socket: { remoteAddress: input.remoteAddress ?? '127.0.0.1' },
    }) as unknown as IncomingMessage
    const result = { status: 0, headers: {} as Record<string, string | number>, body: '' }
    const res = {
      writeHead(status: number, headers: Record<string, string | number>) {
        result.status = status
        result.headers = headers
        return this
      },
      end(body?: string | Buffer) {
        result.body = body === undefined ? '' : body.toString()
        return this
      },
    } as unknown as ServerResponse
    await route.handler(req, res)
    return result
  }

  it('serves the bridge and includes the API capability only in the Studio document', async () => {
    const routes = createStudioRoutes(
      {} as StudioBackend,
      { script: Buffer.alloc(0), style: Buffer.alloc(0), bridge: Buffer.from('studio-bridge') },
      security,
    )
    expect(routes.some(route => route.path.endsWith('/bridge.js'))).toBe(true)
    expect(routes.some(route => route.path.endsWith('/events.mux'))).toBe(false)

    const page = await invoke(routes.find(route => route.path === STUDIO_PATH)!)
    const bridge = await invoke(routes.find(route => route.path.endsWith('/bridge.js'))!)
    expect(page.status).toBe(200)
    expect(page.body).toContain('window.__DSH_STUDIO__={token:"secret-token"}')
    expect(page.body).toContain('<meta name="referrer" content="no-referrer"')
    expect(bridge.body).toBe('studio-bridge')
    expect(bridge.body).not.toContain('secret-token')
  })

  it('requires the exact capability, Origin, and Host for every API call', async () => {
    const backend = { call: vi.fn(async message => ({
      type: 'server-response', rpcId: message.rpcId, result: { ok: true, value: { connected: true } },
    })) } as unknown as StudioBackend
    const api = routes(backend).find(route => route.path === STUDIO_API_PATH)!
    const body = JSON.stringify({
      type: 'client-request', rpcId: 'rpc-1', method: 'studio.preview.status', payload: {},
    })
    const validHeaders = {
      'content-type': 'application/json',
      host: security.host,
      origin: security.origin,
      'x-dsh-studio-token': security.token,
      'sec-fetch-site': 'same-origin',
    }
    const request = (headers: Record<string, string>) => invoke(api, {
      method: 'POST', url: `${STUDIO_API_PATH}/studio.preview.status`, headers, body,
    })

    expect((await request({ ...validHeaders, 'x-dsh-studio-token': 'wrong' })).status).toBe(403)
    expect((await request({ ...validHeaders, origin: 'http://127.0.0.1:9999' })).status).toBe(403)
    expect((await request({ ...validHeaders, host: '127.0.0.1:9999' })).status).toBe(403)
    const accepted = await request(validHeaders)
    expect(accepted.status).toBe(200)
    expect(JSON.parse(accepted.body)).toMatchObject({ rpcId: 'rpc-1', result: { ok: true } })
    expect(backend.call).toHaveBeenCalledOnce()
  })
})
