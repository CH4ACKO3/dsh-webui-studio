import { describe, expect, it, vi } from 'vitest'
import { StudioPreviewRegistry } from './registry.js'

describe('StudioPreviewRegistry', () => {
  it('keeps registrations before a parent connects and releases subscriptions on dispose', () => {
    let accent = '#235be6'
    let listener: (() => void) | undefined
    const stop = vi.fn()
    const changed = vi.fn()
    const registry = new StudioPreviewRegistry(changed)
    const unregister = registry.registerElement({
      owner: 'draft',
      element: {
        id: 'toolbar', label: 'Toolbar',
        boundary: { surfaceId: 'draft.surface', path: ['root', 'toolbar/one'] },
        source: { file: 'src/Toolbar.tsx' },
        variables: [{ kind: 'group', id: 'appearance', label: 'Appearance', children: [{
          kind: 'group', id: 'color', label: 'Color', children: [{
            kind: 'variable', id: 'accent', label: 'Accent', control: 'color',
            defaultSource: { file: 'src/Toolbar.tsx', before: 'const accent = ', after: ';' },
          }],
        }] }],
      },
      bindings: { accent: { get: () => accent, set: value => { accent = String(value) }, subscribe: next => { listener = next; return stop } } },
    })

    expect(registry.snapshot().elements[0]).toMatchObject({
      owner: 'draft',
      element: { variables: [{ children: [{ children: [{ defaultSource: { file: 'src/Toolbar.tsx' } }] }] }] },
      values: { accent: '#235be6' },
    })
    listener?.()
    expect(changed).toHaveBeenCalledTimes(2)
    unregister()
    expect(stop).toHaveBeenCalledOnce()
    expect(registry.snapshot().elements).toEqual([])
  })

  it('rejects duplicate definitions, missing bindings and invalid values', async () => {
    let density = 1
    const registry = new StudioPreviewRegistry(() => {})
    const registration = {
      owner: 'draft',
      element: {
        id: 'toolbar', label: 'Toolbar', boundary: { surfaceId: 'draft.surface', path: ['toolbar'] },
        source: { file: 'src/Toolbar.tsx' }, variables: [{ kind: 'variable' as const, id: 'density', label: 'Density', control: 'number' as const, constraints: { min: 0, max: 2 } }],
      },
      bindings: { density: { get: () => density, set: (value: string | number | boolean) => { density = Number(value) } } },
    }
    registry.registerElement(registration)
    expect(() => registry.registerElement(registration)).toThrow('Duplicate Studio variable node id density')
    expect(() => registry.registerElement({
      ...registration,
      element: { ...registration.element, id: 'other' },
    })).toThrow('boundary already registered')
    expect(() => registry.registerVariables({ owner: 'draft', variables: [{ kind: 'variable', id: 'accent', label: 'Accent', control: 'color' }], bindings: {} }))
      .toThrow('has no binding')
    await expect(registry.set({ scope: 'element', owner: 'draft', elementId: 'toolbar', variableId: 'density', value: 3 }))
      .rejects.toThrow('above its maximum')
    await registry.set({ scope: 'element', owner: 'draft', elementId: 'toolbar', variableId: 'density', value: 2 })
    expect(density).toBe(2)
  })

  it('merges independent variable groups contributed to the same Element', async () => {
    let color = '#235be6'
    let text = 'Explore'
    const registry = new StudioPreviewRegistry(() => {})
    const identity = {
      id: 'hero', label: 'Hero', boundary: { surfaceId: 'home', path: ['hero'] }, source: { file: 'src/hero.ts' },
    }
    const removeAppearance = registry.registerElement({
      owner: 'draft', element: { ...identity, variables: [{ kind: 'group', id: 'appearance', label: 'Appearance', children: [
        { kind: 'variable', id: 'color', label: 'Color', control: 'color' },
      ] }] }, bindings: { color: { get: () => color, set: value => { color = String(value) } } },
    })
    registry.registerElement({
      owner: 'draft', element: { ...identity, variables: [{ kind: 'group', id: 'content', label: 'Content', children: [
        { kind: 'variable', id: 'text', label: 'Text', control: 'string' },
      ] }] }, bindings: { text: { get: () => text, set: value => { text = String(value) } } },
    })

    expect(registry.snapshot().elements).toMatchObject([{
      element: { id: 'hero', variables: [{ id: 'appearance' }, { id: 'content' }] },
      values: { color: '#235be6', text: 'Explore' },
    }])
    await registry.set({ scope: 'element', owner: 'draft', elementId: 'hero', variableId: 'text', value: 'Discover' })
    expect(text).toBe('Discover')
    removeAppearance()
    expect(registry.snapshot().elements[0]).toMatchObject({ element: { variables: [{ id: 'content' }] }, values: { text: 'Discover' } })
  })

  it('rejects duplicate node ids across variable-tree branches', () => {
    const registry = new StudioPreviewRegistry(() => {})
    expect(() => registry.registerVariables({
      owner: 'draft',
      variables: [
        { kind: 'group', id: 'content', label: 'Content', children: [
          { kind: 'variable', id: 'shared', label: 'Title', control: 'string' },
        ] },
        { kind: 'group', id: 'appearance', label: 'Appearance', children: [
          { kind: 'variable', id: 'shared', label: 'Color', control: 'color' },
        ] },
      ],
      bindings: { shared: { get: () => 'value', set: () => undefined } },
    })).toThrow('Duplicate Studio variable node id shared')
  })

  it('finds and updates variables nested in recursive groups', async () => {
    let size = '12px'
    const registry = new StudioPreviewRegistry(() => {})
    registry.registerVariables({
      owner: 'draft',
      variables: [{ kind: 'group', id: 'appearance', label: 'Appearance', children: [{
        kind: 'group', id: 'typography', label: 'Typography', children: [{
          kind: 'variable', id: 'size', label: 'Size', control: 'length',
        }],
      }] }],
      bindings: { size: { get: () => size, set: value => { size = String(value) } } },
    })

    await registry.set({ scope: 'global', owner: 'draft', variableId: 'size', value: '14px' })

    expect(size).toBe('14px')
    expect(registry.snapshot().variables[0]?.values).toEqual({ size: '14px' })
  })

  it('serializes writes and never applies an old queued write to a replacement registration', async () => {
    let release: (() => void) | undefined
    let value = 0
    const registry = new StudioPreviewRegistry(() => {})
    const registration = (set: (next: number) => void | Promise<void>) => ({
      owner: 'draft',
      element: {
        id: 'toolbar', label: 'Toolbar', boundary: { surfaceId: 'draft.surface', path: ['toolbar'] },
        source: { file: 'src/Toolbar.tsx' }, variables: [{ kind: 'variable' as const, id: 'density', label: 'Density', control: 'number' as const }],
      },
      bindings: { density: { get: () => value, set: (next: string | number | boolean) => set(Number(next)) } },
    })
    const unregister = registry.registerElement(registration(async next => {
      await new Promise<void>(resolve => { release = resolve })
      value = next
    }))
    const first = registry.set({ scope: 'element', owner: 'draft', elementId: 'toolbar', variableId: 'density', value: 1 })
    const queued = registry.set({ scope: 'element', owner: 'draft', elementId: 'toolbar', variableId: 'density', value: 2 })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    unregister()
    value = 10
    registry.registerElement(registration(next => { value = next }))
    release?.()

    await first
    await expect(queued).rejects.toThrow('no longer active')
    expect(value).toBe(1)
  })
})
