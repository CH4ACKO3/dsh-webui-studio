import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  STUDIO_PATH,
  STUDIO_PREVIEW_API_PATH,
  type StudioHarmonyService,
  type StudioSourceLocation,
} from '../contracts.js'
import { StudioPreviewDraft } from './preview-draft.js'
import { StudioSourceResolver } from './source-resolution.js'

interface PreviewWorkerOptions {
  root: string
  controlToken: string
  parentOrigin: string
  bridgeCapability: string
  bridge: Buffer
}

function loopback(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  return address === '::1' || address === '127.0.0.1' || address?.startsWith('::ffff:127.') === true
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  if (Buffer.concat(chunks).byteLength > 1024 * 1024) throw new Error('request body is too large')
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

export function applyPreviewWorker(ctx: Context, harmony: StudioHarmonyService, options: PreviewWorkerOptions): void {
  ctx.effect(() => {
    const draft = new StudioPreviewDraft(ctx, harmony, options.root)
    let readiness:
      | { state: 'starting' }
      | { state: 'ready' }
      | { state: 'failed'; error: unknown } = { state: 'starting' }
    const ready = draft.open()
    void ready.then(
      () => { readiness = { state: 'ready' } },
      error => { readiness = { state: 'failed', error } },
    )
    const sources = new StudioSourceResolver(options.root, harmony.profileDir)
    const worker: WebRoute = {
      kind: 'prefix',
      path: STUDIO_PREVIEW_API_PATH,
      async handler(request, response) {
        if (!loopback(request) || request.headers.authorization !== `Bearer ${options.controlToken}`) {
          return json(response, 403, { ok: false, error: 'invalid Preview worker capability' })
        }
        if (request.method !== 'POST') return json(response, 405, { ok: false, error: 'method not allowed' })
        try {
          const payload = await readJson(request)
          const method = new URL(request.url ?? '/', 'http://localhost').pathname.slice(`${STUDIO_PREVIEW_API_PATH}/`.length)
          if (method === 'health') {
            if (readiness.state === 'starting') {
              return json(response, 503, { ok: false, error: 'Preview worker is still preparing the Draft' })
            }
            if (readiness.state === 'failed') {
              return json(response, 500, {
                ok: false,
                error: readiness.error instanceof Error ? readiness.error.message : String(readiness.error),
              })
            }
            return json(response, 200, { ok: true, value: { ready: true } })
          }
          const opened = await ready
          if (method === 'state') return json(response, 200, { ok: true, value: { project: opened.snapshot() } })
          if (method === 'activate') {
            if (typeof payload.graphRev !== 'string') throw new Error('graphRev is required')
            return json(response, 200, { ok: true, value: { project: opened.activate(payload.graphRev) } })
          }
          if (method === 'apply-build') {
            return json(response, 200, { ok: true, value: { project: await opened.applyBuild() } })
          }
          if (method === 'inspect') {
            const packageName = typeof payload.package === 'string' ? payload.package : undefined
            const file = typeof payload.file === 'string' ? payload.file : undefined
            return json(response, 200, {
              ok: true,
              value: {
                harmony: harmony.inspect({ ...(packageName === undefined ? {} : { package: packageName }), ...(file === undefined ? {} : { file }) }),
                dependencies: harmony.inspectDependencies(opened.snapshot().name),
              },
            })
          }
          if (method === 'resolve-source') {
            const source = payload.source as Partial<StudioSourceLocation> | undefined
            if (typeof source?.file !== 'string' || source.file === ''
              || (source.line !== undefined && (!Number.isInteger(source.line) || source.line < 1))
              || (source.column !== undefined && (!Number.isInteger(source.column) || source.column < 1))) {
              throw new Error('source location is invalid')
            }
            return json(response, 200, { ok: true, value: await sources.resolve(source as StudioSourceLocation) })
          }
          if (method === 'read-source') {
            if (typeof payload.package !== 'string' || typeof payload.file !== 'string') {
              throw new Error('dependency package and file are required')
            }
            return json(response, 200, {
              ok: true,
              value: await sources.readDependency(payload.package, payload.file),
            })
          }
          if (method === 'read-patch-target') {
            if (typeof payload.package !== 'string' || typeof payload.file !== 'string') {
              throw new Error('dependency package and file are required')
            }
            return json(response, 200, {
              ok: true,
              value: await sources.readDependencyTarget(payload.package, payload.file),
            })
          }
          return json(response, 404, { ok: false, error: `unknown Preview worker method ${method}` })
        } catch (error) {
          return json(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    }
    const bridge: WebRoute = {
      kind: 'exact',
      path: `${STUDIO_PATH}/bridge.js`,
      handler(request, response) {
        if (!loopback(request)) return json(response, 403, { error: 'Preview is local only' })
        response.writeHead(200, { 'cache-control': 'no-cache', 'content-type': 'text/javascript; charset=utf-8' })
        response.end(request.method === 'HEAD' ? undefined : options.bridge)
      },
    }
    const dispose = [ctx.webServer.register(worker), ctx.webServer.register(bridge), ctx.webServer.tapIndex(html => {
      const config = `<script>window.__DSH_STUDIO_PREVIEW__=${JSON.stringify({
        parentOrigin: options.parentOrigin,
        capability: options.bridgeCapability,
      })}</script><script src="${STUDIO_PATH}/bridge.js"></script>`
      const head = html.indexOf('<head>')
      return head === -1 ? `${config}${html}` : `${html.slice(0, head + 6)}${config}${html.slice(head + 6)}`
    })]
    return async () => {
      for (const stop of dispose.reverse()) stop()
      await ready.then(opened => opened.close(), () => undefined)
    }
  }, 'harmony-studio: Preview worker')
}
