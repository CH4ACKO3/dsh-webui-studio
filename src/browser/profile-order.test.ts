import { describe, expect, it } from 'vitest'
import { isProfilePluginEnabled, moveProfilePlugin, setProfilePluginEnabled } from './profile-order.js'

describe('Harmony profile editing', () => {
  it('moves plugins while keeping Harmony pinned first', () => {
    const order = ['dsh-harmony', 'plugin-a', 'plugin-b']

    expect(moveProfilePlugin(order, 'plugin-b', 0)).toEqual(['dsh-harmony', 'plugin-b', 'plugin-a'])
    expect(moveProfilePlugin(order, 'dsh-harmony', 2)).toEqual(order)
    expect(order).toEqual(['dsh-harmony', 'plugin-a', 'plugin-b'])
  })

  it('toggles a provider as one unit without changing other disabled patches', () => {
    const disabled = ['plugin-a/first', 'plugin-a/second', '@scope/plugin/only', 'plugin-b/keep']

    const disabledProvider = setProfilePluginEnabled(disabled, 'plugin-a', false)
    expect(disabledProvider).toEqual(['@scope/plugin/only', 'plugin-b/keep', 'plugin-a/*'])
    expect(isProfilePluginEnabled(disabledProvider, 'plugin-a')).toBe(false)
    expect(setProfilePluginEnabled(disabledProvider, 'plugin-a', true)).toEqual([
      '@scope/plugin/only',
      'plugin-b/keep',
    ])
  })
})
