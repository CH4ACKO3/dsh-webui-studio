import { describe, expect, it } from 'vitest'
import {
  applyStudioTheme,
  isStudioThemePreference,
  readStudioTheme,
  resolveStudioTheme,
  STUDIO_THEME_STORAGE_KEY,
} from './theme'

describe('Studio theme', () => {
  it('accepts only the explicit three-state preference', () => {
    expect(['light', 'dark', 'system'].every(isStudioThemePreference)).toBe(true)
    expect(isStudioThemePreference('auto')).toBe(false)
    expect(readStudioTheme({ getItem: () => 'auto' })).toBe('system')
    expect(readStudioTheme({ getItem: key => key === STUDIO_THEME_STORAGE_KEY ? 'dark' : null })).toBe('dark')
  })

  it('resolves system without changing an explicit choice', () => {
    expect(resolveStudioTheme('system', true)).toBe('dark')
    expect(resolveStudioTheme('system', false)).toBe('light')
    expect(resolveStudioTheme('light', true)).toBe('light')
    expect(resolveStudioTheme('dark', false)).toBe('dark')
  })

  it('applies the resolved theme to the document contract', () => {
    const root = { dataset: {} as DOMStringMap, style: { colorScheme: '' } }
    applyStudioTheme(root, 'dark')
    expect(root).toEqual({ dataset: { studioTheme: 'dark' }, style: { colorScheme: 'dark' } })
  })
})
