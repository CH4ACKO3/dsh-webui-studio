import type { RpcResponse } from '@deepseek-ai/dsh-host-apiproxy/api'
import { AbstractApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import type { StudioServerRequest } from '../contracts'
import { studioConnection } from './connection'

export class StudioApiClient extends AbstractApiClient {
  protected doFetch(input: URL, init?: RequestInit): Promise<Response> {
    return fetch(input, init)
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
  const stopEvent = studioConnection.onEvent(event => {
    listener({
      type: 'server-request',
      rpcId: String(event.envelope.rpcId),
      method: `events.${event.channel}`,
      payload: event.envelope.payload as unknown as Record<string, unknown>,
    })
  })
  const stopState = studioConnection.onState(connected => onState?.(connected))
  const run = async (): Promise<void> => {
    while (!controller.signal.aborted) {
      try {
        await studioConnection.connect(controller.signal)
        await new Promise<void>(resolve => {
          const stop = studioConnection.onState(connected => {
            if (!connected) {
              stop()
              resolve()
            }
          })
          controller.signal.addEventListener('abort', () => {
            stop()
            resolve()
          }, { once: true })
        })
      } catch {
        onState?.(false)
      }
      if (!controller.signal.aborted) await new Promise(resolve => setTimeout(resolve, 1_000))
    }
  }
  void run()
  return () => {
    controller.abort()
    stopEvent()
    stopState()
  }
}
