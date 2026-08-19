import { BrowserPeerClient } from 'the-binding-of-dsh/browser-peer'
import { STUDIO_REMOTE, type StudioRemote } from '../studio-remote'

export const studioConnection = new BrowserPeerClient({ contribution: STUDIO_REMOTE })

export async function connectStudio(signal?: AbortSignal): Promise<StudioRemote> {
  await studioConnection.connect(signal)
  return (studioConnection.remote as unknown as { studio: StudioRemote }).studio
}
