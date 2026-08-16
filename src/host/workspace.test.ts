import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StudioWorkspaceStore } from './workspace.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('StudioWorkspaceStore', () => {
  it('starts with no open Draft tabs and persists their order and selection', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-studio-workspace-'))
    roots.push(home)
    const store = new StudioWorkspaceStore(home)

    await expect(store.read(['draft-a', 'draft-b'])).resolves.toEqual({ openDraftIds: [] })
    await store.write({ openDraftIds: ['draft-b', 'draft-a'], selectedDraftId: 'draft-a' }, ['draft-a', 'draft-b'])

    await expect(store.read(['draft-a', 'draft-b'])).resolves.toEqual({
      openDraftIds: ['draft-b', 'draft-a'],
      selectedDraftId: 'draft-a',
    })
    expect(JSON.parse(await readFile(store.file, 'utf8'))).toEqual({
      openDraftIds: ['draft-b', 'draft-a'],
      selectedDraftId: 'draft-a',
    })
  })

  it('preserves an explicitly empty workspace and removes unavailable Drafts when reading', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-studio-workspace-'))
    roots.push(home)
    const store = new StudioWorkspaceStore(home)

    await store.write({ openDraftIds: ['draft-a', 'draft-b'], selectedDraftId: 'draft-b' }, ['draft-a', 'draft-b'])
    await expect(store.read(['draft-a'])).resolves.toEqual({ openDraftIds: ['draft-a'], selectedDraftId: 'draft-a' })
    await store.write({ openDraftIds: [] }, ['draft-a'])
    await expect(store.read(['draft-a'])).resolves.toEqual({ openDraftIds: [] })
  })

  it('rejects invalid or unknown Draft references', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-studio-workspace-'))
    roots.push(home)
    const store = new StudioWorkspaceStore(home)

    await expect(store.write({ openDraftIds: ['missing'], selectedDraftId: 'missing' }, ['draft-a']))
      .rejects.toThrow('unknown Draft')
    await expect(store.write({ openDraftIds: ['draft-a'] }, ['draft-a']))
      .rejects.toThrow('must identify an open Draft')
  })
})
