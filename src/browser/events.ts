import { AbstractApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import {
  serverRequestSchema,
  type ApiProxy,
  type HostFrame,
  type MuxFrame,
  type RpcRequest,
  type RpcResponse,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import { hostFrameSchema, muxFrameSchema } from '@deepseek-ai/dsh-host-apiproxy/api/events.schema'
import type { StudioServerRequest } from '../contracts'

type FrameSchema<F> = { parse(input: unknown): F }

export class StudioApiClient extends AbstractApiClient {
  protected doFetch(input: URL, init?: RequestInit): Promise<Response> {
    return fetch(input, init)
  }

  protected openMux(
    _payload: Parameters<ApiProxy['events']['mux']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<MuxFrame>> {
    return this.readWebSocket('/api/events.mux', signal, muxFrameSchema, onOpen)
  }

  protected openHost(
    _payload: Parameters<ApiProxy['events']['host']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<HostFrame>> {
    return this.readWebSocket('/api/events.host', signal, hostFrameSchema, onOpen)
  }

  private async *readWebSocket<F>(
    path: string,
    signal: AbortSignal,
    frameSchema: FrameSchema<F>,
    onOpen?: () => void,
  ): AsyncGenerator<RpcRequest<F>> {
    const url = new URL(path, this.resolveBase())
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url)
    const inbox: Array<{ kind: 'frame'; envelope: RpcRequest<F> } | { kind: 'end' }> = []
    let wake: (() => void) | undefined
    const enqueue = (item: typeof inbox[number]): void => {
      inbox.push(item)
      wake?.()
      wake = undefined
    }
    const open = (): void => onOpen?.()
    const message = (event: MessageEvent): void => {
      try {
        if (typeof event.data !== 'string') throw new Error('binary WebSocket frame')
        const full = serverRequestSchema.parse(JSON.parse(event.data))
        const frame = frameSchema.parse(full.payload)
        this.onEnvelope(full)
        enqueue({ kind: 'frame', envelope: { rpcId: full.rpcId, payload: frame } })
      } catch (error) {
        console.error(`[harmony-studio] dropping malformed WebSocket frame on ${path}:`, error)
      }
    }
    const close = (): void => enqueue({ kind: 'end' })
    const abort = (): void => {
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) socket.close()
    }
    socket.addEventListener('open', open)
    socket.addEventListener('message', message)
    socket.addEventListener('close', close, { once: true })
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    try {
      while (true) {
        while (inbox.length > 0) {
          const item = inbox.shift()!
          if (item.kind === 'end') return
          yield item.envelope
        }
        await new Promise<void>(resolve => { wake = resolve })
      }
    } finally {
      signal.removeEventListener('abort', abort)
      socket.removeEventListener('open', open)
      socket.removeEventListener('message', message)
      socket.removeEventListener('close', close)
      abort()
    }
  }
}

export const studioApi = new StudioApiClient()

export function apiValue<T>(response: RpcResponse<T>): T {
  if (!response.result.ok) throw new Error(response.result.error.message)
  return response.result.value
}

export type StudioEventListener = (event: StudioServerRequest<Record<string, unknown>>) => void

export function subscribeStudioEvents(listener: StudioEventListener, onState?: (connected: boolean) => void): () => void {
  const controller = new AbortController()
  const open = new Set<'mux' | 'host'>()
  const run = async (channel: 'mux' | 'host'): Promise<void> => {
    while (!controller.signal.aborted) {
      try {
        const source = channel === 'mux'
          ? studioApi.events.mux({}, controller.signal, () => {
              open.add(channel)
              if (open.size === 2) onState?.(true)
            })
          : studioApi.events.host({}, controller.signal, () => {
              open.add(channel)
              if (open.size === 2) onState?.(true)
            })
        for await (const envelope of source) {
          listener({
            type: 'server-request',
            rpcId: String(envelope.rpcId),
            method: `events.${channel}`,
            payload: envelope.payload as unknown as Record<string, unknown>,
          })
        }
      } catch {
        // The reconnect loop owns transport recovery.
      }
      open.delete(channel)
      onState?.(false)
      if (!controller.signal.aborted) await new Promise(resolve => setTimeout(resolve, 1_000))
    }
  }
  void run('mux')
  void run('host')
  return () => controller.abort()
}
