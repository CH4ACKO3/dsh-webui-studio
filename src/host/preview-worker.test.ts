import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { beforeEach, expect, it, vi } from 'vitest'
import { STUDIO_PREVIEW_API_PATH, type StudioHarmonyService } from '../contracts.js'

const previewDraft = vi.hoisted(() => ({ open: vi.fn() }))

vi.mock('./preview-draft.js', () => ({
  StudioPreviewDraft: class {
    open() { return previewDraft.open() }
  },
}))

vi.mock('./source-resolution.js', () => ({
  StudioSourceResolver: class {},
}))

import { applyPreviewWorker } from './preview-worker.js'

beforeEach(() => {
  previewDraft.open.mockReset()
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
    controlToken: 'secret',
    parentOrigin: 'http://127.0.0.1:3081',
    bridgeCapability: 'bridge',
    bridge: Buffer.alloc(0),
  })
  return route!
}

async function health(route: WebRoute): Promise<{ status: number; body: unknown }> {
  const request = Object.assign(Readable.from(['{}']), {
    method: 'POST',
    url: `${STUDIO_PREVIEW_API_PATH}/health`,
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
