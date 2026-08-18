import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { beforeEach, expect, it, vi } from 'vitest'
import { STUDIO_PREVIEW_API_PATH, type StudioHarmonyService } from '../contracts.js'

const previewDraft = vi.hoisted(() => ({ construct: vi.fn(), open: vi.fn() }))
const sourceResolver = vi.hoisted(() => ({ readDependencyTarget: vi.fn() }))

vi.mock('./preview-draft.js', () => ({
  StudioPreviewDraft: class {
    constructor() { previewDraft.construct() }
    open() { return previewDraft.open() }
  },
}))

vi.mock('./source-resolution.js', () => ({
  StudioSourceResolver: class {
    readDependencyTarget(packageName: string, file: string) {
      return sourceResolver.readDependencyTarget(packageName, file)
    }
  },
}))

import { applyPreviewWorker } from './preview-worker.js'

beforeEach(() => {
  previewDraft.construct.mockReset()
  previewDraft.open.mockReset()
  sourceResolver.readDependencyTarget.mockReset()
})

function workerRoute(): WebRoute {
  let route: WebRoute | undefined
  const ctx = {
    effect(start: () => unknown) { start() },
    webServer: {
      register(candidate: WebRoute) {
        if (candidate.path === STUDIO_PREVIEW_API_PATH) route = candidate
        return () => {}
      },
      tapIndex() { return () => {} },
    },
  } as unknown as Context
  applyPreviewWorker(ctx, { profileDir: '/profile' } as StudioHarmonyService, {
    root: '/draft',
    packageDirs: [],
    controlToken: 'secret',
    parentOrigin: 'http://127.0.0.1:3081',
    bridgeCapability: 'bridge',
    bridge: Buffer.alloc(0),
  })
  return route!
}

async function health(route: WebRoute): Promise<{ status: number; body: unknown }> {
  return workerRequest(route, 'health', {})
}

async function workerRequest(route: WebRoute, method: string, payload: unknown): Promise<{ status: number; body: unknown }> {
  const request = Object.assign(Readable.from([JSON.stringify(payload)]), {
    method: 'POST',
    url: `${STUDIO_PREVIEW_API_PATH}/${method}`,
    headers: { authorization: 'Bearer secret' },
    socket: { remoteAddress: '127.0.0.1' },
  }) as unknown as IncomingMessage
  const result = { status: 0, body: undefined as unknown }
  const response = {
    writeHead(status: number) { result.status = status; return this },
    end(body?: string | Buffer) { result.body = JSON.parse(body?.toString() ?? 'null'); return this },
  } as unknown as ServerResponse
  await route.handler(request, response)
  return result
}

it('reports unavailable until the Draft startup promise resolves', async () => {
  let resolve!: (draft: { close(): Promise<void> }) => void
  previewDraft.open.mockReturnValue(new Promise(next => { resolve = next }))
  const route = workerRoute()

  await expect(health(route)).resolves.toEqual({
    status: 503,
    body: { ok: false, error: 'Preview worker is still preparing the Draft' },
  })

  resolve({ async close() {} })
  await vi.waitFor(async () => {
    await expect(health(route)).resolves.toEqual({ status: 200, body: { ok: true, value: { ready: true } } })
  })
})

it('handles startup rejection immediately and reports the failure', async () => {
  previewDraft.open.mockRejectedValue(new Error('Draft Patch reload failed'))
  const route = workerRoute()

  await vi.waitFor(async () => {
    await expect(health(route)).resolves.toEqual({
      status: 500,
      body: { ok: false, error: 'Draft Patch reload failed' },
    })
  })
})

it('registers the health route before reporting a synchronous Draft construction failure', async () => {
  previewDraft.construct.mockImplementation(() => { throw new Error('Draft package resolution failed') })
  const route = workerRoute()

  await vi.waitFor(async () => {
    await expect(health(route)).resolves.toEqual({
      status: 500,
      body: { ok: false, error: 'Draft package resolution failed' },
    })
  })
})

it('returns installed dependency source and version for automatic Patch analysis', async () => {
  previewDraft.open.mockResolvedValue({ snapshot: () => ({ name: 'draft-plugin' }), async close() {} })
  sourceResolver.readDependencyTarget.mockResolvedValue({
    package: 'target-plugin', file: 'lib/client.js', version: '1.2.3', source: 'const title = "Original";\n',
  })
  const route = workerRoute()

  await expect(workerRequest(route, 'read-patch-target', {
    package: 'target-plugin', file: 'lib/client.js',
  })).resolves.toEqual({ status: 200, body: { ok: true, value: {
    package: 'target-plugin', file: 'lib/client.js', version: '1.2.3', source: 'const title = "Original";\n',
  } } })
})
