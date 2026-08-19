import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { invokeStudioRemote } from '../studio-remote'
import { connectStudio } from './connection'

export class StudioRpcError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) {
    super(message)
    this.name = 'StudioRpcError'
  }
}

export async function callStudio<T>(method: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  let result: RemoteResult<unknown>
  try {
    const invocation = invokeStudioRemote(await connectStudio(signal), method, payload, signal)
    if (invocation === undefined) {
      throw new StudioRpcError('studio-method-forbidden', `method ${method} is not exposed by Studio`)
    }
    result = await invocation
  } catch (error) {
    if (error instanceof StudioRpcError) throw error
    throw new StudioRpcError('transport', error instanceof Error ? error.message : String(error))
  }
  if (!result.ok) throw new StudioRpcError(result.error.code, result.error.message, result.error.details)
  return result.value as T
}
