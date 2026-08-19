import { STUDIO_API_PATH, type StudioServerResponse } from '../contracts'
import { nextBrowserId } from './id'

declare global {
  interface Window {
    __DSH_STUDIO__: { token: string }
  }
}

export class StudioRpcError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) {
    super(message)
    this.name = 'StudioRpcError'
  }
}

function rpcId(): string {
  return nextBrowserId()
}

export async function callStudio<T>(method: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  const id = rpcId()
  const response = await fetch(`${STUDIO_API_PATH}/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-dsh-studio-token': window.__DSH_STUDIO__.token,
    },
    body: JSON.stringify({ type: 'client-request', rpcId: id, method, payload }),
    signal,
  })
  if (!response.ok) throw new StudioRpcError('transport', `Studio request failed with HTTP ${response.status}`)
  const envelope = await response.json() as StudioServerResponse<T>
  if (envelope.type !== 'server-response' || envelope.rpcId !== id) {
    throw new StudioRpcError('protocol', 'Studio response envelope does not match the request')
  }
  if (!envelope.result.ok) {
    throw new StudioRpcError(envelope.result.error.code, envelope.result.error.message, envelope.result.error.details)
  }
  return envelope.result.value
}
