import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { StudioWorkspaceState } from '../contracts.js'

function parseWorkspace(value: unknown): StudioWorkspaceState {
  if (typeof value !== 'object' || value === null) throw new Error('Studio workspace state must be an object')
  const candidate = value as Partial<StudioWorkspaceState>
  if (!Array.isArray(candidate.openDraftIds) || candidate.openDraftIds.some(id => typeof id !== 'string')) {
    throw new Error('Studio workspace openDraftIds must be an array of Draft ids')
  }
  if (new Set(candidate.openDraftIds).size !== candidate.openDraftIds.length) {
    throw new Error('Studio workspace openDraftIds must not contain duplicates')
  }
  if (candidate.selectedDraftId !== undefined && typeof candidate.selectedDraftId !== 'string') {
    throw new Error('Studio workspace selectedDraftId must be a Draft id')
  }
  if (candidate.openDraftIds.length === 0 && candidate.selectedDraftId !== undefined) {
    throw new Error('Studio workspace cannot select a closed Draft')
  }
  if (candidate.openDraftIds.length > 0
    && (candidate.selectedDraftId === undefined || !candidate.openDraftIds.includes(candidate.selectedDraftId))) {
    throw new Error('Studio workspace selectedDraftId must identify an open Draft')
  }
  return {
    openDraftIds: [...candidate.openDraftIds],
    ...(candidate.selectedDraftId === undefined ? {} : { selectedDraftId: candidate.selectedDraftId }),
  }
}

export class StudioWorkspaceStore {
  readonly file: string

  constructor(dshHome: string) {
    this.file = join(dshHome, 'studio', 'workspace.json')
  }

  async read(availableDraftIds: readonly string[]): Promise<StudioWorkspaceState> {
    let stored: StudioWorkspaceState
    try {
      stored = parseWorkspace(JSON.parse(await readFile(this.file, 'utf8')) as unknown)
    } catch (error) {
      if ((error as { code?: unknown }).code === 'ENOENT') return { openDraftIds: [] }
      throw error
    }
    const available = new Set(availableDraftIds)
    const openDraftIds = stored.openDraftIds.filter(id => available.has(id))
    if (openDraftIds.length === 0) return { openDraftIds }
    return {
      openDraftIds,
      selectedDraftId: stored.selectedDraftId !== undefined && openDraftIds.includes(stored.selectedDraftId)
        ? stored.selectedDraftId
        : openDraftIds[0],
    }
  }

  async write(state: StudioWorkspaceState, availableDraftIds: readonly string[]): Promise<StudioWorkspaceState> {
    const next = parseWorkspace(state)
    const available = new Set(availableDraftIds)
    if (next.openDraftIds.some(id => !available.has(id))) throw new Error('Studio workspace references an unknown Draft')
    await mkdir(dirname(this.file), { recursive: true })
    const temporary = join(dirname(this.file), `.workspace.${randomUUID()}.tmp`)
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' })
    await rename(temporary, this.file)
    return next
  }
}
