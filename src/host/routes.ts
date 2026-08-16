import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { STUDIO_API_PATH, STUDIO_PATH, type StudioClientRequest } from '../contracts.js'
import type { StudioBackend } from './backend.js'

const MAX_BODY_BYTES = 1024 * 1024

export interface StudioAssets {
  script: Buffer
  style: Buffer
  bridge: Buffer
}

export interface StudioRouteSecurity {
  token: string
  origin: string
  host: string
}

function remoteIsLoopback(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  return address === '::1' || address === '127.0.0.1' || address?.startsWith('127.') === true
    || address?.startsWith('::ffff:127.') === true
}

export function isTrustedStudioRequest(request: IncomingMessage): boolean {
  if (!remoteIsLoopback(request)) return false
  const fetchSite = request.headers['sec-fetch-site']
  return fetchSite === undefined || fetchSite === 'same-origin' || fetchSite === 'none'
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('request body is too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

function sendAsset(request: IncomingMessage, response: ServerResponse, contentType: string, body: Buffer): void {
  response.writeHead(200, {
    'cache-control': 'no-cache',
    'content-length': body.length,
    'content-type': contentType,
  })
  response.end(request.method === 'HEAD' ? undefined : body)
}

function documentHtml(token: string): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <meta name="referrer" content="no-referrer" />
    <title>Harmony WebUI Studio</title>
    <link rel="stylesheet" href="${STUDIO_PATH}/assets/studio.css" />
    <script>window.__DSH_STUDIO__={token:${JSON.stringify(token)}};</script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${STUDIO_PATH}/assets/studio.js"></script>
  </body>
</html>`
}

function hasStudioCapability(request: IncomingMessage, security: StudioRouteSecurity): boolean {
  return request.headers.host === security.host
    && request.headers.origin === security.origin
    && request.headers['x-dsh-studio-token'] === security.token
}

function rejectUntrusted(request: IncomingMessage, response: ServerResponse): boolean {
  if (isTrustedStudioRequest(request)) return false
  sendJson(response, 403, { error: 'Studio is available from the local machine only.' })
  return true
}

export function createStudioRoutes(backend: StudioBackend, assets: StudioAssets, security: StudioRouteSecurity): WebRoute[] {
  const page = Buffer.from(documentHtml(security.token))
  const apiHandler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (rejectUntrusted(request, response)) return
    if (!hasStudioCapability(request, security)) return sendJson(response, 403, { error: 'invalid Studio capability' })
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'method not allowed' })
    if ((request.headers['content-type'] ?? '').split(';')[0] !== 'application/json') {
      return sendJson(response, 415, { error: 'content-type must be application/json' })
    }
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    const method = path.slice(`${STUDIO_API_PATH}/`.length)
    try {
      const body = await readJson(request)
      const candidate = body as Partial<StudioClientRequest>
      if (candidate.type !== 'client-request' || typeof candidate.rpcId !== 'string'
        || candidate.method !== method) {
        return sendJson(response, 400, { error: 'invalid client-request' })
      }
      sendJson(response, 200, await backend.call(candidate as StudioClientRequest))
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  }
  return [
    {
      kind: 'exact',
      path: STUDIO_PATH,
      handler(request, response) {
        if (rejectUntrusted(request, response)) return
        if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'method not allowed' })
        sendAsset(request, response, 'text/html; charset=utf-8', page)
      },
    },
    {
      kind: 'exact',
      path: `${STUDIO_PATH}/bridge.js`,
      handler(request, response) {
        if (rejectUntrusted(request, response)) return
        if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'method not allowed' })
        sendAsset(request, response, 'text/javascript; charset=utf-8', assets.bridge)
      },
    },
    {
      kind: 'exact',
      path: `${STUDIO_PATH}/assets/studio.js`,
      handler(request, response) {
        if (rejectUntrusted(request, response)) return
        if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'method not allowed' })
        sendAsset(request, response, 'text/javascript; charset=utf-8', assets.script)
      },
    },
    {
      kind: 'exact',
      path: `${STUDIO_PATH}/assets/studio.css`,
      handler(request, response) {
        if (rejectUntrusted(request, response)) return
        if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'method not allowed' })
        sendAsset(request, response, 'text/css; charset=utf-8', assets.style)
      },
    },
    { kind: 'prefix', path: STUDIO_API_PATH, handler: apiHandler },
  ]
}
