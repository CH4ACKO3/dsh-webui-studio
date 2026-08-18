import { describe, expect, it } from 'vitest'
import {
  boundedBridgeText,
  isBridgeEnvelope,
  isBridgeOffer,
  isFinitePreviewPan,
  isFinitePreviewZoom,
  isStudioDomSelection,
  isStudioRegistrySnapshot,
} from './preview-messages.js'

describe('Preview bridge message validation', () => {
  it('rejects non-finite or unreasonable pan and zoom messages', () => {
    expect(isFinitePreviewPan({ dx: 12, dy: -3 })).toBe(true)
    expect(isFinitePreviewPan({ dx: Number.NaN, dy: 0 })).toBe(false)
    expect(isFinitePreviewPan({ dx: Infinity, dy: 0 })).toBe(false)
    expect(isFinitePreviewZoom({ deltaY: 100, deltaMode: 0 })).toBe(true)
    expect(isFinitePreviewZoom({ deltaY: 100, deltaMode: 3 })).toBe(false)
    expect(isFinitePreviewZoom({ deltaY: Infinity, deltaMode: 0 })).toBe(false)
  })

  it('requires the exact bridge capability and envelope nonce', () => {
    expect(isBridgeOffer({ type: 'dsh-studio-bridge', sessionId: 'cap' }, 'cap')).toBe(true)
    expect(isBridgeOffer({ type: 'dsh-studio-bridge', sessionId: 'other' }, 'cap')).toBe(false)
    expect(isBridgeEnvelope({ type: 'registry', sessionId: 'cap', nonce: 'nonce' }, 'cap', 'nonce')).toBe(true)
    expect(isBridgeEnvelope({ type: 'registry', sessionId: 'cap', nonce: 'stale' }, 'cap', 'nonce')).toBe(false)
  })

  it('accepts complete bounded selections and rejects malformed geometry', () => {
    const selection = {
      tag: 'button', classes: ['primary'], attributes: { type: 'button' }, text: 'Save', outerHTML: '<button>Save</button>',
      rect: { x: 1, y: 2, width: 80, height: 24 }, style: { display: 'block' }, boundaries: [], confidence: 'dom-only',
    }
    expect(isStudioDomSelection(selection)).toBe(true)
    expect(isStudioDomSelection({ ...selection, rect: { ...selection.rect, width: Number.NaN } })).toBe(false)
    expect(isStudioDomSelection({ ...selection, classes: Array.from({ length: 101 }, () => 'class') })).toBe(false)
  })

  it('accepts complete registries and rejects missing or oversized collections', () => {
    const registry = {
      elements: [{
        owner: 'draft',
        element: {
          id: 'toolbar', label: 'Toolbar', boundary: { surfaceId: 'main', path: ['toolbar'] },
          source: { file: 'src/client.tsx', line: 2 },
          variables: [{
            id: 'dense', label: 'Dense', control: 'boolean',
            defaultSource: { file: 'src/client.tsx', before: 'const dense = ', after: ';' },
          }],
        },
        values: { dense: true },
      }],
      variables: [],
    }
    expect(isStudioRegistrySnapshot(registry)).toBe(true)
    expect(isStudioRegistrySnapshot({ elements: [{}], variables: [] })).toBe(false)
    expect(isStudioRegistrySnapshot({ elements: Array.from({ length: 501 }, () => registry.elements[0]), variables: [] })).toBe(false)
  })

  it('bounds errors received from the Preview', () => {
    expect(boundedBridgeText('error')).toBe(true)
    expect(boundedBridgeText('x'.repeat(2_001))).toBe(false)
  })
})
